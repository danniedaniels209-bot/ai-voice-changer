/**
 * Subtitle cues + a style preset → ordinary Motion Studio layers.
 *
 * THE WHOLE POINT of this file is that it produces NOTHING NEW. Every
 * caption is a plain text MotionLayer with visible_start_ms/visible_end_ms
 * set, and an optional plain rect MotionLayer behind it for the background
 * band. No new model field, no renderer change, no wire-format change —
 * which means MotionCanvas, RenderFrame, SceneThumbnail and the export
 * pipeline all handle burned-in captions today, without knowing subtitles
 * exist. If a future change to this file starts wanting a `subtitle` prop on
 * MotionLayer, that is the signal it has gone wrong.
 *
 * PARITY: the position of a caption depends on how tall its wrapped text
 * block is, so this file MUST measure text the same way the renderers do or
 * the caption sits correctly in the editor and wrongly in the export. It
 * therefore calls wrapTextToLines() and lineHeight() from textWrap.ts — the
 * exact functions all three renderers call — and derives the background
 * band width from DEFAULT_CHAR_WIDTH_FACTOR, the same 0.55 estimate. There
 * is deliberately no second estimator in here.
 *
 * WORD MODE: "line" puts a whole cue on screen as one layer. "word" emits
 * one layer per word (Shorts/TikTok pop style) using the shared word timing
 * from subtitle/timing.ts. "karaoke" and "highlight" recolour individual
 * words WITHIN a line, which a single text layer cannot express — they are
 * rendered as "line" and the caller is told so (see MODE_NOTES). Faking
 * them by splitting the line into one layer per word would break the line's
 * layout, which is worse than an honest downgrade.
 */

import type { MotionLayer, Keyframe } from "../../types/motion";
import type { SubtitleCue, SubtitleStyle } from "../../types/subtitle";
import { effectiveWords } from "../../subtitle/timing";
import { DEFAULT_CHAR_WIDTH_FACTOR, lineHeight, wrapTextToLines } from "../textWrap";
import { newId } from "../state";

/** The canvas size the subtitle engine's style numbers (font_size, margin,
 *  padding, stroke width) are expressed at — see TextStyle.font_size in
 *  backend/app/subtitle_engine/models.py. Everything is scaled by
 *  sceneWidth / this, exactly like SubtitleFrame's `scale` prop. */
export const REFERENCE_WIDTH = 1920;

/** Fraction of the scene width a caption may span before it wraps. 0.8
 *  leaves a 10% safe margin each side, which matches broadcast caption
 *  practice and keeps text clear of phone UI in vertical exports. */
export const DEFAULT_MAX_WIDTH_FRACTION = 0.8;

export const MODE_NOTES: Partial<Record<SubtitleStyle["word_mode"], string>> = {
  karaoke:
    "Karaoke sweeps colour across words inside one line; a text layer has a single colour, so these import as whole-line captions.",
  highlight:
    "Highlight recolours the current word inside one line; a text layer has a single colour, so these import as whole-line captions.",
};

export interface SubtitleLayerOptions {
  style: SubtitleStyle;
  sceneWidth: number;
  sceneHeight: number;
  sceneDurationMs: number;
  /** Shift every caption by this many ms (positive = later). For lining a
   *  subtitle file up against a scene whose audio doesn't start at 0. */
  offsetMs?: number;
  maxWidthFraction?: number;
  /** Emit the background band rect when the preset asks for one. Off ⇒
   *  text only, whatever the preset says. */
  includeBackground?: boolean;
}

export interface SubtitleLayerResult {
  layers: MotionLayer[];
  /** Cues that produced no layer because they fall entirely outside the
   *  scene's timeline. They are DROPPED, not clamped: a caption squashed
   *  onto the last frame is worse than a caption that is honestly reported
   *  missing. */
  droppedCueCount: number;
  notes: string[];
}

interface CaptionUnit {
  text: string;
  startMs: number;
  endMs: number;
}

function clampFinite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Fade in/out as opacity keyframes in SCENE time.
 *
 *  Easing is set explicitly to "linear" on every keyframe rather than left
 *  to a default: MotionCanvas evaluates keyframes through easing.ts while
 *  RenderFrame carries its own copy of the interpolator whose no-easing
 *  fallback is "ease_in_out", so an unspecified easing is a real
 *  editor/export divergence waiting to happen. Spelling it out makes both
 *  paths compute the same number. */
function fadeKeyframes(startMs: number, endMs: number, fadeMs: number, peakOpacity: number): Keyframe[] {
  // Never let the two fades meet in the middle — a caption must reach full
  // opacity even if it is shorter than two fade durations.
  const dur = Math.max(0, endMs - startMs);
  const fade = Math.min(fadeMs, Math.floor(dur / 2));
  if (fade <= 0) return [];
  const kf = (time_ms: number, value: number): Keyframe => ({
    id: newId(),
    time_ms: Math.round(time_ms),
    property: "opacity",
    value,
    easing: "linear",
  });
  return [
    kf(startMs, 0),
    kf(startMs + fade, peakOpacity),
    kf(endMs - fade, peakOpacity),
    // Land at 0 exactly ON the last visible instant. The layer is already
    // gated off at endMs by isLayerVisibleAt (half-open interval), so this
    // keyframe is the last frame that draws, not one past it.
    kf(endMs, 0),
  ];
}

/** One caption's geometry, derived from the SHARED wrap estimator. */
function measure(text: string, fontSize: number, maxWidthPx: number) {
  const lines = wrapTextToLines(text, { maxWidthPx, fontSize });
  const lineY = lineHeight(fontSize);
  // Height of the drawn block. The renderers put the first baseline at
  // y = fontSize and step each later line by lineHeight(), so n lines
  // occupy fontSize + (n-1)*lineY, plus roughly a quarter-em of descender
  // below the last baseline. With the default 1.25 factor that is exactly
  // n * lineY, which is why this expression is written that way.
  const blockHeight = fontSize + (lines.length - 1) * lineY + fontSize * 0.25;
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  // Same 0.55 char-width factor wrapTextToLines uses to decide the break
  // points — the band cannot be narrower than the text it sits behind.
  const textWidth = longest * fontSize * DEFAULT_CHAR_WIDTH_FACTOR;
  return { lines, blockHeight, textWidth };
}

/** Top edge (y) of the caption block for a given anchor. */
function blockTop(
  anchor: SubtitleStyle["position"]["anchor"],
  marginPx: number,
  blockHeight: number,
  sceneHeight: number,
): number {
  if (anchor === "top") return marginPx;
  if (anchor === "center") return (sceneHeight - blockHeight) / 2;
  return sceneHeight - marginPx - blockHeight;
}

function splitIntoUnits(cue: SubtitleCue, wordMode: SubtitleStyle["word_mode"]): CaptionUnit[] {
  if (wordMode !== "word") {
    return [{ text: cue.text, startMs: cue.start * 1000, endMs: cue.end * 1000 }];
  }
  // Shared with the ASS renderer and the live preview: real per-word timing
  // when the cue has it, proportional split when it doesn't.
  return effectiveWords(cue).map((w) => ({
    text: w.text,
    startMs: w.start * 1000,
    endMs: w.end * 1000,
  }));
}

/**
 * Build the caption layers for a whole cue list.
 *
 * Layer order matters: the background band is pushed BEFORE its text layer
 * so the painter's-algorithm order used by every renderer
 * (`scene.layers.map(...)` — later index draws on top) puts the band behind
 * the words.
 */
export function subtitleCuesToLayers(
  cues: SubtitleCue[],
  opts: SubtitleLayerOptions,
): SubtitleLayerResult {
  const { style, sceneWidth, sceneHeight, sceneDurationMs } = opts;
  const offsetMs = opts.offsetMs ?? 0;
  const maxWidthFraction = opts.maxWidthFraction ?? DEFAULT_MAX_WIDTH_FRACTION;
  const includeBackground = opts.includeBackground ?? true;

  const scale = sceneWidth / REFERENCE_WIDTH;
  const fontSize = Math.max(1, style.text.font_size * scale);
  const marginPx = style.position.margin * scale;
  const maxWidthPx = Math.max(fontSize, sceneWidth * maxWidthFraction);
  const boxX = (sceneWidth - maxWidthPx) / 2;

  const wantsBand = includeBackground && style.background.shape === "box";
  const padX = style.background.padding_x * scale;
  const padY = style.background.padding_y * scale;

  const layers: MotionLayer[] = [];
  const notes: string[] = [];
  let dropped = 0;

  const modeNote = MODE_NOTES[style.word_mode];
  if (modeNote) notes.push(modeNote);

  for (const cue of cues) {
    for (const unit of splitIntoUnits(cue, style.word_mode)) {
      const startMs = Math.round(clampFinite(unit.startMs, 0) + offsetMs);
      const endMs = Math.round(clampFinite(unit.endMs, 0) + offsetMs);
      // Entirely off the timeline in either direction ⇒ it could never be
      // drawn. Report it instead of adding an invisible layer that clutters
      // the layer panel forever.
      if (endMs <= 0 || startMs >= sceneDurationMs || endMs <= startMs) {
        dropped++;
        continue;
      }
      // Partially outside is fine and is NOT clamped: isLayerVisibleAt
      // handles a negative start and an end past the scene duration, and
      // clamping here would change the caption's timing relative to the
      // audio it was written against.

      const { lines, blockHeight, textWidth } = measure(unit.text, fontSize, maxWidthPx);
      const top = blockTop(style.position.anchor, marginPx, blockHeight, sceneHeight);
      const fadeMs = style.animation.type === "none" ? 0 : style.animation.duration_ms;

      if (wantsBand) {
        const bandWidth = Math.min(sceneWidth, textWidth + padX * 2);
        const bandHeight = blockHeight + padY * 2;
        layers.push({
          id: newId(),
          name: `Caption BG ${layers.length + 1}`,
          type: "rect",
          transform: {
            x: (sceneWidth - bandWidth) / 2,
            y: top - padY,
            width: bandWidth,
            height: bandHeight,
            rotation: 0,
            // The band's translucency lives on the layer opacity because
            // RectLayerProps has no fill-opacity and I am not adding one.
            // A rect layer holding nothing but the band means layer
            // opacity and fill opacity are the same thing here.
            opacity: style.background.opacity,
            blur: 0,
          },
          locked: false,
          hidden: false,
          rect: {
            fill: style.background.color,
            corner_radius: style.background.corner_radius * scale,
            stroke_color: "#000000",
            stroke_width: 0,
          },
          ellipse: null,
          text: null,
          image: null,
          video: null,
          visible_start_ms: startMs,
          visible_end_ms: endMs,
          keyframes: fadeKeyframes(startMs, endMs, fadeMs, style.background.opacity),
        });
      }

      layers.push({
        id: newId(),
        name: `Caption: ${unit.text.slice(0, 24)}${unit.text.length > 24 ? "…" : ""}`,
        type: "text",
        transform: {
          x: boxX,
          y: top,
          width: maxWidthPx,
          height: blockHeight,
          rotation: 0,
          opacity: style.text.opacity,
          blur: 0,
        },
        locked: false,
        hidden: false,
        rect: null,
        ellipse: null,
        text: {
          // Pass the already-wrapped lines back as hard breaks. The
          // renderers re-run wrapTextToLines on this string, and it is a
          // fixed point of that function (each line already fits), so they
          // reproduce these exact breaks — and the layer's stored text now
          // matches the block height computed above even if the user later
          // resizes the box.
          text: lines.join("\n"),
          font_family: style.text.font_family,
          font_size: fontSize,
          font_weight: style.text.font_weight,
          color: style.text.color,
          align: "center",
          letter_spacing: style.text.letter_spacing * scale,
          // Left unset on purpose: textWrap.lineHeight()'s 1.25 default is
          // what measure() used, and setting the field to the same number
          // would just be a second place to keep in sync.
          stroke_color: style.stroke.color,
          stroke_width: style.stroke.width * scale,
        },
        image: null,
        video: null,
        shadow:
          style.shadow.opacity > 0 && style.shadow.blur > 0
            ? {
                color: style.shadow.color,
                blur: style.shadow.blur * scale,
                offset_x: style.shadow.offset_x * scale,
                offset_y: style.shadow.offset_y * scale,
                opacity: style.shadow.opacity,
                glow: false,
              }
            : null,
        visible_start_ms: startMs,
        visible_end_ms: endMs,
        keyframes: fadeKeyframes(startMs, endMs, fadeMs, style.text.opacity),
      });
    }
  }

  if (dropped > 0) {
    notes.push(
      `${dropped} caption(s) fall outside the scene's ${(sceneDurationMs / 1000).toFixed(1)}s timeline and were not imported.`,
    );
  }

  return { layers, droppedCueCount: dropped, notes };
}
