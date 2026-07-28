/**
 * Cursor & interaction animation factory functions for Motion Studio.
 *
 * Each factory builds a composition of existing rect/ellipse layers (same
 * shape as types/motion.ts's MotionLayer) anchored at the caller's (x, y).
 * The pattern mirrors layerFactory.ts's createLayer() and calloutFactory.ts's
 * callout factories — returns MotionLayer[] (a group) instead of one layer.
 * No new shapes; cursors are approximations drawn from primitive layers.
 *
 * These factories produce the static layer geometry only. The actual motion
 * (ripple expanding, typing-cursor blinking, pointer moving along a path)
 * is added later via the motion-presets / keyframe system, exactly as the
 * task scoped it ("animation comes later via presets").
 */

import type { MotionLayer } from "../../types/motion";
import { newId } from "../state";

// ---------------------------------------------------------------------------
// Local primitive helpers — same role as calloutFactory.ts's rectLayer /
// textLayer but factored per primitive type so the cursor factories below read
// cleanly. All coordinates are absolute, anchored at the cursor's (x, y).
// ---------------------------------------------------------------------------

interface RectOpts {
  width?: number;
  height?: number;
  fill?: string;
  fill_opacity?: number;
  stroke_color?: string;
  stroke_width?: number;
  corner_radius?: number;
  rotation?: number;
}

function rectLayer(x: number, y: number, name: string, opts: RectOpts = {}): MotionLayer {
  return {
    id: newId(),
    name,
    type: "rect",
    locked: false,
    hidden: false,
    rect: {
      fill: opts.fill ?? "#FFFFFF",
      corner_radius: opts.corner_radius ?? 0,
      stroke_color: opts.stroke_color ?? "#000000",
      stroke_width: opts.stroke_width ?? 0,
    },
    ellipse: null,
    text: null,
    image: null,
    video: null,
    keyframes: [],
    transform: {
      x,
      y,
      width: opts.width ?? 40,
      height: opts.height ?? 40,
      rotation: opts.rotation ?? 0,
      opacity: opts.fill_opacity ?? 1,
      blur: 0,
    },
  };
}

interface EllipseOpts {
  width?: number;
  height?: number;
  fill?: string;
  fill_opacity?: number;
  stroke_color?: string;
  stroke_width?: number;
}

function ellipseLayer(x: number, y: number, name: string, opts: EllipseOpts = {}): MotionLayer {
  return {
    id: newId(),
    name,
    type: "ellipse",
    locked: false,
    hidden: false,
    rect: null,
    ellipse: {
      fill: opts.fill ?? "#FFFFFF",
      stroke_color: opts.stroke_color ?? "#000000",
      stroke_width: opts.stroke_width ?? 0,
    },
    text: null,
    image: null,
    video: null,
    keyframes: [],
    transform: {
      x,
      y,
      width: opts.width ?? 40,
      height: opts.height ?? 40,
      rotation: 0,
      opacity: opts.fill_opacity ?? 1,
      blur: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Cursor factories. Each returns MotionLayer[] ordered back-to-front (so the
// last layer paints on top), anchored at the caller's (x, y). The task calls
// for: mouse pointer, click ripple, highlight ring, selection box, typing
// cursor.
// ---------------------------------------------------------------------------

const CURSOR_STROKE = "#111827";

/**
 * Mouse pointer — the classic arrow cursor. Approximated as a small shaft
 * rect rotated to form the pointing diagonal, plus a thin white border rect
 * slightly behind it for contrast against any background. Two layers, ordered
 * border → arrow so the crisp arrow sits on top.
 *
 * @param x pointer tip x (the hotspot)
 * @param y pointer tip y (the hotspot)
 * @param size overall pointer size in px (defaults to 32)
 */
export function mousePointer(x: number, y: number, size = 32): MotionLayer[] {
  // The pointer is roughly a 9:16 ratio diagonal wedge. We build it as a tall
  // thin rect and rotate it so its long edge reads as the cursor's left edge.
  const w = Math.round(size * 0.28);
  const h = Math.round(size * 0.88);

  // White outline (slightly larger, drawn first for the halo effect).
  const outline = rectLayer(x - 2, y - 2, "Pointer Outline", {
    width: w + 4,
    height: h + 4,
    fill: "#FFFFFF",
    stroke_color: CURSOR_STROKE,
    stroke_width: 2,
    corner_radius: 2,
    rotation: 35, // ~atan(9/16) → close to the standard arrow angle
  });

  // Solid black fill on top.
  const arrow = rectLayer(x, y, "Pointer", {
    width: w,
    height: h,
    fill: CURSOR_STROKE,
    corner_radius: 1,
    rotation: 35,
  });

  return [outline, arrow];
}

/**
 * Click ripple — an expanding circle that radiates outward from a click
 * point. Built as a single bordered ellipse (transparent fill) positioned at
 * the click point. The expansion animation is added later via presets — here
 * we just lay down the layer geometry at a default radius.
 *
 * @param x click center x
 * @param y click center y
 * @param radius ripple radius in px (defaults to 28)
 */
export function clickRipple(x: number, y: number, radius = 28): MotionLayer[] {
  const ripple = ellipseLayer(x - radius, y - radius, "Click Ripple", {
    width: radius * 2,
    height: radius * 2,
    fill: "#FFFFFF",
    fill_opacity: 0,
    stroke_color: "#4F46E5",
    stroke_width: 4,
  });
  return [ripple];
}

/**
 * Highlight ring — a bordered circle used to draw attention to a point or
 * small region. Thicker border than the ripple, solid accent color. Like the
 * ripple this is a single ellipse layer.
 *
 * @param x ring center x
 * @param y ring center y
 * @param radius ring radius in px (defaults to 40)
 */
export function highlightRing(x: number, y: number, radius = 40): MotionLayer[] {
  const ring = ellipseLayer(x - radius, y - radius, "Highlight Ring", {
    width: radius * 2,
    height: radius * 2,
    fill: "#FBBF24",
    fill_opacity: 0,
    stroke_color: "#FBBF24",
    stroke_width: 6,
  });
  return [ring];
}

/**
 * Selection box — a dashed-look bordered rect with no fill, used to mark a
 * rectangular selection region. corner_radius 0 keeps sharp corners. The
 * "dashed" look is approximated by alternating the stroke color along the
 * edge — but since our layer model carries a single stroke_color, we fake
 * dashes with a sequence of short stroke-only rects laid around the box's
 * perimeter. The whole group is one logical selection box.
 *
 * @param x box top-left x
 * @param y box top-left y
 * @param width box width (defaults to 200)
 * @param height box height (defaults to 120)
 * @param dashLen length of each dash segment (defaults to 12)
 * @param gapLen length of each gap (defaults to 8)
 */
export function selectionBox(
  x: number,
  y: number,
  width = 200,
  height = 120,
  dashLen = 12,
  gapLen = 8,
): MotionLayer[] {
  const stroke = "#4F46E5";
  const sw = 3; // visual stroke thickness via rect height
  const layers: MotionLayer[] = [];
  const step = dashLen + gapLen;

  // top and bottom edges run horizontally
  for (let cx = 0; cx < width; cx += step) {
    const segW = Math.min(dashLen, width - cx);
    if (segW <= 0) break;
    layers.push(
      rectLayer(x + cx, y, "Selection Dash Top", {
        width: segW,
        height: sw,
        fill: stroke,
        corner_radius: 0,
      }),
    );
    layers.push(
      rectLayer(x + cx, y + height - sw, "Selection Dash Bottom", {
        width: segW,
        height: sw,
        fill: stroke,
        corner_radius: 0,
      }),
    );
  }
  // left and right edges run vertically
  for (let cy = 0; cy < height; cy += step) {
    const segH = Math.min(dashLen, height - cy);
    if (segH <= 0) break;
    layers.push(
      rectLayer(x, y + cy, "Selection Dash Left", {
        width: sw,
        height: segH,
        fill: stroke,
        corner_radius: 0,
      }),
    );
    layers.push(
      rectLayer(x + width - sw, y + cy, "Selection Dash Right", {
        width: sw,
        height: segH,
        fill: stroke,
        corner_radius: 0,
      }),
    );
  }
  return layers;
}

/**
 * Typing cursor — a thin blinking vertical bar (the text caret). Built as a
 * single tall thin rect. The blink animation is added later via presets; here
 * we just lay down the bar at full opacity.
 *
 * @param x bar left x
 * @param y bar top y
 * @param width bar width in px (defaults to 3)
 * @param height bar height in px (defaults to 36)
 */
export function typingCursor(x: number, y: number, width = 3, height = 36): MotionLayer[] {
  const bar = rectLayer(x, y, "Typing Cursor", {
    width,
    height,
    fill: "#111827",
    corner_radius: 0,
  });
  return [bar];
}

// ---------------------------------------------------------------------------
// Catalog of every cursor the picker exposes. Mirrors calloutFactory.ts's
// CALLOUT_DEFINITIONS so CursorPicker.tsx can iterate it the same way
// CalloutPicker.tsx iterates CALLOUT_DEFINITIONS.
// ---------------------------------------------------------------------------

export interface CursorDef {
  id: string;
  label: string;
  build: (x: number, y: number) => MotionLayer[];
  /** Simple inline preview string (an emoji/glyph matching CalloutPicker). */
  preview: string;
}

export const CURSOR_DEFINITIONS: CursorDef[] = [
  { id: "pointer", label: "Pointer", build: mousePointer, preview: "➜" },
  { id: "ripple", label: "Click Ripple", build: clickRipple, preview: "◎" },
  { id: "ring", label: "Highlight Ring", build: highlightRing, preview: "○" },
  { id: "selection", label: "Selection Box", build: selectionBox, preview: "⬚" },
  { id: "typing", label: "Typing Cursor", build: typingCursor, preview: "ⓘ" },
];
