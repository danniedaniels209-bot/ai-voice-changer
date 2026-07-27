/**
 * Text reveal animation via composed layers.
 *
 * Per-character keyframe animation isn't supported by the engine yet (Keyframe
 * only animates Transform properties — not text content), so this module
 * builds the effect by composing one text layer per word and giving each
 * its own staggered opacity/y keyframes. The playback engine already
 * evaluates per-layer keyframes independently, so dropping N animated layers
 * produces a left-to-right reveal naturally.
 */

import type { Keyframe, MotionLayer, Transform } from "../../types/motion";
import { newId } from "../state";

export type TextFxStyle = "fade" | "slide-up";

export interface TextRevealOptions {
  font_size?: number;
  color?: string;
  stagger_ms?: number;
  style?: TextFxStyle;
  font_weight?: number;
  /** Per-word animation duration in ms (default 400). */
  word_duration_ms?: number;
}

const DEFAULTS = {
  font_size: 56,
  font_weight: 700,
  color: "#FFFFFF",
  stagger_ms: 120,
  word_duration_ms: 400,
  style: "fade" as TextFxStyle,
};

/**
 * Estimate the visual width of a word in pixels — rough approximation based
 * on the average character width of a sans-serif font at the given size.
 * 0.55 is the empirically-tuned fudge factor — close enough that words
 * visually line up; the editor lets the user nudge individual words later.
 */
function estimateWordWidth(word: string, fontSize: number): number {
  return Math.max(1, word.length) * fontSize * 0.55;
}

/** Space character width — slightly tighter than a regular letter. */
function estimateSpaceWidth(fontSize: number): number {
  return fontSize * 0.3;
}

function makeKeyframe(
  time_ms: number,
  property: keyof Transform,
  value: number,
  easing: Keyframe["easing"],
): Keyframe {
  return { id: newId(), time_ms, property, value, easing };
}

function makeWordLayer(
  word: string,
  x: number,
  y: number,
  fontSize: number,
  fontWeight: number,
  color: string,
  width: number,
): MotionLayer {
  return {
    id: newId(),
    name: `Word: ${word}`,
    type: "text",
    locked: false,
    hidden: false,
    rect: null,
    ellipse: null,
    text: {
      text: word,
      font_family: "Inter, Arial, sans-serif",
      font_size: fontSize,
      font_weight: fontWeight,
      color,
      align: "left",
    },
    image: null,
    video: null,
    keyframes: [],
    transform: {
      x,
      y,
      width,
      height: Math.round(fontSize * 1.2),
      rotation: 0,
      opacity: 1,
    },
  };
}

/**
 * Build a word-by-word text reveal. Splits the input on whitespace, creates
 * one text layer per word positioned left-to-right starting at (x, y), and
 * gives each word a staggered animation:
 *   - "fade": opacity 0 -> 1 over `word_duration_ms` starting at `i * stagger_ms`
 *   - "slide-up": y offset 60px -> 0 (and opacity 0 -> 1) over the same window
 *
 * Returns MotionLayer[] ready to append to a scene. Widths are estimated,
 * not pixel-perfect — see `estimateWordWidth`.
 */
export function buildWordReveal(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? DEFAULTS.stagger_ms;
  const wordDur = opts.word_duration_ms ?? DEFAULTS.word_duration_ms;
  const style: TextFxStyle = opts.style ?? DEFAULTS.style;

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const layers: MotionLayer[] = [];
  let cursorX = x;

  words.forEach((word, i) => {
    const wordWidth = estimateWordWidth(word, fontSize);
    const layer = makeWordLayer(
      word,
      cursorX,
      y,
      fontSize,
      fontWeight,
      color,
      Math.round(wordWidth),
    );

    const start = i * stagger;
    const end = start + wordDur;

    if (style === "slide-up") {
      const yOffset = 60;
      layer.transform.y = y + yOffset;
      layer.transform.opacity = 0;
      layer.keyframes = [
        makeKeyframe(start, "y", y + yOffset, "ease_out"),
        makeKeyframe(end, "y", y, "linear"),
        makeKeyframe(start, "opacity", 0, "linear"),
        makeKeyframe(end, "opacity", 1, "linear"),
      ];
    } else {
      // "fade" (default)
      layer.transform.opacity = 0;
      layer.keyframes = [
        makeKeyframe(start, "opacity", 0, "ease_in_out"),
        makeKeyframe(end, "opacity", 1, "linear"),
      ];
    }

    layers.push(layer);

    // Advance cursor: word width + inter-word space (skip space after last word).
    cursorX += wordWidth;
    if (i < words.length - 1) {
      cursorX += estimateSpaceWidth(fontSize);
    }
  });

  return layers;
}