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

import { useRef, useState } from "react";
import type { MotionLayer, MotionScene, Transform } from "../types/motion";
import { VideoLayerView } from "./video/VideoLayerView";

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

export function MotionCanvas({
  scene,
  selectedLayerIds,
  onSelect,
  onMoveLayer,
  onResizeLayer,
  getTransform,
  playheadMs,
  isPlaying,
}: MotionCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 0.5 });
  const [dragPreview, setDragPreview] = useState<{ layerId: string; x: number; y: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<
    { layerId: string; x: number; y: number; width: number; height: number } | null
  >(null);
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragState = useRef<{
    layerId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
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
      const dx = (e.clientX - dragState.current.startClientX) / viewport.zoom;
      const dy = (e.clientY - dragState.current.startClientY) / viewport.zoom;
      setDragPreview({
        layerId: dragState.current.layerId,
        x: dragState.current.startX + dx,
        y: dragState.current.startY + dy,
      });
      return;
    }
    if (resizeState.current) {
      const { handle, start } = resizeState.current;
      const dx = (e.clientX - resizeState.current.startClientX) / viewport.zoom;
      const dy = (e.clientY - resizeState.current.startClientY) / viewport.zoom;
      const MIN = 8;
      let { x, y, width, height } = start;
      if (handle === "se") {
        width = Math.max(MIN, start.width + dx);
        height = Math.max(MIN, start.height + dy);
      } else if (handle === "sw") {
        width = Math.max(MIN, start.width - dx);
        height = Math.max(MIN, start.height + dy);
        x = start.x + (start.width - width);
      } else if (handle === "ne") {
        width = Math.max(MIN, start.width + dx);
        height = Math.max(MIN, start.height - dy);
        y = start.y + (start.height - height);
      } else {
        width = Math.max(MIN, start.width - dx);
        height = Math.max(MIN, start.height - dy);
        x = start.x + (start.width - width);
        y = start.y + (start.height - height);
      }
      setResizePreview({ layerId: resizeState.current.layerId, x, y, width, height });
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
          fill={layer.rect.fill}
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
          fill={layer.ellipse.fill}
          stroke={layer.ellipse.stroke_width > 0 ? layer.ellipse.stroke_color : "none"}
          strokeWidth={layer.ellipse.stroke_width}
        />
      );
    } else if (layer.type === "text" && layer.text) {
      const anchor = layer.text.align === "center" ? "middle" : layer.text.align === "right" ? "end" : "start";
      const anchorX = layer.text.align === "center" ? t.width / 2 : layer.text.align === "right" ? t.width : 0;
      shape = (
        <text
          x={anchorX}
          y={layer.text.font_size}
          textAnchor={anchor}
          fontFamily={layer.text.font_family}
          fontSize={layer.text.font_size}
          fontWeight={layer.text.font_weight}
          fill={layer.text.color}
        >
          {layer.text.text}
        </text>
      );
    } else if (layer.type === "image" && layer.image) {
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
    }

    return (
      <g
        key={layer.id}
        transform={groupTransform}
        opacity={t.opacity}
        onMouseDown={(e) => handleLayerMouseDown(e, layer)}
        style={{ cursor: layer.locked ? "not-allowed" : "move" }}
      >
        {shape}
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
    <svg
      ref={svgRef}
      className="w-full h-full bg-[#16161c]"
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
      </g>
    </svg>
  );
}
