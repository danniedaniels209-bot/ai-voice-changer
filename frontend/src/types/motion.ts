/**
 * Motion Studio's scene data model. Mirrors backend/app/motion_studio/models.py
 * field-for-field (snake_case kept as-is, matching the JSON sent over the
 * wire) — same convention as types/subtitle.ts — so a project loaded from
 * the API needs no translation, and the export renderer (a headless
 * browser loading this same scene data) draws exactly what the editor
 * canvas shows.
 */

import type { GradientFill } from "../motion/gradients/gradientTypes";
import type { ShadowEffect } from "../motion/shadowfx/shadowTypes";
import type { ConnectorStyle } from "../motion/connector/ConnectorTypes";
import { rampedSourceElapsedMs } from "../motion/video/speedRamp";

export type LayerType = "rect" | "ellipse" | "text" | "image" | "video" | "polygon" | "star" | "triangle" | "line" | "arrow";
export type AnimatableProperty = "x" | "y" | "width" | "height" | "rotation" | "opacity" | "blur";
export type EasingType =
  | "linear"
  | "ease_in"
  | "ease_out"
  | "ease_in_out"
  | "bounce"
  | "elastic"
  | "spring"
  | "overshoot"
  | "custom";

/** Brightness/contrast/saturation/hue adjustment for a layer. See
 *  MotionLayer.color_grade and colorGrade.ts. */
export interface ColorGrade {
  brightness: number;
  contrast: number;
  saturation: number;
  hue_deg: number;
}

/** CSS mix-blend-mode value applied to a layer's outer <g> (LT-LAYERBLEND).
 *  Kept in lock-step with the backend `BlendMode` Literal in models.py so
 *  the API rejects anything outside this set at the wire boundary instead
 *  of letting an invalid value silently fall through to a renderer that
 *  ignores it. The actual translation of this field to a CSS style happens
 *  in motion/blend/blendMode.ts — that's the single shared definition all
 *  three renderers use. */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface SceneMarker {
  id: string;
  time_ms: number;
  label: string;
  color: string;
}

export interface Keyframe {
  id: string;
  time_ms: number;
  property: AnimatableProperty;
  value: number;
  easing: EasingType;
  /** The four control points of a cubic-bezier curve, only meaningful when
   *  `easing === "custom"`. Same shape as CSS's cubic-bezier() — all four
   *  values are clamped to [0, 1] by the editor, but easing.ts re-clamps
   *  defensively so a hand-edited project JSON can't escape the range.
   *  x1/y1 = first handle, x2/y2 = second handle. */
  easing_bezier?: [number, number, number, number];
}

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0-1
  blur: number; // gaussian blur radius in px (0 = no blur)
}

export interface RectLayerProps {
  fill: string;
  corner_radius: number;
  stroke_color: string;
  stroke_width: number;
}

export interface EllipseLayerProps {
  fill: string;
  stroke_color: string;
  stroke_width: number;
}

export interface TextLayerProps {
  text: string;
  font_family: string;
  font_size: number;
  font_weight: number;
  color: string;
  align: "left" | "center" | "right";
  /** Extra tracking in px (positive = looser, negative = tighter). 0 = the
   *  browser's default for the given font. Maps directly to SVG's
   *  `letter-spacing` attribute (which itself consumes a px length). */
  letter_spacing?: number;
  /** Multiplier on font_size for the per-line vertical advance. Default 1.25
   *  matches textWrap.ts's LINE_HEIGHT_FACTOR so wrap and render stay in
   *  lockstep — if you change one, change the other. */
  line_height?: number;
  /** Outline color. Pair with stroke_width > 0 to draw a stroke around each
   *  glyph. SVG <text> only renders a stroke when both are set; with the
   *  default stroke_width of 0, no stroke is drawn. */
  stroke_color?: string;
  /** Outline thickness in px. 0 = no stroke (default). */
  stroke_width?: number;
}

export interface ImageLayerProps {
  src: string;
  fit: "contain" | "cover" | "fill";
}

export interface PolygonLayerProps {
  fill: string;
  stroke_color: string;
  stroke_width: number;
  /** Flat array of [x1, y1, x2, y2, ...] in layer-local coords (offsets
   *  from the layer's x,y origin). Default: regular pentagon inscribed in
   *  the bounding box, computed at factory time. */
  points: number[];
}

export interface StarLayerProps {
  fill: string;
  stroke_color: string;
  stroke_width: number;
  /** Number of points (outer vertices). 3 = triangle, 4 = diamond/square,
   *  5 = classic star, etc. */
  num_points: number;
  /** Distance of inner vertices from center as a fraction of the outer
   *  radius (0–1). 0.4 produces a standard 5-pointed star; 1.0 produces
   *  a regular polygon with 2×num_points sides. */
  inner_radius_ratio: number;
}

/** Separate from StarLayerProps even though star with num_points=3 produces
 *  a triangle shape — this type's `direction` property lets it point left or
 *  right (a play-glyph triangle), which a star can't express. Both types are
 *  kept because the direction parameter is a real differentiator that nobody
 *  should "simplify" away later. */
export interface TriangleLayerProps {
  fill: string;
  stroke_color: string;
  stroke_width: number;
  direction: "up" | "down" | "left" | "right";
}

/** Open path with no fill. Layer-local endpoints so the existing transform
 *  (move/rotate/scale) still works on the line as a group. Default at
 *  factory time: x1=0, y1=0, x2=width, y2=height, spanning the bounding
 *  box corner-to-corner. */
export interface LineLayerProps {
  stroke_color: string;
  stroke_width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Like LineLayerProps but with a filled arrowhead at the (x2,y2) end. */
export interface ArrowLayerProps {
  stroke_color: string;
  stroke_width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Length of the arrowhead along the shaft direction (px). */
  head_size: number;
  /** Half-angle of the arrowhead opening (degrees). Default 30 = 60°
   *  total spread. */
  head_angle: number;
}

export interface VideoLayerProps {
  source_url: string;
  trim_start_ms: number;
  trim_end_ms: number;
  playback_rate: number;
  muted: boolean;
  volume: number;
  fit: "contain" | "cover" | "fill";

  /** Crop, as a fraction (0–1) trimmed off each edge of the layer's box.
   *  All four default to 0 = no crop, so every existing project is unchanged.
   *
   *  Crop TRIMS, it does not ZOOM: the remaining footage keeps its size and
   *  position and the cropped-away edges become transparent. That matches the
   *  default crop effect in Premiere/Resolve, and it is the only definition
   *  that renders identically in all three renderers from a single CSS
   *  `clip-path: inset(...)` with no geometry math — anything that rescales
   *  has to re-derive object-fit against a different aspect ratio in each
   *  renderer, which is exactly the kind of split that has produced
   *  editor/export divergence here before. To fill the frame with a cropped
   *  region, resize the layer.
   *
   *  Optional (`?`) for the same reason gradient/shadow/visible_* are:
   *  additive decoration most layers never use. Read them through
   *  `cropInset()` below rather than inline, so all three renderers share
   *  one definition. */
  crop_top?: number;
  crop_right?: number;
  crop_bottom?: number;
  crop_left?: number;

  /** Hold a single frame instead of playing. null/absent = play normally.
   *
   *  SOURCE time (a position within the footage), not scene time, so the held
   *  frame stays the same one if the layer is retimed or the scene stretched.
   *  The UI sets it from the playhead via videoSourceTimeMs(). */
  freeze_frame_ms?: number | null;

  /** Variable speed over scene time — slow motion, fast forward, and ramps
   *  between them. Absent or empty = use the constant `playback_rate` above,
   *  so every existing project is untouched.
   *
   *  With ramps present, source time is the INTEGRAL of rate over scene time
   *  rather than a multiplication. See motion/video/speedRamp.ts. */
  speed_keyframes?: SpeedKeyframe[];
}

/** One point on a video layer's speed ramp. `time_ms` is SCENE time (matching
 *  regular Keyframes); `rate` is a playback multiplier where 1 is normal,
 *  0.5 is half speed and 0 holds the frame. Negative rates are rejected by
 *  the backend and clamped to 0 here — source time must never run backwards,
 *  because both renderers seek their <video> elements forward only. */
export interface SpeedKeyframe {
  id: string;
  time_ms: number;
  rate: number;
  easing: EasingType;
  easing_bezier?: [number, number, number, number];
}

/** The CSS `clip-path` value implementing a video layer's crop, or undefined
 *  when the layer isn't cropped.
 *
 *  Shared by MotionCanvas, RenderFrame and SceneThumbnail so a crop cannot
 *  render three different ways. Opposite edges are clamped to leave at least
 *  1% of the frame — a crop of 100% would otherwise make the layer vanish
 *  with no way to grab it back on the canvas. */
export function cropInset(video: VideoLayerProps): string | undefined {
  const top = Math.min(Math.max(video.crop_top ?? 0, 0), 1);
  const right = Math.min(Math.max(video.crop_right ?? 0, 0), 1);
  const bottom = Math.min(Math.max(video.crop_bottom ?? 0, 0), 1);
  const left = Math.min(Math.max(video.crop_left ?? 0, 0), 1);
  if (!top && !right && !bottom && !left) return undefined;

  const vScale = top + bottom > 0.99 ? 0.99 / (top + bottom) : 1;
  const hScale = left + right > 0.99 ? 0.99 / (left + right) : 1;
  const pct = (v: number) => `${(v * 100).toFixed(4)}%`;
  return `inset(${pct(top * vScale)} ${pct(right * hScale)} ${pct(bottom * vScale)} ${pct(left * hScale)})`;
}

/** Scene time → time within the source footage, in ms.
 *
 *  THE one definition of that mapping. The editor canvas and the export
 *  renderer must agree exactly or the editor lies about what you'll get —
 *  a divergence that has bitten this project before — so both call this
 *  rather than reimplementing it. They previously did reimplement it, and
 *  had in fact drifted: the export subtracted `visibleStartMs` and the
 *  editor did not, so a video layer that starts partway into the scene
 *  previewed one frame and exported another. The export's reading is the
 *  correct one (footage begins at its trim point when the layer appears,
 *  rather than being already partway through), so that is what this does.
 *
 *  A frozen layer ignores the playhead entirely and returns its held frame. */
export function videoSourceTimeMs(
  video: VideoLayerProps,
  playheadMs: number,
  visibleStartMs = 0,
): number {
  if (video.freeze_frame_ms != null) return Math.max(0, video.freeze_frame_ms);

  // A speed ramp replaces the constant-rate multiplication with an integral —
  // see motion/video/speedRamp.ts. With no ramp points this branch is skipped
  // entirely and the arithmetic below is bit-for-bit what it always was.
  const ramp = video.speed_keyframes;
  const raw =
    ramp && ramp.length > 0
      ? video.trim_start_ms + rampedSourceElapsedMs(ramp, playheadMs, visibleStartMs)
      : video.trim_start_ms + (playheadMs - visibleStartMs) * (video.playback_rate || 1);
  // trim_end_ms of 0 means "no end trim" (the model's default), not "trim
  // everything" — only clamp when a real end point was set.
  const clamped = video.trim_end_ms > 0 ? Math.min(raw, video.trim_end_ms) : raw;
  return Math.max(0, clamped);
}

export type AudioTrackKind = "voiceover" | "music" | "sfx";

// Visual effect props (GradientFill / ShadowEffect, imported at the top) are
// folded in from motion/gradients/gradientTypes.ts and motion/shadowfx/
// shadowTypes.ts. They live on MotionLayer rather than on the per-shape props
// so a single layer carries one effect regardless of its shape — keeps the
// model simple and lets the renderers (MotionCanvas / RenderFrame /
// SceneThumbnail) share one <defs>/<filter> per layer.

export interface AudioKeyframe {
  id: string;
  time_ms: number;
  value: number; // 0.0-1.0 volume
  easing: EasingType;
}

export interface AudioMarker {
  id: string;
  time_ms: number;
  label: string;
  color: string;
}

export interface AudioTrack {
  id: string;
  name: string;
  kind: AudioTrackKind;
  source_url: string;
  start_time_ms: number;
  duration_ms: number;
  volume: number;
  volume_keyframes: AudioKeyframe[];
  fade_in_ms: number;
  fade_out_ms: number;
  muted: boolean;
  solo: boolean;
  /** Optional markers on the audio track for syncing animation to speech/beats. */
  markers?: AudioMarker[];
  /** LT-AUDIODUCK: only meaningful on a music/sfx track. See models.py's
   *  AudioTrack.ducking_enabled for what it does at export time — this is
   *  just the on/off switch the UI shows. */
  ducking_enabled?: boolean;
}

export interface MotionLayer {
  id: string;
  name: string;
  type: LayerType;
  transform: Transform;
  locked: boolean;
  hidden: boolean;
  color?: string | null;
  parent_id?: string | null;
  is_folder?: boolean;
  rect: RectLayerProps | null;
  ellipse: EllipseLayerProps | null;
  text: TextLayerProps | null;
  image: ImageLayerProps | null;
  video: VideoLayerProps | null;
  polygon?: PolygonLayerProps | null;
  star?: StarLayerProps | null;
  triangle?: TriangleLayerProps | null;
  line?: LineLayerProps | null;
  arrow?: ArrowLayerProps | null;

  /** Optional gradient fill — when set, the renderers use a <linearGradient>/
   *  <radialGradient> in place of the rect/ellipse/text fill color. Absent or
   *  null = plain solid fill from rect.fill / ellipse.fill / text.color.
   *
   *  Optional (`?`) rather than required-null like the shape props above.
   *  Those five discriminate the layer's type and carry an exactly-one-
   *  non-null invariant, so spelling every one of them out at each call site
   *  is a useful check. These two are additive decoration that most layers
   *  never use — forcing `gradient: null, shadow: null` into forty-odd
   *  factory call sites would be noise, not safety. */
  gradient?: GradientFill | null;
  /** Optional drop-shadow or centered glow — when set, the renderers wrap
   *  the shape in an SVG <filter><feDropShadow>. glow=true means centered
   *  glow (offset 0,0); glow=false means offset drop shadow. */
  shadow?: ShadowEffect | null;
  /** Optional brightness/contrast/saturation/hue adjustment. Identity values
   *  (1,1,1,0) — the defaults — render byte-identical to no grade at all.
   *  Built into a single SVG <filter> by colorGrade.ts, the one definition
   *  all three renderers share. */
  color_grade?: ColorGrade | null;
  /** Optional CSS mix-blend-mode (LT-LAYERBLEND). Absent or null = normal
   *  blending, which is the historical behaviour and what every existing
   *  project relies on — the renderers apply NO style at all in that case,
   *  not `mix-blend-mode: normal`, so the rendered SVG is byte-identical
   *  to before this feature existed. The set of valid values mirrors the
   *  backend `BlendMode` Literal in models.py one-for-one; the shared
   *  helper in motion/blend/blendMode.ts is the single source of truth on
   *  how to translate this field into a CSS style — none of the three
   *  renderers reads it directly. */
  blend_mode?: BlendMode | null;

  /** Optional scene-time visibility window. A layer is rendered only during
   *  [visible_start_ms ?? 0, visible_end_ms ?? scene.duration_ms). null on
   *  either side = "use the scene default", so an unset pair matches
   *  today's "every layer is visible the whole scene" behaviour and no
   *  existing project visually changes.
   *
   *  These are in SCENE time (when the layer appears on the timeline), not
   *  SOURCE time — VideoLayerProps.trim_start_ms/trim_end_ms already cover
   *  "which part of the source footage plays", and the two are orthogonal.
   *  Renderers/evaluators gate the layer at the top via isLayerVisibleAt().
   *
   *  Optional (`?`) for the same reason gradient/shadow are: additive
   *  behaviour most layers don't use, and forcing every factory call site
   *  to spell out `visible_start_ms: null, visible_end_ms: null` would be
   *  noise. v1: keyframes stay scene-absolute and do NOT move when a layer
   *  is retimed (keyframes outside the visible range simply stop having
   *  effect because the layer isn't drawn there). v2 "drag layer + its
   *  keyframes together" is a flagged refinement, not built today. */
  visible_start_ms?: number | null;
  visible_end_ms?: number | null;
  keyframes: Keyframe[];
}

/** Which point of a layer's axis-aligned bounding box a connector attaches
 *  to. v1 only creates connectors with "center" on both ends (no side-picker
 *  UI yet), but the model carries the full enum so adding a side picker
 *  later doesn't change the wire format — a rename of a serialised field
 *  would be a real break, an unused enum value costs nothing. */
export type ConnectorEndAnchor = "center" | "top" | "right" | "bottom" | "left";

export interface ConnectorEndpoint {
  layer_id: string;
  anchor: ConnectorEndAnchor;
}

/** A connection between two layers that follows its endpoints when either
 *  layer moves / is resized / animates. Endpoints are LAYER-ANCHORED (not
 *  absolute points): the renderer resolves a concrete {x,y} for each end at
 *  draw time from the source/target layer's current transform — see
 *  resolveConnectorEndpoints in motion/connectorGeometry.ts. That keeps
 *  move/resize/animation following for free, with no sync plumbing.
 *
 *  Field names are `source` / `target`, not `from` / `to`, because `from`
 *  is a Python keyword and Pydantic aliasing would split the wire format
 *  between disk-serialised and HTTP-serialised JSON in this codebase
 *  (storage uses model_dump_json without by_alias; FastAPI defaults to true).
 *  Using plain names with no alias avoids the split entirely. */
export interface MotionConnector {
  id: string;
  name: string;
  source: ConnectorEndpoint;
  target: ConnectorEndpoint;
  style: ConnectorStyle;
  stroke_color: string;
  stroke_width: number;
  dash_pattern: string | null;
  animated: boolean;
}

export interface MotionScene {
  id: string;
  name: string;
  width: number;
  height: number;
  duration_ms: number;
  background_color: string;
  layers: MotionLayer[];
  audio_tracks: AudioTrack[];
  /** Optional markers on the scene timeline. */
  markers?: SceneMarker[];
  /** Optional connectors between layers. Flat list per scene — a connector
   *  is a relationship between two layers, so storing it on either side
   *  would create an asymmetry around which side owns deletion; a flat
   *  scene-level list mirrors how audio_tracks already work.
   *
   *  Optional (`?`) and defaulted on the backend so existing project JSON
   *  deserialises unchanged and no layer-factory call site has to spell
   *  out `connectors: []`. */
  connectors?: MotionConnector[];
  /** The entrance transition for this scene. A null/undefined value means
   *  no transition — the previous scene cuts directly to this one. The
   *  transition keyframes themselves are generated and stored on each
   *  layer via applyTransitionToScene at the time the transition is picked;
   *  this field is a reference so the picker can show what's active. */
  transition_id?: string | null;
  /** The duration of the entrance transition in milliseconds. Null/undefined
   *  means use the default (600ms). Stored alongside transition_id so the
   *  keyframes generated by applyTransitionToScene can be reconstructed at
   *  the same duration the user chose. */
  transition_duration_ms?: number | null;
}

export interface MotionProject {
  id: string;
  name: string;
  scenes: MotionScene[];
  created_at: string;
  updated_at: string;
}

/** Whether `layer` is on screen at `timeMs` (scene time). A layer with no
 *  visible_start_ms / visible_end_ms set is visible for the entire scene
 *  — the historical behaviour, so all existing projects keep their
 *  current appearance. visible_end_ms beyond sceneDurationMs is allowed
 *  (a dragged handle can run off the right edge); we clamp it here. A
 *  negative visible_start_ms is also allowed (preset keyframes already
 *  start negative to animate "in" by time 0).
 *
 *  Pure, no React/editor dependency — renderers (MotionCanvas, RenderFrame,
 *  SceneThumbnail) and the timeline both call it. */
export function isLayerVisibleAt(
  layer: MotionLayer,
  sceneDurationMs: number,
  timeMs: number,
): boolean {
  const start = layer.visible_start_ms ?? 0;
  const end = layer.visible_end_ms ?? sceneDurationMs;
  return timeMs >= start && timeMs < end;
}
