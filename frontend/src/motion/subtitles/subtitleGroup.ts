/**
 * "Layers from the same subtitle import" — tagged in `layer.name`, not a
 * model field and not `parent_id`.
 *
 * `parent_id` looked like the obvious mechanism (folders already exist as a
 * concept) until reading layerTree.ts and state.ts's DELETE_SELECTED_LAYERS:
 * the deletion cascade (`getDescendants`) walks `parent_id` with NO
 * `is_folder` gate, so pointing every caption at a shared parent would mean
 * deleting one caption silently deletes the other 39 — a real trap, not a
 * hypothetical one. `is_folder` also doesn't stop a layer from drawing its
 * own shape in any of the three renderers, so there is no invisible
 * container to put captions "inside" today.
 *
 * A name suffix has none of that risk: it's inert to every existing reducer
 * case, survives the API round trip because `name` already does, and is
 * visible in the layer panel and in raw project JSON if anyone has to
 * debug it by hand.
 */

import type { MotionLayer } from "../../types/motion";

const TAG_RE = / · cc:([0-9a-f-]{6,})$/i;

/** Append (or replace) the group tag on a label. */
export function withGroupTag(label: string, groupId: string): string {
  return `${stripGroupTag(label)} · cc:${groupId}`;
}

/** The label with any existing group tag removed — for display, or before
 *  re-tagging. */
export function stripGroupTag(name: string): string {
  return name.replace(TAG_RE, "");
}

/** The shared import id a layer's name carries, or null if it isn't a
 *  subtitle-import layer. */
export function groupIdOf(layer: MotionLayer): string | null {
  const m = TAG_RE.exec(layer.name);
  return m ? m[1] : null;
}

export function isSubtitleGroupLayer(layer: MotionLayer): boolean {
  return groupIdOf(layer) !== null;
}

/** Every layer (including `layer` itself) that carries the same group tag,
 *  in scene order. Empty for a layer with no tag. */
export function siblingsOf(layer: MotionLayer, allLayers: MotionLayer[]): MotionLayer[] {
  const gid = groupIdOf(layer);
  if (!gid) return [];
  return allLayers.filter((l) => groupIdOf(l) === gid);
}
