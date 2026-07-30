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
import { VideoLayerView } from "./video/VideoLayerView";
import { resolveConnectorEndpoints } from "./connectorGeometry";
import { Connector } from "./connector/Connector";
import type { ConnectorSpec } from "./connector/ConnectorTypes";
import { computeDragSnap, computeResizeSnap } from "./guides";
import type { GuideLine } from "./guides";
import { colorGradeFilterId, isIdentityColorGrade, renderColorGradeFilter } from "./colorgrade/colorGrade";
import { blendStyle } from "./blend/blendMode";
import { applyMaskToLayer, isMaskLayer, renderMask } from "./mask/maskMode";
import { isEffectivelyHidden, isEffectivelyLocked } from "./layerTree";
import { resolveTransformAtTime } from "./easing";
import { renderTextLayer } from "./textpath/textPath";
import { computeMotionBlur, motionBlurFilterId, renderMotionBlurFilter } from "./motionblur/motionBlur";

type ResizeHandle = "nw" | "ne" | "sw" | "se";

const ONIONSKIN_FRAMES = 2;
const ONIONSKIN_STEP_MS = 1000 / 30;

interface MotionCanvasProps {
  scene: MotionScene;
  selectedLayerIds: string[];
  onSelect: (ids: string[]) => void;
  onMoveLayer: (layerId: string, x: number, y: number) => void;
  onMoveLayers?: (moves: Array<{ layerId: string; x: number; y: number }>) => void;
  onResizeLayer: (layerId: string, patch: Partial<Transform>) => void;
  onResizeLayers?: (moves: Array<{ layerId: string; patch: Partial<Transform> }>) => void;
  onRotateLayers?: (moves: Array<{ layerId: string; patch: Partial<Transform> }>) => void;
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

  /** Grid & rulers — editor-only overlays, owned by MotionEditor toolbar. */
  showGrid?: boolean;
  gridSize?: number;
  showRulers?: boolean;
  snapToGrid?: boolean;
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

/**
 * Per-layer gaussian blur <filter>. stdDeviation is blur/2 so the visual
 * radius matches the UI `blur` value in px. Applied only when t.blur > 0.
 * x/y/width/height are expanded to prevent clipping at the filter boundaries.
 */
function renderBlurFilter(layerId: string, blur: number): React.ReactNode {
  return (
    <filter id={`${layerId}-blur`} x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation={blur / 2} />
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

interface DragLayerItem {
  layerId: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

interface DragState {
  primaryLayerId: string;
  startClientX: number;
  startClientY: number;
  didMove: boolean;
  alreadySelectedOnMouseDown: boolean;
  layers: DragLayerItem[];
}

interface ResizeLayerItem {
  layerId: string;
  start: Transform;
}

interface ResizeState {
  primaryLayerId: string;
  handle: ResizeHandle;
  startClientX: number;
  startClientY: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  anchor: { x: number; y: number };
  layers: ResizeLayerItem[];
}

interface RotateLayerItem {
  layerId: string;
  start: Transform;
}

interface RotateState {
  startAngleRad: number;
  center: { x: number; y: number };
  layers: RotateLayerItem[];
}

export function MotionCanvas({
  scene,
  selectedLayerIds,
  onSelect,
  onMoveLayer,
  onMoveLayers,
  onResizeLayer,
  onResizeLayers,
  onRotateLayers,
  getTransform,
  playheadMs,
  isPlaying,
  connectMode = false,
  connectFromLayerId = null,
  onConnectPick,
  onOpenInsert,
  showGrid = false,
  gridSize = 20,
  showRulers = false,
  snapToGrid = false,
}: MotionCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 0.5 });
  const [dragPreview, setDragPreview] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [resizePreview, setResizePreview] = useState<
    Record<string, { x: number; y: number; width: number; height: number }> | null
  >(null);
  const [rotatePreview, setRotatePreview] = useState<
    Record<string, { x: number; y: number; rotation: number }> | null
  >(null);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [persistentGuides, setPersistentGuides] = useState<GuideLine[]>(() => {
    try {
      const raw = localStorage.getItem("motion_persistent_guides");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const guideCreateRef = useRef<{ axis: "horizontal" | "vertical"; scenePos: number } | null>(null);

  // Save persistent guides to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("motion_persistent_guides", JSON.stringify(persistentGuides));
  }, [persistentGuides]);

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
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const rotateState = useRef<RotateState | null>(null);

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
    // Check if click is on a ruler → start guide creation
    if (showRulers) {
      const rect = svgRef.current!.getBoundingClientRect();
      const svgX = e.clientX - rect.left;
      const svgY = e.clientY - rect.top;
      const sceneX = (svgX - viewport.x) / viewport.zoom;
      const sceneY = (svgY - viewport.y) / viewport.zoom;
      if (sceneY >= -20 && sceneY < 0 && sceneX >= 0 && sceneX <= scene.width) {
        e.stopPropagation();
        guideCreateRef.current = { axis: "vertical", scenePos: sceneX };
        return;
      }
      if (sceneX >= -20 && sceneX < 0 && sceneY >= 0 && sceneY <= scene.height) {
        e.stopPropagation();
        guideCreateRef.current = { axis: "horizontal", scenePos: sceneY };
        return;
      }
    }
    if (e.target === svgRef.current) onSelect([]);
  }

  function handleLayerMouseDown(e: React.MouseEvent, layer: MotionLayer) {
    if (isEffectivelyLocked(layer, scene.layers)) return;
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

    let targetIds: string[];
    if (alreadySelected && selectedLayerIds.length > 1) {
      targetIds = selectedLayerIds;
    } else {
      onSelect([layer.id]);
      targetIds = [layer.id];
    }

    const activeLayers = scene.layers.filter(
      (l) => targetIds.includes(l.id) && !isEffectivelyLocked(l, scene.layers),
    );

    if (activeLayers.length === 0) return;

    dragState.current = {
      primaryLayerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      didMove: false,
      alreadySelectedOnMouseDown: alreadySelected && selectedLayerIds.length > 1,
      layers: activeLayers.map((l) => {
        const t = getTransform(l);
        return {
          layerId: l.id,
          startX: t.x,
          startY: t.y,
          startWidth: t.width,
          startHeight: t.height,
        };
      }),
    };
  }

  function handleResizeMouseDown(e: React.MouseEvent, layer: MotionLayer, handle: ResizeHandle) {
    e.stopPropagation();

    let targetIds: string[];
    if (selectedLayerIds.includes(layer.id) && selectedLayerIds.length > 1) {
      targetIds = selectedLayerIds;
    } else {
      onSelect([layer.id]);
      targetIds = [layer.id];
    }

    const activeLayers = scene.layers.filter(
      (l) => targetIds.includes(l.id) && !isEffectivelyLocked(l, scene.layers),
    );

    if (activeLayers.length === 0) return;

    // Calculate group bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const layerItems: ResizeLayerItem[] = activeLayers.map((l) => {
      const t = getTransform(l);
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + t.width);
      maxY = Math.max(maxY, t.y + t.height);
      return { layerId: l.id, start: t };
    });

    const bounds = {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };

    // Determine fixed anchor point opposite to the handle
    let anchor = { x: minX, y: minY };
    if (handle === "nw") anchor = { x: maxX, y: maxY };
    else if (handle === "ne") anchor = { x: minX, y: maxY };
    else if (handle === "sw") anchor = { x: maxX, y: minY };
    else if (handle === "se") anchor = { x: minX, y: minY };

    resizeState.current = {
      primaryLayerId: layer.id,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      bounds,
      anchor,
      layers: layerItems,
    };
  }

  function handleRotateMouseDown(e: React.MouseEvent) {
    e.stopPropagation();

    const activeLayers = scene.layers.filter(
      (l) => selectedLayerIds.includes(l.id) && !isEffectivelyLocked(l, scene.layers),
    );
    if (activeLayers.length === 0) return;

    // Calculate group bounding box center
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const layerItems: RotateLayerItem[] = activeLayers.map((l) => {
      const t = getTransform(l);
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + t.width);
      maxY = Math.max(maxY, t.y + t.height);
      return { layerId: l.id, start: t };
    });

    const center = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };

    // Compute starting angle from center to mouse position in scene coordinates
    const rect = svgRef.current!.getBoundingClientRect();
    const mouseSceneX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
    const mouseSceneY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
    const startAngleRad = Math.atan2(mouseSceneY - center.y, mouseSceneX - center.x);

    rotateState.current = {
      startAngleRad,
      center,
      layers: layerItems,
    };
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (panState.current) {
      const dx = e.clientX - panState.current.startX;
      const dy = e.clientY - panState.current.startY;
      setViewport((v) => ({ ...v, x: panState.current!.originX + dx, y: panState.current!.originY + dy }));
      return;
    }
    if (guideCreateRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const svgX = e.clientX - rect.left;
      const svgY = e.clientY - rect.top;
      const sceneX = (svgX - viewport.x) / viewport.zoom;
      const sceneY = (svgY - viewport.y) / viewport.zoom;
      const gc = guideCreateRef.current;
      if (gc.axis === "vertical") {
        const pos = Math.max(0, Math.min(scene.width, sceneX));
        gc.scenePos = pos;
      } else {
        const pos = Math.max(0, Math.min(scene.height, sceneY));
        gc.scenePos = pos;
      }
      // Show a preview guide
      setGuides([{ axis: gc.axis, position: gc.scenePos }]);
      return;
    }
    if (dragState.current) {
      const ds = dragState.current;
      const clientDx = e.clientX - ds.startClientX;
      const clientDy = e.clientY - ds.startClientY;

      if (!ds.didMove && (Math.abs(clientDx) > 2 || Math.abs(clientDy) > 2)) {
        ds.didMove = true;
      }

      const dx = clientDx / viewport.zoom;
      const dy = clientDy / viewport.zoom;

      const primary = ds.layers.find((l) => l.layerId === ds.primaryLayerId) || ds.layers[0];
      const rawX = primary.startX + dx;
      const rawY = primary.startY + dy;
      const threshold = 8 / viewport.zoom;
      const draggedSet = new Set(ds.layers.map((l) => l.layerId));
      const otherTransforms = scene.layers
        .filter((l) => !draggedSet.has(l.id) && !l.hidden && isLayerVisibleAt(l, scene.duration_ms, playheadMs))
        .map((l) => getTransform(l));
      const snap = computeDragSnap(rawX, rawY, primary.startWidth, primary.startHeight, scene.width, scene.height, otherTransforms, threshold, e.altKey, snapToGrid ? gridSize : undefined);

      const effectiveDx = snap.x - primary.startX;
      const effectiveDy = snap.y - primary.startY;

      const nextPreviews: Record<string, { x: number; y: number }> = {};
      for (const item of ds.layers) {
        nextPreviews[item.layerId] = {
          x: item.startX + effectiveDx,
          y: item.startY + effectiveDy,
        };
      }

      setDragPreview(nextPreviews);
      setGuides(snap.guides);
      return;
    }
    if (resizeState.current) {
      const rs = resizeState.current;
      const clientDx = (e.clientX - rs.startClientX) / viewport.zoom;
      const clientDy = (e.clientY - rs.startClientY) / viewport.zoom;

      if (rs.layers.length === 1) {
        // Single-layer resize snap path
        const item = rs.layers[0];
        const threshold = 8 / viewport.zoom;
        const otherTransforms = scene.layers
          .filter((l) => l.id !== item.layerId && !l.hidden && isLayerVisibleAt(l, scene.duration_ms, playheadMs))
          .map((l) => getTransform(l));
        const snap = computeResizeSnap(rs.handle, item.start, clientDx, clientDy, scene.width, scene.height, otherTransforms, threshold, e.altKey, snapToGrid ? gridSize : undefined);
        setResizePreview({ [item.layerId]: { x: snap.x, y: snap.y, width: snap.width, height: snap.height } });
        setGuides(snap.guides);
        return;
      }

      // Multi-layer group resize: scale around fixed anchor
      let deltaW = 0;
      let deltaH = 0;
      if (rs.handle === "se") {
        deltaW = clientDx;
        deltaH = clientDy;
      } else if (rs.handle === "nw") {
        deltaW = -clientDx;
        deltaH = -clientDy;
      } else if (rs.handle === "ne") {
        deltaW = clientDx;
        deltaH = -clientDy;
      } else if (rs.handle === "sw") {
        deltaW = -clientDx;
        deltaH = clientDy;
      }

      const newGroupWidth = Math.max(10, rs.bounds.width + deltaW);
      const newGroupHeight = Math.max(10, rs.bounds.height + deltaH);

      const scaleX = newGroupWidth / rs.bounds.width;
      const scaleY = newGroupHeight / rs.bounds.height;

      const nextPreviews: Record<string, { x: number; y: number; width: number; height: number }> = {};

      for (const item of rs.layers) {
        const t = item.start;
        const relX = t.x - rs.anchor.x;
        const relY = t.y - rs.anchor.y;

        const newRelX = relX * scaleX;
        const newRelY = relY * scaleY;

        nextPreviews[item.layerId] = {
          x: rs.anchor.x + newRelX,
          y: rs.anchor.y + newRelY,
          width: Math.max(1, t.width * scaleX),
          height: Math.max(1, t.height * scaleY),
        };
      }

      setResizePreview(nextPreviews);
      setGuides([]);
    }
    if (rotateState.current) {
      const rots = rotateState.current;
      const rect = svgRef.current!.getBoundingClientRect();
      const mouseSceneX = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const mouseSceneY = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const currentAngle = Math.atan2(mouseSceneY - rots.center.y, mouseSceneX - rots.center.x);
      const deltaAngle = currentAngle - rots.startAngleRad;
      const deltaDeg = (deltaAngle * 180) / Math.PI;

      const nextPreviews: Record<string, { x: number; y: number; rotation: number }> = {};
      const cos = Math.cos(deltaAngle);
      const sin = Math.sin(deltaAngle);

      for (const item of rots.layers) {
        const t = item.start;
        // Rotate each layer's center around the group center
        const layerCenterX = t.x + t.width / 2;
        const layerCenterY = t.y + t.height / 2;
        const relX = layerCenterX - rots.center.x;
        const relY = layerCenterY - rots.center.y;
        const newRelX = relX * cos - relY * sin;
        const newRelY = relX * sin + relY * cos;
        const newCenterX = rots.center.x + newRelX;
        const newCenterY = rots.center.y + newRelY;

        nextPreviews[item.layerId] = {
          x: newCenterX - t.width / 2,
          y: newCenterY - t.height / 2,
          rotation: t.rotation + deltaDeg,
        };
      }

      setRotatePreview(nextPreviews);
    }
  }

  function handleMouseUp() {
    panState.current = null;
    if (guideCreateRef.current) {
      const gc = guideCreateRef.current;
      setPersistentGuides((prev) => {
        // Don't add if one already exists at almost the same position
        const exists = prev.some((g) => g.axis === gc.axis && Math.abs(g.position - gc.scenePos) < 2);
        if (exists) return prev;
        return [...prev, { axis: gc.axis, position: gc.scenePos }];
      });
      guideCreateRef.current = null;
      setGuides([]);
      return;
    }
    if (dragState.current) {
      const ds = dragState.current;
      if (dragPreview && ds.didMove) {
        const moves = ds.layers
          .filter((l) => dragPreview[l.layerId] !== undefined)
          .map((l) => ({
            layerId: l.layerId,
            x: dragPreview[l.layerId].x,
            y: dragPreview[l.layerId].y,
          }));

        if (moves.length > 0) {
          if (onMoveLayers) {
            onMoveLayers(moves);
          } else {
            moves.forEach((m) => onMoveLayer(m.layerId, m.x, m.y));
          }
        }
      } else if (!ds.didMove && ds.alreadySelectedOnMouseDown) {
        onSelect([ds.primaryLayerId]);
      }
    }
    if (resizeState.current && resizePreview) {
      const rs = resizeState.current;
      const moves = rs.layers
        .filter((l) => resizePreview[l.layerId] !== undefined)
        .map((l) => ({
          layerId: l.layerId,
          patch: resizePreview[l.layerId],
        }));

      if (moves.length > 0) {
        if (onResizeLayers) {
          onResizeLayers(moves);
        } else if (moves.length === 1) {
          onResizeLayer(moves[0].layerId, moves[0].patch);
        } else {
          moves.forEach((m) => onResizeLayer(m.layerId, m.patch));
        }
      }
    }
    if (rotateState.current && rotatePreview) {
      const rots = rotateState.current;
      const moves = rots.layers
        .filter((l) => rotatePreview[l.layerId] !== undefined)
        .map((l) => ({
          layerId: l.layerId,
          patch: rotatePreview[l.layerId] as Partial<Transform>,
        }));

      if (moves.length > 0) {
        if (onRotateLayers) {
          onRotateLayers(moves);
        } else {
          moves.forEach((m) => onResizeLayer(m.layerId, m.patch));
        }
      }
    }
    dragState.current = null;
    resizeState.current = null;
    rotateState.current = null;
    setDragPreview(null);
    setResizePreview(null);
    setRotatePreview(null);
    setGuides([]);
  }

  function layerTransform(layer: MotionLayer) {
    if (dragPreview?.[layer.id]) {
      return { ...getTransform(layer), x: dragPreview[layer.id].x, y: dragPreview[layer.id].y };
    }
    if (resizePreview?.[layer.id]) {
      return { ...getTransform(layer), ...resizePreview[layer.id] };
    }
    if (rotatePreview?.[layer.id]) {
      return { ...getTransform(layer), ...rotatePreview[layer.id] };
    }
    return getTransform(layer);
  }

  function renderLayer(layer: MotionLayer, index: number) {
    // Effective-hidden check walks the parent chain so hiding a folder
    // cascades to all descendants — same for all three renderers.
    if (isEffectivelyHidden(layer, scene.layers)) return null;
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
      shape = renderTextLayer({ layer, transform: t, resolveFill });
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
          visibleStartMs={layer.visible_start_ms ?? 0}
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

    // Order: grade, then blur, then shadow. Grade first so a colored layer's
    // shadow isn't itself tinted by the grade (feDropShadow's flood-color
    // draws from its input's alpha, not its color, but blurring an
    // already-graded shape vs. grading an already-blurred one can still
    // shift edge colors — putting grade innermost keeps this deterministic
    // and matches "adjust the source, then apply effects to the result").
    let filteredShape = shape;
    if (!isIdentityColorGrade(layer.color_grade)) {
      filteredShape = <g filter={`url(#${colorGradeFilterId(layer.id)})`}>{filteredShape}</g>;
    }
    if (t.blur > 0) {
      filteredShape = <g filter={`url(#${layer.id}-blur)`}>{filteredShape}</g>;
    }
    if (layer.shadow) {
      filteredShape = <g filter={`url(#${layer.id}-shadow)`}>{filteredShape}</g>;
    }
    const mb = computeMotionBlur(layer, playheadMs);
    if (mb) {
      filteredShape = <g filter={`url(#${motionBlurFilterId(layer.id)})`}>{filteredShape}</g>;
    }

    // LT-LAYERMASK: a layer flagged `is_mask` doesn't render visibly —
    // it emits ONLY the <mask> def that clips the layer beneath it. The
    // helper returns null for non-mask layers so this whole branch is a
    // no-op for existing projects (identity rule: byte-identical SVG).
    // Note: we use the RAW shape (`shape`, pre-grade/blur/shadow) so a
    // shadow extending beyond the mask shape doesn't drag the masked
    // region along with it — the mask is what the user drew, not the
    // visual effect stack on top of it.
    if (isMaskLayer(layer)) {
      return renderMask(layer, shape, t.width, t.height);
    }

    return (
      <g
        key={layer.id}
        transform={groupTransform}
        opacity={t.opacity}
        onMouseDown={(e) => handleLayerMouseDown(e, layer)}
        style={{ cursor: layer.locked ? "not-allowed" : "move", ...blendStyle(layer.blend_mode) }}
      >
        {applyMaskToLayer(scene.layers, index, filteredShape)}
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
        {/* Rotate handle: small circle above top-center */}
        {selected && !layer.locked && (
          <>
            {/* Line from top-center to rotate handle */}
            <line
              x1={t.width / 2}
              y1={0}
              x2={t.width / 2}
              y2={-24 / viewport.zoom}
              stroke="#6366F1"
              strokeWidth={1.5 / viewport.zoom}
              pointerEvents="none"
            />
            {/* Rotate handle circle */}
            <circle
              cx={t.width / 2}
              cy={-24 / viewport.zoom}
              r={5 / viewport.zoom}
              fill="#6366F1"
              stroke="#fff"
              strokeWidth={1.5 / viewport.zoom}
              style={{ cursor: "grab" }}
              onMouseDown={(e) => handleRotateMouseDown(e)}
            />
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
        {/* Per-layer gradient fills, shadow filters, and blur filters —
            emitted before the layer map is rendered so url(#id-fill) /
            url(#id-shadow) / url(#id-blur) resolve when each layer's shape
            is drawn. Layers without effects just don't appear here. */}
        {scene.layers.map((layer) => {
          const resolved = getTransform(layer);
          const mb = computeMotionBlur(layer, playheadMs);
          return (
            <Fragment key={`defs-${layer.id}`}>
              {layer.gradient ? renderGradientDef(layer.id, layer.gradient) : null}
              {layer.shadow ? renderShadowFilter(layer.id, layer.shadow) : null}
              {resolved.blur > 0 ? renderBlurFilter(layer.id, resolved.blur) : null}
              {!isIdentityColorGrade(layer.color_grade)
                ? renderColorGradeFilter(layer.id, layer.color_grade!)
                : null}
              {mb ? renderMotionBlurFilter(layer.id, mb.blurX, mb.blurY) : null}
            </Fragment>
          );
        })}
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
        {/* Grid overlay — editor-only, drawn above the scene bg but below
            layers so it serves as a positional reference without obscuring
            content. Structurally isolated from RenderFrame.tsx / SceneThumbnail.tsx
            (they don't use this component). */}
        {showGrid && gridSize > 0 && (
          <>
            {Array.from({ length: Math.ceil(scene.width / gridSize) - 1 }, (_, i) => {
              const x = (i + 1) * gridSize;
              return (
                <line key={`gv${x}`} x1={x} y1={0} x2={x} y2={scene.height}
                      stroke="rgba(100,100,180,0.12)" strokeWidth={1 / viewport.zoom}
                      vectorEffect="non-scaling-stroke" pointerEvents="none" />
              );
            })}
            {Array.from({ length: Math.ceil(scene.height / gridSize) - 1 }, (_, i) => {
              const y = (i + 1) * gridSize;
              return (
                <line key={`gh${y}`} x1={0} y1={y} x2={scene.width} y2={y}
                      stroke="rgba(100,100,180,0.12)" strokeWidth={1 / viewport.zoom}
                      vectorEffect="non-scaling-stroke" pointerEvents="none" />
              );
            })}
          </>
        )}
        {/* Rulers — editor-only, bars with tick marks at the top/left edges
            of the scene frame. Same structural guarantee as grid/onion skin. */}
        {showRulers && (
          <>
            {/* Top ruler bar */}
            <rect x={0} y={-20} width={scene.width} height={20}
                  fill="#1c1c24" stroke="#3a3a46" strokeWidth={1 / viewport.zoom}
                  pointerEvents="none" />
            {Array.from({ length: Math.ceil(scene.width / 100) + 1 }, (_, i) => {
              const x = i * 100;
              if (x > scene.width) return null;
              return (
                <g key={`rt${x}`} pointerEvents="none">
                  <line x1={x} y1={-20} x2={x} y2={-12}
                        stroke="#5a5a6a" strokeWidth={1 / viewport.zoom}
                        vectorEffect="non-scaling-stroke" />
                  <text x={x + 2} y={-5} fill="#7a7a8a" fontSize={9 / viewport.zoom}
                        fontFamily="monospace" vectorEffect="non-scaling-stroke">
                    {x}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: Math.ceil(scene.width / 20) + 1 }, (_, i) => {
              const x = i * 20;
              if (x % 100 === 0 || x > scene.width) return null;
              return (
                <line key={`rtm${x}`} x1={x} y1={-20} x2={x} y2={-16}
                      stroke="#3a3a4a" strokeWidth={1 / viewport.zoom}
                      vectorEffect="non-scaling-stroke" pointerEvents="none" />
              );
            })}
            {/* Left ruler bar */}
            <rect x={-20} y={0} width={20} height={scene.height}
                  fill="#1c1c24" stroke="#3a3a46" strokeWidth={1 / viewport.zoom}
                  pointerEvents="none" />
            {Array.from({ length: Math.ceil(scene.height / 100) + 1 }, (_, i) => {
              const y = i * 100;
              if (y > scene.height) return null;
              return (
                <g key={`rl${y}`} pointerEvents="none">
                  <line x1={-20} y1={y} x2={-12} y2={y}
                        stroke="#5a5a6a" strokeWidth={1 / viewport.zoom}
                        vectorEffect="non-scaling-stroke" />
                  <text x={-18} y={y + 3} fill="#7a7a8a" fontSize={9 / viewport.zoom}
                        fontFamily="monospace" vectorEffect="non-scaling-stroke">
                    {y}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: Math.ceil(scene.height / 20) + 1 }, (_, i) => {
              const y = i * 20;
              if (y % 100 === 0 || y > scene.height) return null;
              return (
                <line key={`rlm${y}`} x1={-20} y1={y} x2={-16} y2={y}
                      stroke="#3a3a4a" strokeWidth={1 / viewport.zoom}
                      vectorEffect="non-scaling-stroke" pointerEvents="none" />
              );
            })}
          </>
        )}
        {scene.layers.map((layer, idx) => renderLayer(layer, idx))}
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
        {/* Onionskin: ghosted outlines of the selected layer at ±N frames
            around the playhead so animators can see the motion arc while
            adjusting keyframes. Editor-canvas only — must NOT be rendered
            in RenderFrame.tsx or SceneThumbnail.tsx (they don't use this
            component; see both renderers use their own layer iteration). */}
        {selectedLayerIds.map((id) => {
          const layer = scene.layers.find((l) => l.id === id);
          if (!layer) return null;
          const lStart = layer.visible_start_ms ?? 0;
          const lEnd = layer.visible_end_ms ?? scene.duration_ms;
          const ghosts: React.ReactNode[] = [];
          for (let i = -ONIONSKIN_FRAMES; i <= ONIONSKIN_FRAMES; i++) {
            if (i === 0) continue;
            const ghostTime = playheadMs + i * ONIONSKIN_STEP_MS;
            if (ghostTime < lStart || ghostTime > lEnd) continue;
            const gt = resolveTransformAtTime(layer, ghostTime);
            const opacity = Math.max(0.05, 0.25 - Math.abs(i) * 0.08);
            ghosts.push(
              <g key={`${id}-onion-${i}`}
                 transform={`translate(${gt.x} ${gt.y}) rotate(${gt.rotation} ${gt.width / 2} ${gt.height / 2})`}
                 opacity={opacity}
                 pointerEvents="none"
              >
                <rect width={gt.width} height={gt.height}
                      fill="none" stroke="#22D3EE"
                      strokeWidth={2 / viewport.zoom}
                      vectorEffect="non-scaling-stroke" />
              </g>,
            );
          }
          return ghosts;
        })}
        {/* Persistent guide lines — user-placed from rulers. Same
            rendering as snap guides but in orange, and right-clicking
            one deletes it. Saved to localStorage across sessions. */}
        {persistentGuides.map((g, i) =>
          g.axis === "vertical" ? (
            <line key={`pg-${i}`}
              x1={g.position} y1={0} x2={g.position} y2={scene.height}
              stroke="#f59e0b" strokeWidth={1 / viewport.zoom}
              strokeDasharray="6 4" vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : (
            <line key={`pg-${i}`}
              x1={0} y1={g.position} x2={scene.width} y2={g.position}
              stroke="#f59e0b" strokeWidth={1 / viewport.zoom}
              strokeDasharray="6 4" vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ),
        )}
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
