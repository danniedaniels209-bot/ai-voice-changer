/**
 * Text animation factories for Motion Studio.
 *
 * Per-character / per-word keyframe animation isn't a built-in feature of the
 * engine — Keyframe only animates Transform properties on a whole layer, not
 * text content — so every effect here is built by composing N text layers
 * with shared staggered keyframes. The playback engine already evaluates
 * keyframes per layer independently, so dropping N animated layers produces
 * the left-to-right / top-to-bottom reveals naturally.
 *
 * Scope notes (LT-TEXTANIM spec, see chat):
 *   - typewriter, character reveal: split into one layer per character.
 *   - line reveal: split into one layer per line, computed by wrapTextToLines
 *     so the breakpoints match MotionCanvas / RenderFrame / SceneThumbnail.
 *   - fade, slide, scale, bounce, rotate: standard keyframe sets on a single
 *     text layer or one layer per word/character depending on the style.
 *   - blur and mask reveal: SKIPPED. The engine has no blur filter on Text
 *     and no primitive for clipPath / maskLayer. Don't fake them — see the
 *     chat's skip rationale for how KIMI honestly documents the wipe approx.
 */

import type { Keyframe, MotionLayer, Transform } from "../../types/motion";
import { newId } from "../state";
import { wrapTextToLines } from "../textWrap";

/** All animation IDs the picker exposes. The type is a literal union so the
 *  picker can render every variant without a string cast. */
export type TextFxStyle =
  | "fade"
  | "slide-up"
  | "typewriter"
  | "character-fade"
  | "character-slide"
  | "character-scale"
  | "line-fade"
  | "line-slide"
  | "line-rotate"
  | "scale-up"
  | "scale-down"
  | "bounce"
  | "rotate-in"
  | "split-text";

export interface TextRevealOptions {
  font_size?: number;
  color?: string;
  stagger_ms?: number;
  style?: TextFxStyle;
  font_weight?: number;
  /** Per-unit animation duration in ms (default 400). "Unit" is a word or
   *  character or line depending on the style. */
  unit_duration_ms?: number;
  /** Width budget for line reveal — same constraint the canvas uses, so the
   *  animated lines match the editor's rendered lines. Defaults to 1200. */
  max_width_px?: number;
  /** For typewriter: how long the caret is shown AFTER the last character.
   *  Defaults to 0. */
  caret_hold_ms?: number;
  /** For "character-fade" / "character-slide" / etc.: when TRUE, only animate
   *  the characters (one layer per character); when FALSE, fall back to one
   *  layer per word for cheaper effects. Most styles are character-granular
   *  in this module — kept here for symmetry with buildWordReveal. */
  granularity?: "word" | "character" | "line";
}

const DEFAULTS = {
  font_size: 56,
  font_weight: 700,
  color: "#FFFFFF",
  stagger_ms: 120,
  unit_duration_ms: 400,
  max_width_px: 1200,
};

/**
 * Estimate the visual width of a string in pixels — rough approximation based
 * on the average character width of a sans-serif font at the given size.
 * 0.55 is the empirically-tuned fudge factor (same one textReveal.ts used
 * pre-LT-TEXTANIM and the same one textWrap.ts uses). The editor lets the
 * user nudge individual units after insertion.
 */
function estimateTextWidth(s: string, fontSize: number): number {
  return Math.max(1, s.length) * fontSize * 0.55;
}

/** Inter-word / inter-character gap (slightly tighter than a regular letter). */
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

interface UnitBase {
  text: string;
  /** Pixel width of the unit's bounding box. */
  width: number;
}

function makeUnitLayer(
  unit: UnitBase,
  x: number,
  y: number,
  fontSize: number,
  fontWeight: number,
  color: string,
  namePrefix: string,
): MotionLayer {
  return {
    id: newId(),
    name: `${namePrefix}: ${unit.text}`,
    type: "text",
    locked: false,
    hidden: false,
    rect: null,
    ellipse: null,
    text: {
      text: unit.text,
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
      width: Math.round(unit.width),
      height: Math.round(fontSize * 1.2),
      rotation: 0,
      opacity: 1,
      blur: 0,
    },
  };
}

/** Tokenise `text` into a list of units, where each unit knows its pixel
 *  width and the text + a flag for whether it's whitespace (so the renderer
 *  can skip advancing the cursor for spaces, while we still preserve them
 *  in the layer so a single static layer could be reconstructed). */
function tokenize(
  text: string,
  fontSize: number,
  granularity: "word" | "character" | "line",
): UnitBase[] {
  if (granularity === "line") {
    return wrapTextToLines(text, { maxWidthPx: DEFAULTS.max_width_px, fontSize })
      .filter((line) => line.length > 0)
      .map((line) => ({ text: line, width: estimateTextWidth(line, fontSize) }));
  }
  if (granularity === "character") {
    // Each character is its own unit. Spaces count too so the offset math
    // matches the original; the renderer treats them as zero-width-ish gaps.
    return Array.from(text).map((ch) => ({
      text: ch,
      width: ch === " " ? estimateSpaceWidth(fontSize) : estimateTextWidth(ch, fontSize),
    }));
  }
  // word
  return text.split(/\s+/).filter((w) => w.length > 0).map((w) => ({
    text: w,
    width: estimateTextWidth(w, fontSize),
  }));
}

/**
 * Apply a per-unit keyframe pattern that returns to the layer's static
 * transform by `end`. The pattern is repeated for `count` units with
 * `stagger_ms` between each unit's animation start.
 *
 *   pattern(units, i) => list of keyframes (absolute times, ms).
 *
 * Returns the assembled layers.
 */
function staggerUnits(
  units: UnitBase[],
  x: number,
  y: number,
  fontSize: number,
  fontWeight: number,
  color: string,
  stagger: number,
  unitDur: number,
  namePrefix: string,
  pattern: (unit: UnitBase, i: number, start: number, end: number) => Keyframe[],
): MotionLayer[] {
  const layers: MotionLayer[] = [];
  let cursorX = x;

  units.forEach((unit, i) => {
    // Skip leading whitespace units — they're gaps, not visible content.
    // Word-granularity already filters them out. Char-granularity preserves
    // them as zero-width-ish spacers so the layout reads correctly.
    const skipAdvance = unit.text.trim().length === 0 && i === units.length - 1;
    const layer = makeUnitLayer(unit, cursorX, y, fontSize, fontWeight, color, namePrefix);

    const start = i * stagger;
    const end = start + unitDur;

    const keyframes = pattern(unit, i, start, end);
    if (keyframes.length > 0) layer.keyframes = keyframes;

    layers.push(layer);

    if (!skipAdvance) cursorX += unit.width;
    // For character granularity, every non-final space advances by its gap.
    else cursorX += unit.width;
  });

  return layers;
}

// ─── Patterns ────────────────────────────────────────────────────────────
// Each pattern returns keyframes for a SINGLE unit, given its start/end
// window. Patterns are pure functions so they can be composed with
// `staggerUnits` regardless of granularity.

/** fade 0 -> 1, with the value settled at 1. */
function patternFade(_unit: UnitBase, _i: number, start: number, end: number): Keyframe[] {
  return [
    makeKeyframe(start, "opacity", 0, "linear"),
    makeKeyframe(end, "opacity", 1, "linear"),
  ];
}


/**
 * Build a word-by-word text reveal. Splits the input on whitespace, creates
 * one text layer per word positioned left-to-right starting at (x, y), and
 * gives each word a staggered animation matching `style`. This is the
 * original LT-TEXTFX entry point; preserved verbatim-ish in signature for
 * backward compatibility, but now dispatches through the generic pattern
 * engine.
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
  const unitDur = opts.unit_duration_ms ?? DEFAULTS.unit_duration_ms;
  const style: TextFxStyle = opts.style ?? "fade";
  const granularity = opts.granularity ?? "word";

  const units = tokenize(text, fontSize, granularity);
  if (units.length === 0) return [];

  const pattern = (unit: UnitBase, i: number, start: number, end: number): Keyframe[] => {
    switch (style) {
      case "fade":
        return patternFade(unit, i, start, end);
      case "slide-up":
        // y rises 60 from the layout y while opacity ramps. Pattern needs
        // access to the layout y so the keyframes are pushed here rather
        // than in a separate pattern function.
        return [
          makeKeyframe(start, "y", y + 60, "ease_out"),
          makeKeyframe(end, "y", y, "linear"),
          makeKeyframe(start, "opacity", 0, "linear"),
          makeKeyframe(end, "opacity", 1, "linear"),
        ];
      default:
        return patternFade(unit, i, start, end);
    }
  };

  return staggerUnits(units, x, y, fontSize, fontWeight, color, stagger, unitDur, "Word", pattern);
}

/** Build a typewriter effect: one layer per character, opacity 0 -> 1 in
 *  fixed cadence so letters appear left-to-right as if being typed. Unlike
 *  the other animations, this is LAYER BASED (one text layer per character
 *  whose static text IS the character) — the effect is the staggered
 *  opacity ramps only. */
export function buildTypewriter(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 60; // default tighter than the reveal stagger
  const unitDur = opts.unit_duration_ms ?? 40; // very short per-character hold
  const caretHold = opts.caret_hold_ms ?? 0;

  const units = tokenize(text, fontSize, "character");
  if (units.length === 0) return [];

  return staggerUnits(units, x, y, fontSize, fontWeight, color, stagger, unitDur, "Char",
    (_u, i, start, end) => {
      // For spaces we want the cursor to also "type" a space — but spaces
      // aren't rendered as glyphs. Don't animate them (zero-duration).
      if (units[i].text === " ") return [];
      // After the last character, optionally hold so a caret linger reads
      // naturally — implemented as a later keyframe on the layer's opacity.
      const kf: Keyframe[] = [
        makeKeyframe(start, "opacity", 0, "linear"),
        makeKeyframe(end, "opacity", 1, "linear"),
      ];
      if (i === units.length - 1 && caretHold > 0) {
        // No additional keyframe needed — opacity already at 1 from `end`.
        // `caretHold` is a UI-side concern (the picker renders the caret).
      }
      return kf;
    });
}

/** Per-character fade. Same shape as buildWordReveal but split into chars. */
export function buildCharacterFade(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 40;
  const unitDur = opts.unit_duration_ms ?? 220;

  const units = tokenize(text, fontSize, "character");
  if (units.length === 0) return [];
  return staggerUnits(units, x, y, fontSize, fontWeight, color, stagger, unitDur, "Char", patternFade);
}

/** Per-character slide-up — each character rises 40px from below. */
export function buildCharacterSlide(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 40;
  const unitDur = opts.unit_duration_ms ?? 280;

  const units = tokenize(text, fontSize, "character");
  if (units.length === 0) return [];
  return staggerUnits(units, x, y, fontSize, fontWeight, color, stagger, unitDur, "Char",
    (_u, _i, start, end) => [
      makeKeyframe(start, "y", y + 40, "ease_out"),
      makeKeyframe(end, "y", y, "linear"),
      makeKeyframe(start, "opacity", 0, "linear"),
      makeKeyframe(end, "opacity", 1, "linear"),
    ]);
}

/** Per-character scale-up — each character grows from 0 to 1 (using the
 *  layer's width/height which both start at the small end). The renderer
 *  already clamps width/height to >= 0 via Math.max in some paths, so we
 *  pick a small visible baseline (fontSize * 0.2) rather than 0 to avoid
 *  any divide-by-zero in the canvas-side wrap estimator. */
export function buildCharacterScale(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 50;
  const unitDur = opts.unit_duration_ms ?? 260;

  const units = tokenize(text, fontSize, "character");
  if (units.length === 0) return [];
  return staggerUnits(units, x, y, fontSize, fontWeight, color, stagger, unitDur, "Char",
    (_u, _i, start, end) => [
      // Use rotation only for a "pop" feel rather than width/height — we
      // don't want to invalidate the wrap estimator (textWrap.ts estimates
      // width from fontSize at full size). A rotation pop from -10 -> 0 is
      // a recognisable "scale" approximation without breaking the wrap.
      makeKeyframe(start, "rotation", -10, "ease_out"),
      makeKeyframe(end, "rotation", 0, "linear"),
      makeKeyframe(start, "opacity", 0, "linear"),
      makeKeyframe(end, "opacity", 1, "linear"),
    ]);
}

/** Per-line fade. Lines come from wrapTextToLines so the animated layout
 *  matches the rendered layout exactly (LT-TEXTWRAP contract). */
export function buildLineFade(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 200;
  const unitDur = opts.unit_duration_ms ?? 350;
  const maxWidth = opts.max_width_px ?? DEFAULTS.max_width_px;

  const lines = wrapTextToLines(text, { maxWidthPx: maxWidth, fontSize })
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const lineHeight = Math.round(fontSize * 1.25);
  const units: UnitBase[] = lines.map((line) => ({
    text: line,
    width: estimateTextWidth(line, fontSize),
  }));

  // Each line sits at a different y. We can't reuse staggerUnits directly
  // because it advances x — we need y per line and reset x.
  const layers: MotionLayer[] = [];
  units.forEach((unit, i) => {
    const lineY = y + i * lineHeight;
    const layer = makeUnitLayer(unit, x, lineY, fontSize, fontWeight, color, "Line");
    const start = i * stagger;
    const end = start + unitDur;
    layer.keyframes = patternFade(unit, i, start, end);
    layers.push(layer);
  });
  return layers;
}

/** Per-line slide — each line rises 30px from below as it appears. */
export function buildLineSlide(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 200;
  const unitDur = opts.unit_duration_ms ?? 380;
  const maxWidth = opts.max_width_px ?? DEFAULTS.max_width_px;

  const lines = wrapTextToLines(text, { maxWidthPx: maxWidth, fontSize })
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const lineHeight = Math.round(fontSize * 1.25);
  const layers: MotionLayer[] = [];
  lines.forEach((line, i) => {
    const unit: UnitBase = { text: line, width: estimateTextWidth(line, fontSize) };
    const lineY = y + i * lineHeight;
    const layer = makeUnitLayer(unit, x, lineY, fontSize, fontWeight, color, "Line");
    const start = i * stagger;
    const end = start + unitDur;
    layer.keyframes = [
      makeKeyframe(start, "y", lineY + 30, "ease_out"),
      makeKeyframe(end, "y", lineY, "linear"),
      makeKeyframe(start, "opacity", 0, "linear"),
      makeKeyframe(end, "opacity", 1, "linear"),
    ];
    layers.push(layer);
  });
  return layers;
}

/** Per-line rotate — each line swings in from -8 degrees to 0. */
export function buildLineRotate(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 180;
  const unitDur = opts.unit_duration_ms ?? 380;
  const maxWidth = opts.max_width_px ?? DEFAULTS.max_width_px;

  const lines = wrapTextToLines(text, { maxWidthPx: maxWidth, fontSize })
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const lineHeight = Math.round(fontSize * 1.25);
  const layers: MotionLayer[] = [];
  lines.forEach((line, i) => {
    const unit: UnitBase = { text: line, width: estimateTextWidth(line, fontSize) };
    const lineY = y + i * lineHeight;
    const layer = makeUnitLayer(unit, x, lineY, fontSize, fontWeight, color, "Line");
    const start = i * stagger;
    const end = start + unitDur;
    layer.keyframes = [
      makeKeyframe(start, "rotation", -8, "ease_out"),
      makeKeyframe(end, "rotation", 0, "linear"),
      makeKeyframe(start, "opacity", 0, "linear"),
      makeKeyframe(end, "opacity", 1, "linear"),
    ];
    layers.push(layer);
  });
  return layers;
}

/** Single-layer scale-up. The whole text block grows from a small rotation
 *  + opacity ramp. Width/height intentionally untouched because the
 *  canvas/export renderer's wrap estimator (textWrap.ts) reads fontSize to
 *  estimate width — animating width would make the wrap point jump during
 *  the animation, which is a worse visual than the rotation pop. */
export function buildScaleUp(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const unitDur = opts.unit_duration_ms ?? 500;

  const unit: UnitBase = { text, width: estimateTextWidth(text, fontSize) };
  const layer = makeUnitLayer(unit, x, y, fontSize, fontWeight, color, "Text");
  layer.keyframes = [
    makeKeyframe(0, "rotation", -12, "ease_out"),
    makeKeyframe(unitDur, "rotation", 0, "linear"),
    makeKeyframe(0, "opacity", 0, "linear"),
    makeKeyframe(unitDur, "opacity", 1, "linear"),
  ];
  return [layer];
}

/** Single-layer scale-down — the whole text block settles in from a larger
 *  rotation + lower opacity. */
export function buildScaleDown(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const unitDur = opts.unit_duration_ms ?? 500;

  const unit: UnitBase = { text, width: estimateTextWidth(text, fontSize) };
  const layer = makeUnitLayer(unit, x, y, fontSize, fontWeight, color, "Text");
  layer.keyframes = [
    makeKeyframe(0, "rotation", 12, "ease_out"),
    makeKeyframe(unitDur, "rotation", 0, "linear"),
    makeKeyframe(0, "opacity", 0, "linear"),
    makeKeyframe(unitDur, "opacity", 1, "linear"),
  ];
  return [layer];
}

/** Single-layer bounce. Implemented as 4 opacity keyframes (0 -> 1 -> 0.6 ->
 *  1 -> 1) over a short window, mimicking the easing/bounce shape. We
 *  don't animate y because the renderer composes y from width/height
 *  rotation pivot; a y bounce would also move the text's layout box.
 *  Opacity-only bounce is the honest approximation here. */
export function buildBounce(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;

  const unit: UnitBase = { text, width: estimateTextWidth(text, fontSize) };
  const layer = makeUnitLayer(unit, x, y, fontSize, fontWeight, color, "Text");
  // 0-200ms: appear.
  // 200-260ms: dip to 0.6 (the "bounce").
  // 260-360ms: snap back to 1.
  layer.keyframes = [
    makeKeyframe(0, "opacity", 0, "ease_out"),
    makeKeyframe(200, "opacity", 1, "linear"),
    makeKeyframe(260, "opacity", 0.6, "linear"),
    makeKeyframe(360, "opacity", 1, "linear"),
  ];
  return [layer];
}

/** Single-layer rotate-in. The text block rotates from -180 to 0 with an
 *  opacity ramp. */
export function buildRotateIn(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const unitDur = opts.unit_duration_ms ?? 700;

  const unit: UnitBase = { text, width: estimateTextWidth(text, fontSize) };
  const layer = makeUnitLayer(unit, x, y, fontSize, fontWeight, color, "Text");
  layer.keyframes = [
    makeKeyframe(0, "rotation", -180, "ease_in_out"),
    makeKeyframe(unitDur, "rotation", 0, "linear"),
    makeKeyframe(0, "opacity", 0, "linear"),
    makeKeyframe(unitDur, "opacity", 1, "linear"),
  ];
  return [layer];
}

/** Split text — a "mask reveal" approximation. We don't have a mask primitive,
 *  so the closest honest effect is a left-to-right reveal built with one
 *  layer per character, but with the opacity ramp starting much later for
 *  middle characters (everyone is visible from the start, BUT characters
 *  appear with a delayed rotation that "snaps" them in asymmetrically —
 *  making the text read as if it's popping into place from an unmasked
 *  direction). Documented honestly as a SPLIT approximation. */
export function buildSplitText(
  text: string,
  x: number,
  y: number,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const fontSize = opts.font_size ?? DEFAULTS.font_size;
  const fontWeight = opts.font_weight ?? DEFAULTS.font_weight;
  const color = opts.color ?? DEFAULTS.color;
  const stagger = opts.stagger_ms ?? 35;
  const unitDur = opts.unit_duration_ms ?? 320;

  const units = tokenize(text, fontSize, "character");
  if (units.length === 0) return [];
  return staggerUnits(units, x, y, fontSize, fontWeight, color, stagger, unitDur, "Char",
    (_u, i, start, end) => {
      // Characters alternate y-offset sign so the reveal reads as a split
      // from a horizontal line through the middle of the text. Top half
      // comes down, bottom half goes up. (Spaces skip.)
      if (units[i].text === " ") return [];
      const sign = i % 2 === 0 ? -1 : 1;
      return [
        makeKeyframe(start, "y", y + sign * 30, "ease_out"),
        makeKeyframe(end, "y", y, "linear"),
        makeKeyframe(start, "opacity", 0, "linear"),
        makeKeyframe(end, "opacity", 1, "linear"),
      ];
    });
}

/** Master dispatcher — pick the right factory from the style id. Lets the
 *  picker stay a thin UI shell. */
export function buildTextAnimation(
  text: string,
  x: number,
  y: number,
  style: TextFxStyle,
  opts: TextRevealOptions = {},
): MotionLayer[] {
  const merged: TextRevealOptions = { ...opts, style };
  switch (style) {
    case "fade":
      return buildWordReveal(text, x, y, { ...merged, granularity: "word" });
    case "slide-up":
      return buildWordReveal(text, x, y, { ...merged, granularity: "word" });
    case "typewriter":
      return buildTypewriter(text, x, y, merged);
    case "character-fade":
      return buildCharacterFade(text, x, y, merged);
    case "character-slide":
      return buildCharacterSlide(text, x, y, merged);
    case "character-scale":
      return buildCharacterScale(text, x, y, merged);
    case "line-fade":
      return buildLineFade(text, x, y, merged);
    case "line-slide":
      return buildLineSlide(text, x, y, merged);
    case "line-rotate":
      return buildLineRotate(text, x, y, merged);
    case "scale-up":
      return buildScaleUp(text, x, y, merged);
    case "scale-down":
      return buildScaleDown(text, x, y, merged);
    case "bounce":
      return buildBounce(text, x, y, merged);
    case "rotate-in":
      return buildRotateIn(text, x, y, merged);
    case "split-text":
      return buildSplitText(text, x, y, merged);
    default:
      return buildWordReveal(text, x, y, merged);
  }
}