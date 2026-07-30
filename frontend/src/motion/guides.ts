import type { Transform } from "../types/motion";

export interface GuideLine {
  axis: "horizontal" | "vertical";
  position: number;
}

export interface DragSnapResult {
  x: number;
  y: number;
  guides: GuideLine[];
}

export interface ResizeSnapResult {
  x: number;
  y: number;
  width: number;
  height: number;
  guides: GuideLine[];
}

/** Build X and Y snap targets from scene edges/centre, other layers'
 *  bounding-box edges/centres, and (optionally) grid lines. Omits the
 *  currently dragged/resized layer (the caller passes `otherTransforms`
 *  which excludes it). */
function buildSnapTargets(
  sceneW: number,
  sceneH: number,
  otherTransforms: { x: number; y: number; width: number; height: number }[],
  gridSize?: number,
): { xTargets: number[]; yTargets: number[] } {
  const xTargets = [0, sceneW / 2, sceneW];
  const yTargets = [0, sceneH / 2, sceneH];
  for (const t of otherTransforms) {
    xTargets.push(t.x, t.x + t.width / 2, t.x + t.width);
    yTargets.push(t.y, t.y + t.height / 2, t.y + t.height);
  }
  if (gridSize && gridSize > 0) {
    for (let x = gridSize; x < sceneW; x += gridSize) {
      xTargets.push(x);
    }
    for (let y = gridSize; y < sceneH; y += gridSize) {
      yTargets.push(y);
    }
  }
  return { xTargets, yTargets };
}

/** Snap a single value: check candidate[] against targets[], return the
 *  snapped value (adjusted by the best match's delta) plus the active
 *  target position for guide rendering, or null if nothing is close. */
function snapValue(
  value: number,
  candidates: number[],
  targets: number[],
  threshold: number,
): { snapped: number; activeTarget: number | null } {
  let bestDelta = threshold + 1;
  let bestTarget: number | null = null;
  let bestCandidate: number | null = null;

  for (const c of candidates) {
    for (const t of targets) {
      const d = Math.abs(t - c);
      if (d < bestDelta) {
        bestDelta = d;
        bestTarget = t;
        bestCandidate = c;
      }
    }
  }

  if (bestTarget !== null && bestDelta <= threshold) {
    return { snapped: value + (bestTarget - bestCandidate!), activeTarget: bestTarget };
  }
  return { snapped: value, activeTarget: null };
}

/** Snap a layer position during a drag (x/y move). Returns the snapped
 *  position and the guide lines to draw. */
export function computeDragSnap(
  x: number,
  y: number,
  w: number,
  h: number,
  sceneW: number,
  sceneH: number,
  otherTransforms: { x: number; y: number; width: number; height: number }[],
  threshold: number,
  suppress: boolean,
  gridSize?: number,
): DragSnapResult {
  if (suppress) return { x, y, guides: [] };

  const { xTargets, yTargets } = buildSnapTargets(sceneW, sceneH, otherTransforms, gridSize);
  const guides: GuideLine[] = [];

  const xSnap = snapValue(x, [x, x + w / 2, x + w], xTargets, threshold);
  if (xSnap.activeTarget !== null) {
    guides.push({ axis: "vertical", position: xSnap.activeTarget });
  }

  const ySnap = snapValue(y, [y, y + h / 2, y + h], yTargets, threshold);
  if (ySnap.activeTarget !== null) {
    guides.push({ axis: "horizontal", position: ySnap.activeTarget });
  }

  return { x: xSnap.snapped, y: ySnap.snapped, guides };
}

/** Snap edges during a resize. Each handle anchors two edges (they stay
 *  fixed) and moves the other two. Returns the snapped transform with MIN=8
 *  enforced on all final width/height, plus guide lines to draw. */
export function computeResizeSnap(
  handle: "nw" | "ne" | "sw" | "se",
  start: Transform,
  dx: number,
  dy: number,
  sceneW: number,
  sceneH: number,
  otherTransforms: { x: number; y: number; width: number; height: number }[],
  threshold: number,
  suppress: boolean,
  gridSize?: number,
): ResizeSnapResult {
  const MIN = 8;
  if (suppress) {
    // Return raw unsnapped result (with MIN clamping)
    const raw = computeUnsnappedResize(handle, start, dx, dy);
    return {
      x: raw.x, y: raw.y,
      width: Math.max(MIN, raw.width),
      height: Math.max(MIN, raw.height),
      guides: [],
    };
  }

  const { xTargets, yTargets } = buildSnapTargets(sceneW, sceneH, otherTransforms, gridSize);
  const guides: GuideLine[] = [];

  // Which edges are anchored (don't move)?
  const anchorLeft   = handle === "ne" || handle === "se";
  const anchorTop    = handle === "sw" || handle === "se";
  const anchorRight  = handle === "nw" || handle === "sw";
  const anchorBottom = handle === "nw" || handle === "ne";

  // Raw moving-edge positions
  const rawLeft   = start.x + dx;
  const rawRight  = start.x + start.width + dx;
  const rawTop    = start.y + dy;
  const rawBottom = start.y + start.height + dy;

  // Resolve each edge: anchored → fixed, otherwise snapValue
  function resolve(snap: boolean, raw: number, fixed: number, axis: "x" | "y"): number {
    if (snap) return fixed;
    const result = snapValue(raw, [raw], axis === "x" ? xTargets : yTargets, threshold);
    if (result.activeTarget !== null) {
      guides.push({ axis: axis === "x" ? "vertical" : "horizontal", position: result.activeTarget });
    }
    return result.snapped;
  }

  const snapLeft   = resolve(anchorLeft,   rawLeft,   start.x,                "x");
  const snapRight  = resolve(anchorRight,  rawRight,  start.x + start.width,  "x");
  const snapTop    = resolve(anchorTop,    rawTop,    start.y,                "y");
  const snapBottom = resolve(anchorBottom, rawBottom, start.y + start.height, "y");

  return {
    x: snapLeft,
    y: snapTop,
    width:  Math.max(MIN, snapRight - snapLeft),
    height: Math.max(MIN, snapBottom - snapTop),
    guides,
  };
}

function computeUnsnappedResize(
  handle: "nw" | "ne" | "sw" | "se",
  start: Transform,
  dx: number,
  dy: number,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = start;
  if (handle === "se") {
    width  = start.width  + dx;
    height = start.height + dy;
  } else if (handle === "sw") {
    width  = start.width  - dx;
    height = start.height + dy;
    x = start.x + (start.width - width);
  } else if (handle === "ne") {
    width  = start.width  + dx;
    height = start.height - dy;
    y = start.y + (start.height - height);
  } else {
    width  = start.width  - dx;
    height = start.height - dy;
    x = start.x + (start.width - width);
    y = start.y + (start.height - height);
  }
  return { x, y, width, height };
}
