/**
 * Callout & annotation factory functions for Motion Studio.
 *
 * Each factory builds a composition of existing rect/ellipse/text layers
 * (same shape as types/motion.ts's MotionLayer) anchored at the caller's
 * (x, y). The pattern mirrors layerFactory.ts's createLayer() but returns
 * MotionLayer[] (a group) instead of one. No new shapes, no special masking —
 * callouts are approximations drawn from primitive layers.
 */

import type { MotionLayer } from "../../types/motion";
import { newId } from "../state";

interface CalloutRectOptions {
  width?: number;
  height?: number;
  fill?: string;
  fill_opacity?: number;
  stroke_color?: string;
  stroke_width?: number;
  corner_radius?: number;
  text?: string;
  text_color?: string;
  font_size?: number;
}

function rectLayer(x: number, y: number, opts: CalloutRectOptions = {}): MotionLayer {
  return {
    id: newId(),
    name: "Callout",
    type: "rect",
    locked: false,
    hidden: false,
    rect: {
      fill: opts.fill ?? "#4F46E5",
      corner_radius: opts.corner_radius ?? 8,
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
      width: opts.width ?? 200,
      height: opts.height ?? 80,
      rotation: 0,
      opacity: opts.fill_opacity ?? 1,
    },
  };
}

function textLayer(
  x: number,
  y: number,
  text: string,
  opts: { color?: string; font_size?: number; width?: number; height?: number; align?: "left" | "center" | "right" } = {},
): MotionLayer {
  return {
    id: newId(),
    name: "Callout Text",
    type: "text",
    locked: false,
    hidden: false,
    rect: null,
    ellipse: null,
    text: {
      text,
      font_family: "Inter, Arial, sans-serif",
      font_size: opts.font_size ?? 24,
      font_weight: 600,
      color: opts.color ?? "#FFFFFF",
      align: opts.align ?? "center",
    },
    image: null,
    video: null,
    keyframes: [],
    transform: {
      x,
      y,
      width: opts.width ?? 200,
      height: opts.height ?? 60,
      rotation: 0,
      opacity: 1,
    },
  };
}

/**
 * Spotlight: a dimmed overlay covering the canvas with a highlight ring
 * drawing attention to a focused area. Approximated as a semi-transparent
 * dark rect plus a bordered highlight rect on top (no real masking).
 *
 * @param x spotlight center x
 * @param y spotlight center y
 * @param width total overlay width (defaults to 800)
 * @param height total overlay height (defaults to 450)
 * @param focusW focus region width
 * @param focusH focus region height
 */
export function spotlightCallout(
  x: number,
  y: number,
  width = 800,
  height = 450,
  focusW = 200,
  focusH = 120,
): MotionLayer[] {
  const overlay = rectLayer(x, y, {
    width,
    height,
    fill: "#000000",
    fill_opacity: 0.5,
    corner_radius: 0,
  });
  overlay.name = "Spotlight Overlay";

  const fx = x + (width - focusW) / 2;
  const fy = y + (height - focusH) / 2;
  const highlight = rectLayer(fx, fy, {
    width: focusW,
    height: focusH,
    fill: "#000000",
    fill_opacity: 0, // transparent fill — the highlight is the border
    stroke_color: "#FFFFFF",
    stroke_width: 4,
    corner_radius: 8,
  });
  highlight.name = "Spotlight Highlight";

  return [overlay, highlight];
}

/**
 * Arrow callout: a horizontal line ending in a small triangle (approximated
 * with a rotated square rect). The arrow points right by default; rotation
 * can be flipped via the `flip` option.
 */
export function arrowCallout(x: number, y: number, length = 200): MotionLayer[] {
  const shaft = rectLayer(x, y, {
    width: length - 24,
    height: 6,
    fill: "#FFFFFF",
    stroke_color: "#000000",
    stroke_width: 0,
    corner_radius: 3,
  });
  shaft.name = "Arrow Shaft";

  const head = rectLayer(x + length - 24, y - 6, {
    width: 24,
    height: 18,
    fill: "#FFFFFF",
    corner_radius: 2,
  });
  // 45° rotation so the rect reads as a triangle-ish arrowhead.
  head.transform.rotation = 45;
  head.name = "Arrow Head";

  return [shaft, head];
}

/**
 * Highlight box: a bordered rect that frames a region. Fill stays transparent
 * so the underlying content shows through.
 */
export function highlightBox(x: number, y: number, width = 300, height = 100): MotionLayer[] {
  const box = rectLayer(x, y, {
    width,
    height,
    fill: "#000000",
    fill_opacity: 0,
    stroke_color: "#FBBF24",
    stroke_width: 4,
    corner_radius: 4,
  });
  box.name = "Highlight Box";
  return [box];
}

/**
 * Underline: a thin colored bar drawn under text. Positioned just below the
 * given (x, y). Defaults to a width of 200 and a height of 6.
 */
export function underline(x: number, y: number, width = 200, color = "#FBBF24"): MotionLayer[] {
  const line = rectLayer(x, y, {
    width,
    height: 6,
    fill: color,
    corner_radius: 3,
  });
  line.name = "Underline";
  return [line];
}

/**
 * Speech bubble: a rounded rect with a small rotated rect tail.
 * The tail is positioned at the bottom-left of the bubble and rotated 45°.
 */
export function speechBubble(x: number, y: number, text = "Speech", width = 240, height = 100): MotionLayer[] {
  const bubble = rectLayer(x, y, {
    width,
    height,
    fill: "#FFFFFF",
    corner_radius: 16,
  });
  bubble.name = "Speech Bubble";

  const textL = textLayer(x, y + (height - 60) / 2, text, {
    color: "#111827",
    width,
    height: 60,
    align: "center",
    font_size: 24,
  });
  textL.name = "Speech Bubble Text";

  // Tail: small rotated square sitting at the bottom-left of the bubble.
  const tail = rectLayer(x + 24, y + height - 8, {
    width: 18,
    height: 18,
    fill: "#FFFFFF",
    corner_radius: 2,
  });
  tail.transform.rotation = 45;
  tail.name = "Speech Bubble Tail";

  return [bubble, textL, tail];
}

/**
 * Sticky note: a colored rect with rotated text, plus a darker bottom
 * shadow strip for a subtle "stuck-on" feel.
 */
export function stickyNote(x: number, y: number, text = "Sticky note", width = 200, height = 200, color = "#FDE68A"): MotionLayer[] {
  const note = rectLayer(x, y, {
    width,
    height,
    fill: color,
    corner_radius: 2,
  });
  note.transform.rotation = -3; // slight tilt
  note.name = "Sticky Note";

  const shadow = rectLayer(x + 4, y + height - 8, {
    width,
    height: 8,
    fill: "#000000",
    fill_opacity: 0.15,
    corner_radius: 0,
  });
  shadow.transform.rotation = -3;
  shadow.name = "Sticky Note Shadow";

  const textL = textLayer(x + 16, y + 16, text, {
    color: "#111827",
    width: width - 32,
    height: height - 32,
    align: "left",
    font_size: 22,
  });
  textL.transform.rotation = -3;
  textL.name = "Sticky Note Text";

  return [note, shadow, textL];
}

/**
 * Catalog of every callout the picker exposes. Each entry describes how the
 * callout is rendered in the picker's preview tile.
 */
export interface CalloutDef {
  id: string;
  label: string;
  build: (x: number, y: number) => MotionLayer[];
  /** Simple inline preview string (e.g. an emoji or character). */
  preview: string;
}

export const CALLOUT_DEFINITIONS: CalloutDef[] = [
  { id: "spotlight", label: "Spotlight", build: spotlightCallout, preview: "◉" },
  { id: "arrow", label: "Arrow", build: arrowCallout, preview: "→" },
  { id: "highlight", label: "Highlight", build: highlightBox, preview: "▢" },
  { id: "underline", label: "Underline", build: underline, preview: "—" },
  { id: "speech", label: "Speech", build: speechBubble, preview: "💬" },
  { id: "sticky", label: "Sticky Note", build: stickyNote, preview: "📝" },
];