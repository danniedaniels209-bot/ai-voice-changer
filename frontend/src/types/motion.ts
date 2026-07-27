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

export type LayerType = "rect" | "ellipse" | "text" | "image" | "video";
export type AnimatableProperty = "x" | "y" | "width" | "height" | "rotation" | "opacity";
export type EasingType = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "bounce" | "elastic";

export interface Keyframe {
  id: string;
  time_ms: number;
  property: AnimatableProperty;
  value: number;
  easing: EasingType;
}

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0-1
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
}

export interface ImageLayerProps {
  src: string;
  fit: "contain" | "cover" | "fill";
}

export interface VideoLayerProps {
  source_url: string;
  trim_start_ms: number;
  trim_end_ms: number;
  playback_rate: number;
  muted: boolean;
  volume: number;
  fit: "contain" | "cover" | "fill";
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
}

export interface MotionLayer {
  id: string;
  name: string;
  type: LayerType;
  transform: Transform;
  locked: boolean;
  hidden: boolean;
  rect: RectLayerProps | null;
  ellipse: EllipseLayerProps | null;
  text: TextLayerProps | null;
  image: ImageLayerProps | null;
  video: VideoLayerProps | null;
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
  keyframes: Keyframe[];
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
}

export interface MotionProject {
  id: string;
  name: string;
  scenes: MotionScene[];
  created_at: string;
  updated_at: string;
}
