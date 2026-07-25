/**
 * Mirrors backend/app/subtitle_engine/models.py field-for-field (snake_case
 * kept as-is, matching the JSON the API actually sends) so a style object
 * fetched from GET /subtitles/presets needs no translation before it's
 * handed straight to <SubtitleOverlay>, and the same object shape is what
 * the ASS renderer burns into the export — preview and export always match.
 */

export type WordMode = "line" | "word" | "karaoke" | "highlight";
export type BackgroundShape = "none" | "box";
export type PositionAnchor = "top" | "center" | "bottom";
export type AnimationType = "none" | "fade" | "pop" | "karaoke_sweep" | "typewriter";

export interface SubtitleWord {
  text: string;
  start: number; // seconds
  end: number;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words: SubtitleWord[];
}

export interface TextStyle {
  font_family: string;
  font_weight: number;
  italic: boolean;
  underline: boolean;
  letter_spacing: number;
  font_size: number; // px, at the 1920x1080 reference canvas
  color: string; // '#RRGGBB'
  active_color: string | null;
  opacity: number;
}

export interface StrokeStyle {
  color: string;
  width: number;
}

export interface ShadowStyle {
  color: string;
  blur: number;
  offset_x: number;
  offset_y: number;
  opacity: number;
}

export interface BackgroundStyle {
  shape: BackgroundShape;
  color: string;
  opacity: number;
  padding_x: number;
  padding_y: number;
  corner_radius: number;
}

export interface PositionConfig {
  anchor: PositionAnchor;
  margin: number; // px from the anchored edge, at 1080p reference
}

export interface AnimationSpec {
  type: AnimationType;
  duration_ms: number;
}

export interface SubtitleStyle {
  id: string;
  name: string;
  word_mode: WordMode;
  text: TextStyle;
  stroke: StrokeStyle;
  shadow: ShadowStyle;
  background: BackgroundStyle;
  position: PositionConfig;
  animation: AnimationSpec;
}
