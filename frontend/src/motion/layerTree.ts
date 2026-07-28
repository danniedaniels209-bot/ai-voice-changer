import type { MotionLayer } from "../types/motion";

/** Walk up the parent chain from `proposedParentId`. If any ancestor equals
 *  `layerId`, setting parent_id would create a cycle (or a self-parent), which
 *  causes every renderer to infinite-loop. Also rejects `proposedParentId`
 *  being an id that doesn't exist in the layer list. */
export function wouldCreateCycle(
  layers: MotionLayer[],
  layerId: string,
  proposedParentId: string | null,
): boolean {
  if (!proposedParentId) return false;
  const allIds = new Set(layers.map((l) => l.id));
  if (!allIds.has(proposedParentId)) return true; // parent doesn't exist
  if (proposedParentId === layerId) return true;  // self-parent

  let currentId: string | null = proposedParentId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === layerId) return true;
    if (visited.has(currentId)) return true; // shouldn't happen, but prevents inf-loop
    visited.add(currentId);
    const parent = layers.find((l) => l.id === currentId);
    currentId = parent?.parent_id ?? null;
  }
  return false;
}

/** Whether a layer is effectively hidden — either directly hidden or any
 *  ancestor in its parent chain is hidden. This is the check renderers use
 *  so that hiding a folder cascades to all its descendants without needing
 *  to mutate every child's `hidden` field. */
export function isEffectivelyHidden(layer: MotionLayer, layers: MotionLayer[]): boolean {
  if (layer.hidden) return true;
  if (!layer.parent_id) return false;
  let currentId: string | null = layer.parent_id;
  const visited = new Set<string>();
  while (currentId) {
    const ancestor = layers.find((l) => l.id === currentId);
    if (!ancestor) return false;
    if (ancestor.hidden) return true;
    if (visited.has(currentId)) return false; // cycle guard
    visited.add(currentId);
    currentId = ancestor.parent_id ?? null;
  }
  return false;
}

/** Whether a layer is effectively locked — either directly locked or any
 *  ancestor in its parent chain is locked. Used in MotionCanvas to prevent
 *  drag/move on children of a locked folder. */
export function isEffectivelyLocked(layer: MotionLayer, layers: MotionLayer[]): boolean {
  if (layer.locked) return true;
  if (!layer.parent_id) return false;
  let currentId: string | null = layer.parent_id;
  const visited = new Set<string>();
  while (currentId) {
    const ancestor = layers.find((l) => l.id === currentId);
    if (!ancestor) return false;
    if (ancestor.locked) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    currentId = ancestor.parent_id ?? null;
  }
  return false;
}

/** Recursively collect all descendant layer ids of `layerId` (direct children,
 *  grandchildren, etc.). Used for cascade deletion when a folder is removed. */
export function getDescendants(layerId: string, layers: MotionLayer[]): string[] {
  const result: string[] = [];
  const direct = layers.filter((l) => l.parent_id === layerId);
  for (const child of direct) {
    result.push(child.id);
    result.push(...getDescendants(child.id, layers));
  }
  return result;
}
