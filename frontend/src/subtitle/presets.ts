/**
 * Mirrors backend/app/subtitle_engine/presets.py value-for-value — kept as
 * a local copy (rather than only ever fetching) so the style picker and
 * live preview have something to render instantly, with no network round
 * trip in the way. GET /subtitles/presets remains the source of truth if
 * the two ever drift; see api/subtitles.ts.
 */

import type { SubtitleStyle } from "../types/subtitle";

export const CLASSIC: SubtitleStyle = {
  id: "classic",
  name: "Classic",
  word_mode: "line",
  text: {
    font_family: "Arial", font_weight: 700, italic: false, underline: false,
    letter_spacing: 0, font_size: 64, color: "#FFFFFF", active_color: null, opacity: 1,
  },
  stroke: { color: "#000000", width: 3 },
  shadow: { color: "#000000", blur: 0, offset_x: 0, offset_y: 2, opacity: 0.6 },
  background: { shape: "none", color: "#000000", opacity: 0.6, padding_x: 16, padding_y: 8, corner_radius: 12 },
  position: { anchor: "bottom", margin: 80 },
  animation: { type: "fade", duration_ms: 150 },
};

export const KARAOKE: SubtitleStyle = {
  id: "karaoke",
  name: "Karaoke",
  word_mode: "karaoke",
  text: {
    font_family: "Arial", font_weight: 700, italic: false, underline: false,
    letter_spacing: 0, font_size: 60, color: "#FFFFFF", active_color: "#FFD200", opacity: 1,
  },
  stroke: { color: "#000000", width: 2.5 },
  shadow: { color: "#000000", blur: 0, offset_x: 0, offset_y: 2, opacity: 0.6 },
  background: { shape: "none", color: "#000000", opacity: 0.6, padding_x: 16, padding_y: 8, corner_radius: 12 },
  position: { anchor: "bottom", margin: 90 },
  animation: { type: "karaoke_sweep", duration_ms: 0 },
};

export const WORD_POP: SubtitleStyle = {
  id: "word_pop",
  name: "Word Pop",
  word_mode: "word",
  text: {
    font_family: "Arial", font_weight: 800, italic: false, underline: false,
    letter_spacing: 0, font_size: 88, color: "#FFFFFF", active_color: null, opacity: 1,
  },
  stroke: { color: "#000000", width: 5 },
  shadow: { color: "#000000", blur: 0, offset_x: 0, offset_y: 2, opacity: 0.6 },
  background: { shape: "none", color: "#000000", opacity: 0.6, padding_x: 16, padding_y: 8, corner_radius: 12 },
  position: { anchor: "center", margin: 0 },
  animation: { type: "pop", duration_ms: 180 },
};

export const HIGHLIGHT: SubtitleStyle = {
  id: "highlight",
  name: "Highlight",
  word_mode: "highlight",
  text: {
    font_family: "Arial", font_weight: 700, italic: false, underline: false,
    letter_spacing: 0, font_size: 60, color: "#CCCCCC", active_color: "#39FF88", opacity: 1,
  },
  stroke: { color: "#000000", width: 2 },
  shadow: { color: "#000000", blur: 0, offset_x: 0, offset_y: 2, opacity: 0.6 },
  background: { shape: "none", color: "#000000", opacity: 0.6, padding_x: 16, padding_y: 8, corner_radius: 12 },
  position: { anchor: "bottom", margin: 90 },
  animation: { type: "none", duration_ms: 0 },
};

export const CAPCUT: SubtitleStyle = {
  id: "capcut",
  name: "CapCut",
  word_mode: "word",
  text: {
    font_family: "Arial", font_weight: 800, italic: false, underline: false,
    letter_spacing: 0, font_size: 70, color: "#FFFFFF", active_color: null, opacity: 1,
  },
  stroke: { color: "#000000", width: 0 },
  shadow: { color: "#000000", blur: 0, offset_x: 0, offset_y: 2, opacity: 0.6 },
  background: { shape: "box", color: "#000000", opacity: 0.75, padding_x: 20, padding_y: 12, corner_radius: 16 },
  position: { anchor: "bottom", margin: 100 },
  animation: { type: "pop", duration_ms: 160 },
};

export const BUILTIN_PRESETS: SubtitleStyle[] = [CLASSIC, KARAOKE, WORD_POP, HIGHLIGHT, CAPCUT];
export const PRESETS_BY_ID: Record<string, SubtitleStyle> = Object.fromEntries(
  BUILTIN_PRESETS.map((p) => [p.id, p]),
);
export const DEFAULT_PRESET_ID = "classic";

export function getPreset(id: string | null | undefined): SubtitleStyle {
  return (id && PRESETS_BY_ID[id]) || PRESETS_BY_ID[DEFAULT_PRESET_ID];
}
