/**
 * Alignment & distribution functions for Motion Studio layer selections.
 *
 * Pure transformations: take an array of `Transform` objects in, return a new
 * array with x/y/width/height adjusted so layers line up against the bounding
 * box of the whole selection (no React, no editor state — caller handles
 * dispatching the result into the reducer).
 *
 * The input mirrors `types/motion.ts`'s `Transform` shape (x/y/width/height/
 * rotation/opacity). Width/height/rotation/opacity are passed through
 * unchanged so callers can do `state.layers.map((l) => ({ ...l, transform:
 * result[idx] }))` without losing those properties.
 */

import type { Transform } from "../../types/motion";

/**
 * Bounding box of the entire selection. Important note: the editor canvas
 * uses absolute (post-transform) coords, so we line up by x/y/width/height
 * directly — no need to apply rotation when computing the box here (rotation
 * only affects visual drawing, not the layout coordinate we align against).
 */
function selectionBounds(transforms: Transform[]): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
} | null {
  if (transforms.length === 0) return null;
  let left = transforms[0].x;
  let right = transforms[0].x + transforms[0].width;
  let top = transforms[0].y;
  let bottom = transforms[0].y + transforms[0].height;
  for (let i = 1; i < transforms.length; i++) {
    const t = transforms[i];
    left = Math.min(left, t.x);
    top = Math.min(top, t.y);
    right = Math.max(right, t.x + t.width);
    bottom = Math.max(bottom, t.y + t.height);
  }
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function clone(t: Transform): Transform {
  return { ...t };
}

/** No-op: returns the same transforms if the selection is empty or has a
 * single item (there's nothing meaningful to align against). */
function passthrough(transforms: Transform[]): Transform[] {
  return transforms.map(clone);
}

/**
 * Move every layer so its left edge lines up against the left edge of the
 * selection's bounding box. No-op for selections under 2 layers (matches
 * Figma/Sketch behavior — there's nothing to align "against").
 */
export function alignLeft(transforms: Transform[]): Transform[] {
  if (transforms.length < 2) return passthrough(transforms);
  const bounds = selectionBounds(transforms);
  if (!bounds) return passthrough(transforms);
  return transforms.map((t) => ({ ...clone(t), x: bounds.left }));
}

/** Center every layer horizontally against the bounding-box midpoint. */
export function alignCenterH(transforms: Transform[]): Transform[] {
  if (transforms.length < 2) return passthrough(transforms);
  const bounds = selectionBounds(transforms);
  if (!bounds) return passthrough(transforms);
  return transforms.map((t) => ({
    ...clone(t),
    x: bounds.centerX - t.width / 2,
  }));
}

/** Move every layer so its right edge lines up against the right edge of the
 * selection's bounding box. */
export function alignRight(transforms: Transform[]): Transform[] {
  if (transforms.length < 2) return passthrough(transforms);
  const bounds = selectionBounds(transforms);
  if (!bounds) return passthrough(transforms);
  return transforms.map((t) => ({ ...clone(t), x: bounds.right - t.width }));
}

/** Move every layer so its top edge lines up against the top edge of the
 * selection's bounding box. */
export function alignTop(transforms: Transform[]): Transform[] {
  if (transforms.length < 2) return passthrough(transforms);
  const bounds = selectionBounds(transforms);
  if (!bounds) return passthrough(transforms);
  return transforms.map((t) => ({ ...clone(t), y: bounds.top }));
}

/** Center every layer vertically against the bounding-box midpoint. */
export function alignCenterV(transforms: Transform[]): Transform[] {
  if (transforms.length < 2) return passthrough(transforms);
  const bounds = selectionBounds(transforms);
  if (!bounds) return passthrough(transforms);
  return transforms.map((t) => ({
    ...clone(t),
    y: bounds.centerY - t.height / 2,
  }));
}

/** Move every layer so its bottom edge lines up against the bottom edge of
 * the selection's bounding box. */
export function alignBottom(transforms: Transform[]): Transform[] {
  if (transforms.length < 2) return passthrough(transforms);
  const bounds = selectionBounds(transforms);
  if (!bounds) return passthrough(transforms);
  return transforms.map((t) => ({ ...clone(t), y: bounds.bottom - t.height }));
}

/**
 * Evenly distribute 3+ layers horizontally between the leftmost and
 * rightmost layers, preserving the extremes. Layers between the two extremes
 * are placed at evenly-spaced x values such that the gap between consecutive
 * layers' x positions is equal.
 *
 * For 2 layers there's no "between" — return unchanged. For 1 or 0 layers
 * there's nothing to distribute — return unchanged.
 */
export function distributeHorizontally(transforms: Transform[]): Transform[] {
  if (transforms.length < 3) return passthrough(transforms);

  // Sort by current x so we can drop evenly-spaced entries in between,
  // keeping the leftmost and rightmost layers pinned at their original x.
  const sorted = transforms
    .map((t, originalIndex) => ({ t, originalIndex }))
    .sort((a, b) => a.t.x - b.t.x);

  const left = sorted[0].t.x;
  const right = sorted[sorted.length - 1].t.x;
  const span = right - left;
  const step = span / (sorted.length - 1);

  const newXs = sorted.map((_, i) => left + step * i);

  const result = transforms.map(clone);
  sorted.forEach((entry, i) => {
    result[entry.originalIndex] = { ...result[entry.originalIndex], x: newXs[i] };
  });
  return result;
}

/**
 * Evenly distribute 3+ layers vertically between the topmost and bottommost
 * layers, preserving the extremes. Mirrors distributeHorizontally for y.
 */
export function distributeVertically(transforms: Transform[]): Transform[] {
  if (transforms.length < 3) return passthrough(transforms);

  const sorted = transforms
    .map((t, originalIndex) => ({ t, originalIndex }))
    .sort((a, b) => a.t.y - b.t.y);

  const top = sorted[0].t.y;
  const bottom = sorted[sorted.length - 1].t.y;
  const span = bottom - top;
  const step = span / (sorted.length - 1);

  const newYs = sorted.map((_, i) => top + step * i);

  const result = transforms.map(clone);
  sorted.forEach((entry, i) => {
    result[entry.originalIndex] = { ...result[entry.originalIndex], y: newYs[i] };
  });
  return result;
}

/**
 * Map of alignment kind id → function. The toolbar uses these ids in
 * onAlign(kind) callbacks so callers don't need to import every function
 * individually.
 */
export const ALIGN_OPERATIONS: { [k: string]: (t: Transform[]) => Transform[] } = {
  "align-left": alignLeft,
  "align-center-h": alignCenterH,
  "align-right": alignRight,
  "align-top": alignTop,
  "align-center-v": alignCenterV,
  "align-bottom": alignBottom,
  "distribute-h": distributeHorizontally,
  "distribute-v": distributeVertically,
};

export type AlignKind =
  | "align-left"
  | "align-center-h"
  | "align-right"
  | "align-top"
  | "align-center-v"
  | "align-bottom"
  | "distribute-h"
  | "distribute-v";

/** Entry the toolbar iterates over to render its buttons. */
export interface AlignDef {
  id: AlignKind;
  label: string;
  iconName:
    | "AlignLeft"
    | "AlignCenterHorizontal"
    | "AlignRight"
    | "AlignStartVertical"
    | "AlignCenterVertical"
    | "AlignEndVertical"
    | "AlignVerticalJustifyCenter"
    | "AlignHorizontalJustifyCenter";
}

export const ALIGN_DEFINITIONS: AlignDef[] = [
  { id: "align-left", label: "Align left", iconName: "AlignLeft" },
  { id: "align-center-h", label: "Center horizontally", iconName: "AlignCenterHorizontal" },
  { id: "align-right", label: "Align right", iconName: "AlignRight" },
  { id: "align-top", label: "Align top", iconName: "AlignStartVertical" },
  { id: "align-center-v", label: "Center vertically", iconName: "AlignCenterVertical" },
  { id: "align-bottom", label: "Align bottom", iconName: "AlignEndVertical" },
  { id: "distribute-h", label: "Distribute horizontally", iconName: "AlignHorizontalJustifyCenter" },
  { id: "distribute-v", label: "Distribute vertically", iconName: "AlignVerticalJustifyCenter" },
];
