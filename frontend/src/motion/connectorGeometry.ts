import type { MotionConnector, MotionLayer, Transform } from "../types/motion";
import { resolveTransformAtTime } from "./easing";
import type { ConnectorPoint } from "./connector/ConnectorTypes";

/** Why this file is separate from types/motion.ts: the helper needs
 *  resolveTransformAtTime from easing.ts, and easing.ts imports type-only
 *  from types/motion.ts. Putting this in types/motion.ts would close a
 *  circular import (types/motion.ts -> easing.ts -> types/motion.ts). ES
 *  modules sometimes tolerate cycles and sometimes hand you an undefined
 *  at module-init time depending on evaluation order — works in dev, breaks
 *  in the production bundle. Keeping this in its own file makes the
 *  dependency one-way: connectorGeometry.ts -> { types/motion.ts, easing.ts }.
 *
 *  Why resolve from a layer list and time, instead of taking absolute
 *  points: the spec is explicit ("connections automatically follow objects
 *  when moved"). Resolving the endpoints fresh at draw time from the
 *  source/target layer's current transform means any move/resize/animate
 *  just works, with no sync plumbing, no "listen to layer moves" wiring.
 *
 *  Returns null when either endpoint's layer is missing (it was deleted,
 *  or a stale project references a layer id no longer there). The renderer
 *  should skip the connector entirely in that case — a deleted layer
 *  silently dropping its connectors is the right behaviour, not a 500. */

export interface ResolvedEndpoints {
  source: ConnectorPoint;
  target: ConnectorPoint;
}

/** Point on a layer's axis-aligned bounding box for the requested anchor.
 *  Computed in the layer's LOCAL space — the caller will translate the
 *  whole <g> later, same as RenderFrame does for shapes. Center is the
 *  midpoint of the box; top/right/bottom/left are the midpoints of those
 *  edges. We don't account for rotation: the box is the layer's unrotated
 *  bounding box, so a 45°-rotated rect's "right" anchor is the right edge
 *  midpoint of its unrotated box, which then rotates with the layer when
 *  the <g> transform applies. v1 ships "center" only; sides are modelled
 *  for the future but no UI creates them yet. */
function anchorPoint(t: Transform, anchor: "center" | "top" | "right" | "bottom" | "left"): ConnectorPoint {
  switch (anchor) {
    case "center":
      return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    case "top":
      return { x: t.x + t.width / 2, y: t.y };
    case "right":
      return { x: t.x + t.width, y: t.y + t.height / 2 };
    case "bottom":
      return { x: t.x + t.width / 2, y: t.y + t.height };
    case "left":
      return { x: t.x, y: t.y + t.height / 2 };
  }
}

/** Resolve a connector's source/target endpoints to concrete scene-space
 *  points at the given time, by looking up each layer in `layers` and
 *  resolving its transform at `timeMs` through its keyframes (via the
 *  existing resolveTransformAtTime in easing.ts). Returns null if either
 *  layer id is missing — the caller skips rendering. */
export function resolveConnectorEndpoints(
  connector: MotionConnector,
  layers: MotionLayer[],
  timeMs: number,
): ResolvedEndpoints | null {
  const sourceLayer = layers.find((l) => l.id === connector.source.layer_id);
  const targetLayer = layers.find((l) => l.id === connector.target.layer_id);
  if (!sourceLayer || !targetLayer) return null;

  const sourceTransform = resolveTransformAtTime(sourceLayer, timeMs);
  const targetTransform = resolveTransformAtTime(targetLayer, timeMs);

  return {
    source: anchorPoint(sourceTransform, connector.source.anchor),
    target: anchorPoint(targetTransform, connector.target.anchor),
  };
}
