/**
 * The editing canvas: an SVG viewport over the current scene. Pan/zoom are
 * purely local view state (not part of the project — they're not
 * something you'd ever want to undo or save), while layer positions are
 * real project data that flows through the editor reducer.
 *
 * Dragging a layer updates a LOCAL preview transform for smooth 60fps
 * feedback and only dispatches ONE reducer action on mouse-up. Dispatching
 * on every mousemove would push a new undo snapshot per pixel moved,
 * turning one drag into hundreds of undo steps.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { Plus, Square } from "lucide-react";
import { isLayerVisibleAt } from "../types/motion";
import type { MotionLayer, MotionScene, Transform } from "../types/motion";
import type { GradientFill } from "./gradients/gradientTypes";
import type { ShadowEffect } from "./shadowfx/shadowTypes";
import { lineHeight, wrapTextToLines } from "./textWrap";
import { VideoLayerView } from "./video/VideoLayerView";
import { resolveConnectorEndpoints } from "./connectorGeometry";
import { Connector } from "./connector/Connector";
import type { ConnectorSpec } from "./connector/ConnectorTypes";
import { computeDragSnap, computeResizeSnap } from "./guides";
import type { GuideLine } from "./guides";

type ResizeHandle = "nw" | "ne" | "sw" | "se";

interface MotionCanvasProps {
  scene: MotionScene;
  selectedLayerIds: string[];
  onSelect: (ids: string[]) => void;
  onMoveLayer: (layerId: string, x: number, y: number) => void;
  onResizeLayer: (layerId: string, patch: Partial<Transform>) => void;
  /** The transform to actually draw for a layer — resolved through its
   * keyframes at the current playhead, or its static transform when it
   * has none. Dragging starts FROM this value too, so grabbing an
   * already-animated shape feels continuous instead of snapping to its
   * unanimated base position. */
  getTransform: (layer: MotionLayer) => Transform;
  /** Current scene time. Video layers seek to match it, so scrubbing the
   * timeline moves the footage instead of letting it run on its own clock. */
  playheadMs: number;
  /** Whether the transport is running, so video layers play/pause with it. */
  isPlaying: boolean;
  /** Connect mode: clicking a layer picks a connector endpoint instead of
   *  selecting/dragging it. Owned by the editor because the toolbar toggles
   *  it too; it's view state, not project data. */
  connectMode?: boolean;
  /** The layer already picked as the connector's source, if any — highlighted
   *  so it's obvious what the next click will join to. */
  connectFromLayerId?: string | null;
  onConnectPick?: (layerId: string) => void;
  onOpenInsert?: () => void;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Per-layer gradient <defs>. The id is namespaced by layer id (`{id}-fill`)
 * so the gradient is reachable via `url(#id-fill)` from that layer's shape
 * without colliding with gradients on sibling layers. Angle is converted to
 * SVG userSpace coordinates with the gradient vector at the layer's local
 * origin (0..width for linear; center for radial) — applied in the
 * parent <g>'s transform so it rotates with the layer.
 */
function renderGradientDef(layerId: string, grad: GradientFill): React.ReactNode {
  const stops = grad.stops.map((s, i) => (
    <stop key={i} offset={s.offset} stopColor={s.color} />
  ));
  if (grad.type === "radial") {
    return (
      <radialGradient id={`${layerId}-fill`} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        {stops}
      </radialGradient>
    );
  }
  // Linear: SVG's linearGradient x1/y1/x2/y2 are normalized to the bounding
  // box (0..1) by default, so the gradient stays locked to the shape's rect
  // regardless of how the parent's <g transform> scales the layer.
  // angle_deg follows the CSS convention (0 = up, increasing clockwise) so
  // this matches GradientPicker's `linear-gradient(${angle_deg}deg, …)`
  // preview. Using SVG's own convention here instead (dx=cos, dy=sin, i.e.
  // 0deg = to the right) makes the picker disagree with the canvas by 90
  // degrees — verified in a browser, so don't "simplify" it back.
  const rad = (grad.angle_deg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return (
    <linearGradient
      id={`${layerId}-fill`}
      x1={(1 - dx) / 2}
      y1={(1 - dy) / 2}
      x2={(1 + dx) / 2}
      y2={(1 + dy) / 2}
    >
      {stops}
    </linearGradient>
  );
}

/**
 * Per-layer drop-shadow / glow <filter>. feDropShadow's stdDeviation drives
 * the blur radius; offset is x/y; flood-color + flood-opacity drives the
 * shadow tint and intensity. glow=true centers the offset (0,0) so the same
 * struct renders as a centered glow rather than a directional drop shadow.
 */
function renderShadowFilter(layerId: string, shadow: ShadowEffect): React.ReactNode {
  const dx = shadow.glow ? 0 : shadow.offset_x;
  const dy = shadow.glow ? 0 : shadow.offset_y;
  return (
    <filter id={`${layerId}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow
        dx={dx}
        dy={dy}
        stdDeviation={shadow.blur}
        floodColor={shadow.color}
        floodOpacity={shadow.opacity}
      />
    </filter>
  );
}

/** Compute the fill value for a layer — either the gradient url (if set) or
 *  the shape's plain solid fill. */
function resolveFill(
  layer: MotionLayer,
  solidFill: string,
): string {
  if (layer.gradient) return `url(#${layer.id}-fill)`;
  return solidFill;
}

export function MotionCanvas({
  scene,
  selectedLayerIds,
  onSelect,
  onMoveLayer,
  onResizeLayer,
  getTransform,
  playheadMs,
  isPlaying,
  connectMode = false,
  connectFromLayerId = null,
  onConnectPick,
  onOpenInsert,
}: MotionCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 0.5 });
  const [dragPreview, setDragPreview] = useState<{ layerId: string; x: number; y: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<
    { layerId: string; x: number; y: number; width: number; height: number } | null
  >(null);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [showSafeArea, setShowSafeArea] = useState(false);

  // Toggle safe-area overlay with S key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target !== document.body) return;
      if (e.key === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowSafeArea((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragState = useRef<{
    layerId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const resizeState = useRef<{
    layerId: string;
    handle: ResizeHandle;
    startClientX: number;
    startClientY: number;
    start: Transform;
  } | null>(null);

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const nextZoom = clampZoom(viewport.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    // Zoom around the cursor: keep the scene point under the cursor fixed.
    const sceneX = (cursorX - viewport.x) / viewport.zoom;
    const sceneY = (cursorY - viewport.y) / viewport.zoom;
    setViewport({
      zoom: nextZoom,
      x: cursorX - sceneX * nextZoom,
      y: cursorY - sceneY * nextZoom,
    });
  }

  function handleCanvasMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      // Middle-click, right-click, or shift-drag pans.
      panState.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: viewport.x,
        originY: viewport.y,
      };
      return;
    }
    if (e.target === svgRef.current) onSelect([]);
  }

  function handleLayerMouseDown(e: React.MouseEvent, layer: MotionLayer) {
    if (layer.locked) return;
    e.stopPropagation();
    // In connect mode a click picks a connector endpoint rather than
    // selecting or dragging — otherwise the first click would start a drag
    // and the user would move the layer they meant to connect.
    if (connectMode) {
      onConnectPick?.(layer.id);
      return;
    }
    const alreadySelected = selectedLayerIds.includes(layer.id);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // Toggle into/out of the selection instead of replacing it — same
      // multi-select gesture as the layer panel, needed for align/distribute.
      onSelect(
        alreadySelected ? selectedLayerIds.filter((id) => id !== layer.id) : [...selectedLayerIds, layer.id],
      );
      // Don't start a drag on a modifier-click — that's a selection
      // gesture, not a move gesture, and dragging a multi-selection isn't
      // supported yet (each layer would need its own drag delta applied).
      return;
    }
    // A plain click always collapses the selection to just this layer —
    // predictable, matches the layer panel's behavior, and keeps drag
    // math simple (only ever one layer's transform to update).
    onSelect([layer.id]);
    const current = getTransform(layer);
    dragState.current = {
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: current.x,
      startY: current.y,
      startWidth: current.width,
      startHeight: current.height,
    };
  }

  function handleResizeMouseDown(e: React.MouseEvent, layer: MotionLayer, handle: ResizeHandle) {
    e.stopPropagation();
    resizeState.current = {
      layerId: layer.id,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      start: getTransform(layer),
    };
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (panState.current) {
      const dx = e.clientX - panState.current.startX;
      const dy = e.clientY - panState.current.startY;
      setViewport((v) => ({ ...v, x: panState.current!.originX + dx, y: panState.current!.originY + dy }));
      return;
    }
    if (dragState.current) {
      const ds = dragState.current;
      const dx = (e.clientX - ds.startClientX) / viewport.zoom;
      const dy = (e.clientY - ds.startClientY) / viewport.zoom;
      const rawX = ds.startX + dx;
      const rawY = ds.startY + dy;
      const threshold = 8 / viewport.zoom;
      const otherTransforms = scene.layers
        .filter((l) => l.id !== ds.layerId && !l.hidden && isLayerVisibleAt(l, scene.duration_ms, playheadMs))
        .map((l) => getTransform(l));
      const snap = computeDragSnap(rawX, rawY, ds.startWidth, ds.startHeight, scene.width, scene.height, otherTransforms, threshold, e.altKey);
      setDragPreview({ layerId: ds.layerId, x: snap.x, y: snap.y });
      setGuides(snap.guides);
      return;
    }
    if (resizeState.current) {
      const rs = resizeState.current;
      const dx = (e.clientX - rs.startClientX) / viewport.zoom;
      const dy = (e.clientY - rs.startClientY) / viewport.zoom;
      const threshold = 8 / viewport.zoom;
      const otherTransforms = scene.layers
        .filter((l) => l.id !== rs.layerId && !l.hidden && isLayerVisibleAt(l, scene.duration_ms, playheadMs))
        .map((l) => getTransform(l));
      const snap = computeResizeSnap(rs.handle, rs.start, dx, dy, scene.width, scene.height, otherTransforms, threshold, e.altKey);
      setResizePreview({ layerId: rs.layerId, x: snap.x, y: snap.y, width: snap.width, height: snap.height });
      setGuides(snap.guides);
    }
  }

  function handleMouseUp() {
    panState.current = null;
    if (dragState.current && dragPreview) {
      onMoveLayer(dragPreview.layerId, dragPreview.x, dragPreview.y);
    }
    if (resizeState.current && resizePreview) {
      const { x, y, width, height } = resizePreview;
      onResizeLayer(resizePreview.layerId, { x, y, width, height });
    }
    dragState.current = null;
    resizeState.current = null;
    setDragPreview(null);
    setResizePreview(null);
    setGuides([]);
  }

  function layerTransform(layer: MotionLayer) {
    if (dragPreview?.layerId === layer.id) {
      return { ...getTransform(layer), x: dragPreview.x, y: dragPreview.y };
    }
    if (resizePreview?.layerId === layer.id) {
      return { ...getTransform(layer), ...resizePreview };
    }
    return getTransform(layer);
  }

  function renderLayer(layer: MotionLayer) {
    if (layer.hidden) return null;
    // Layers can be given a scene-time window (dragged/trimmed on the
    // timeline); outside it they aren't on screen. Gating here rather than
    // filtering the list keeps layer order and the <defs> block untouched.
    if (!isLayerVisibleAt(layer, scene.duration_ms, playheadMs)) return null;
    const t = layerTransform(layer);
    const groupTransform = `translate(${t.x} ${t.y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2})`;
    const selected = selectedLayerIds.includes(layer.id);

    let shape: React.ReactNode = null;
    if (layer.type === "rect" && layer.rect) {
      shape = (
        <rect
          width={t.width}
          height={t.height}
          rx={layer.rect.corner_radius}
          ry={layer.rect.corner_radius}
          fill={resolveFill(layer, layer.rect.fill)}
          stroke={layer.rect.stroke_width > 0 ? layer.rect.stroke_color : "none"}
          strokeWidth={layer.rect.stroke_width}
        />
      );
    } else if (layer.type === "ellipse" && layer.ellipse) {
      shape = (
        <ellipse
          cx={t.width / 2}
          cy={t.height / 2}
          rx={t.width / 2}
          ry={t.height / 2}
          fill={resolveFill(layer, layer.ellipse.fill)}
          stroke={layer.ellipse.stroke_width > 0 ? layer.ellipse.stroke_color : "none"}
          strokeWidth={layer.ellipse.stroke_width}
        />
      );
    } else if (layer.type === "text" && layer.text) {
      const anchor = layer.text.align === "center" ? "middle" : layer.text.align === "right" ? "end" : "start";
      const anchorX = layer.text.align === "center" ? t.width / 2 : layer.text.align === "right" ? t.width : 0;
      // Wrap text to the layer's box width using the shared estimator so the
      // canvas, the export, and the thumbnail all break at the same points.
      // First tspan sits on the parent's y baseline; subsequent ones use dy
      // to drop down by one line height. ALL tspans share anchorX so the
      // alignment stays consistent across lines.
      const lines = wrapTextToLines(layer.text.text, {
        maxWidthPx: Math.max(0, t.width),
        fontSize: layer.text.font_size,
      });
      const lineY = lineHeight(layer.text.font_size, layer.text.line_height);
      shape = (
        <text
          x={anchorX}
          y={layer.text.font_size}
          textAnchor={anchor}
          fontFamily={layer.text.font_family}
          fontSize={layer.text.font_size}
          fontWeight={layer.text.font_weight}
          fill={resolveFill(layer, layer.text.color)}
          letterSpacing={layer.text.letter_spacing ?? 0}
          stroke={layer.text.stroke_width && layer.text.stroke_width > 0 ? layer.text.stroke_color : "none"}
          strokeWidth={layer.text.stroke_width ?? 0}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={anchorX} dy={i === 0 ? 0 : lineY}>
              {line}
            </tspan>
          ))}
        </text>
      );
    } else if (layer.type === "image" && layer.image) {
      // Images keep their native fill — gradient/shadow on raster content
      // isn't a useful combination (the image already carries its own
      // colors), so we deliberately don't pipe gradient through to <image>.
      shape = layer.image.src ? (
        <image
          href={layer.image.src}
          width={t.width}
          height={t.height}
          preserveAspectRatio={
            layer.image.fit === "cover"
              ? "xMidYMid slice"
              : layer.image.fit === "fill"
                ? "none"
                : "xMidYMid meet"
          }
        />
      ) : (
        <rect width={t.width} height={t.height} fill="#2a2a33" stroke="#444" strokeDasharray="6 4" />
      );
    } else if (layer.type === "video" && layer.video) {
      // SVG has no native <video> element — VideoLayerView embeds real HTML
      // in a <foreignObject> and drives its currentTime from the playhead,
      // so scrubbing moves the footage and the preview matches the export.
      shape = layer.video.source_url ? (
        <VideoLayerView
          video={layer.video}
          width={t.width}
          height={t.height}
          playheadMs={playheadMs}
          isPlaying={isPlaying}
        />
      ) : (
        <rect width={t.width} height={t.height} fill="#2a2a33" stroke="#444" strokeDasharray="6 4" />
      );
    } else if (layer.type === "polygon" && layer.polygon) {
      const pts = layer.polygon.points.join(" ");
      shape = (
        <polygon
          points={pts}
          fill={resolveFill(layer, layer.polygon.fill)}
          stroke={layer.polygon.stroke_width > 0 ? layer.polygon.stroke_color : "none"}
          strokeWidth={layer.polygon.stroke_width}
        />
      );
    } else if (layer.type === "star" && layer.star) {
      const cx = t.width / 2;
      const cy = t.height / 2;
      const outerR = Math.min(t.width, t.height) / 2;
      const innerR = outerR * layer.star.inner_radius_ratio;
      const starPts: number[] = [];
      for (let i = 0; i < layer.star.num_points * 2; i++) {
        const a = (Math.PI * 2 * i) / (layer.star.num_points * 2) - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        starPts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      shape = (
        <polygon
          points={starPts.join(" ")}
          fill={resolveFill(layer, layer.star.fill)}
          stroke={layer.star.stroke_width > 0 ? layer.star.stroke_color : "none"}
          strokeWidth={layer.star.stroke_width}
        />
      );
    } else if (layer.type === "triangle" && layer.triangle) {
      const triDir = layer.triangle.direction;
      let triPts: number[];
      if (triDir === "up") {
        triPts = [t.width / 2, 0, 0, t.height, t.width, t.height];
      } else if (triDir === "down") {
        triPts = [0, 0, t.width, 0, t.width / 2, t.height];
      } else if (triDir === "left") {
        triPts = [t.width, 0, t.width, t.height, 0, t.height / 2];
      } else {
        triPts = [0, 0, 0, t.height, t.width, t.height / 2];
      }
      shape = (
        <polygon
          points={triPts.join(" ")}
          fill={resolveFill(layer, layer.triangle.fill)}
          stroke={layer.triangle.stroke_width > 0 ? layer.triangle.stroke_color : "none"}
          strokeWidth={layer.triangle.stroke_width}
        />
      );
    } else if (layer.type === "line" && layer.line) {
      // Line is stroke-only — gradient (when set) applies to the stroke.
      const lineStroke = layer.gradient ? `url(#${layer.id}-fill)` : layer.line.stroke_color;
      shape = (
        <line
          x1={layer.line.x1}
          y1={layer.line.y1}
          x2={layer.line.x2}
          y2={layer.line.y2}
          stroke={lineStroke}
          strokeWidth={layer.line.stroke_width}
          strokeLinecap="round"
        />
      );
    } else if (layer.type === "arrow" && layer.arrow) {
      // Arrow is stroke-only — gradient (when set) applies to both shaft and head.
      const a = layer.arrow;
      const dx = a.x2 - a.x1;
      const dy = a.y2 - a.y1;
      const len = Math.hypot(dx, dy);
      const ux = len > 0 ? dx / len : 1;
      const uy = len > 0 ? dy / len : 0;
      const headAng = (a.head_angle * Math.PI) / 180;
      const baseCx = a.x2 - a.head_size * Math.cos(headAng) * ux;
      const baseCy = a.y2 - a.head_size * Math.cos(headAng) * uy;
      const hw = a.head_size * Math.sin(headAng);
      const leftPx = baseCx + hw * uy;
      const leftPy = baseCy - hw * ux;
      const rightPx = baseCx - hw * uy;
      const rightPy = baseCy + hw * ux;
      const arrowStroke = layer.gradient ? `url(#${layer.id}-fill)` : a.stroke_color;
      shape = (
        <g>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={arrowStroke} strokeWidth={a.stroke_width} strokeLinecap="round" />
          <polygon points={`${a.x2},${a.y2} ${leftPx},${leftPy} ${rightPx},${rightPy}`} fill={arrowStroke} />
        </g>
      );
    }

    // Wrap the shape in a filter group when shadow is set, so feDropShadow
    // applies before the parent's transform/opacity group composites it.
    const filteredShape = layer.shadow ? (
      <g filter={`url(#${layer.id}-shadow)`}>{shape}</g>
    ) : (
      shape
    );

    return (
      <g
        key={layer.id}
        transform={groupTransform}
        opacity={t.opacity}
        onMouseDown={(e) => handleLayerMouseDown(e, layer)}
        style={{ cursor: layer.locked ? "not-allowed" : "move" }}
      >
        {filteredShape}
        {selected && (
          <rect
            width={t.width}
            height={t.height}
            fill="none"
            stroke="#6366F1"
            strokeWidth={2 / viewport.zoom}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {/* Connect mode: mark the layer already picked as the source, so it's
            obvious what the next click will join to. Without this the gesture
            is invisible and the user can't tell whether their first click
            registered. */}
        {connectMode && connectFromLayerId === layer.id && (
          <rect
            width={t.width}
            height={t.height}
            fill="none"
            stroke="#22D3EE"
            strokeWidth={3 / viewport.zoom}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {/* Corner handles need to project screen-space drag deltas onto the
            shape's own axes to resize correctly once it's rotated — not
            implemented yet, so handles are hidden for rotated shapes.
            Width/height are still editable via the Inspector's number
            fields regardless of rotation. */}
        {selected && !layer.locked && t.rotation === 0 && (
          <>
            {(["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => {
              const hx = handle.includes("e") ? t.width : 0;
              const hy = handle.includes("s") ? t.height : 0;
              const size = 8 / viewport.zoom;
              return (
                <rect
                  key={handle}
                  x={hx - size / 2}
                  y={hy - size / 2}
                  width={size}
                  height={size}
                  fill="#6366F1"
                  stroke="#fff"
                  strokeWidth={1 / viewport.zoom}
                  style={{ cursor: `${handle}-resize` }}
                  onMouseDown={(e) => handleResizeMouseDown(e, layer, handle)}
                />
              );
            })}
          </>
        )}
      </g>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#16161c]">
      <svg
        ref={svgRef}
        className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      >
      <defs>
        <pattern id="motion-grid" width={40 * viewport.zoom} height={40 * viewport.zoom} patternUnits="userSpaceOnUse">
          <path
            d={`M ${40 * viewport.zoom} 0 L 0 0 0 ${40 * viewport.zoom}`}
            fill="none"
            stroke="#232330"
            strokeWidth={1}
          />
        </pattern>
        {/* Per-layer gradient fills and shadow filters — emitted before the
            layer map is rendered so url(#id-fill) / url(#id-shadow) resolve
            when each layer's shape is drawn. Layers without effects just
            don't appear here, which is fine. */}
        {scene.layers.map((layer) => (
          <Fragment key={`defs-${layer.id}`}>
            {layer.gradient ? renderGradientDef(layer.id, layer.gradient) : null}
            {layer.shadow ? renderShadowFilter(layer.id, layer.shadow) : null}
          </Fragment>
        ))}
      </defs>
      <rect width="100%" height="100%" fill="url(#motion-grid)" />

      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {/* The scene frame — the actual exportable canvas area. */}
        <rect
          width={scene.width}
          height={scene.height}
          fill={scene.background_color}
          stroke="#3a3a46"
          strokeWidth={1 / viewport.zoom}
        />
        {scene.layers.map(renderLayer)}
        {(scene.connectors ?? []).map((conn) => {
          const resolved = resolveConnectorEndpoints(conn, scene.layers, playheadMs);
          if (!resolved) return null;
          const spec: ConnectorSpec = {
            from: resolved.source,
            to: resolved.target,
            style: conn.style,
            strokeColor: conn.stroke_color,
            strokeWidth: conn.stroke_width,
            dashPattern: conn.dash_pattern ?? undefined,
            animated: conn.animated,
          };
          return <Connector key={conn.id} spec={spec} currentTime={playheadMs} />;
        })}
        {/* Snap-guide lines — drawn above layers/connectors so they're
            always visible but don't participate in layout/events. */}
        {guides.map((g, i) =>
          g.axis === "vertical" ? (
            <line
              key={i}
              x1={g.position} y1={0}
              x2={g.position} y2={scene.height}
              stroke="#22D3EE"
              strokeWidth={1 / viewport.zoom}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : (
            <line
              key={i}
              x1={0} y1={g.position}
              x2={scene.width} y2={g.position}
              stroke="#22D3EE"
              strokeWidth={1 / viewport.zoom}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ),
        )}
        {/* Safe-area overlay — toggled with S key. 5% inset on each side
            matches the typical 90% title-safe area for social platforms. */}
        {showSafeArea && (
          <rect
            x={scene.width * 0.05}
            y={scene.height * 0.05}
            width={scene.width * 0.9}
            height={scene.height * 0.9}
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1 / viewport.zoom}
            strokeDasharray="6 3"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
    {scene.layers.length === 0 && onOpenInsert && (
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-50">
        <div className="bg-surface/90 backdrop-blur border border-border rounded-xl shadow-2xl p-8 flex flex-col items-center text-center pointer-events-auto max-w-sm">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4 text-accent">
            <Square size={24} />
          </div>
          <h3 className="text-lg font-semibold text-text mb-2">Blank Canvas</h3>
          <p className="text-sm text-text-muted mb-6">
            Your scene is empty. Add a shape, write some text, or import media to start building your animation.
          </p>
          <button
            type="button"
            onClick={onOpenInsert}
            className="flex items-center gap-2 bg-accent text-white rounded-md px-5 py-2.5 text-sm font-medium hover:opacity-90 shadow-sm transition-transform hover:scale-105"
          >
            <Plus size={16} />
            Add First Layer
          </button>
        </div>
      </div>
    )}
    </div>
  );
}
