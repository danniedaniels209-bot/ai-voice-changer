/**
 * Easing + keyframe interpolation. A layer's `transform` fields are the
 * value used when a property has no keyframes at all (or before its first
 * keyframe) — keyframes only override a property once they exist, so
 * adding a first keyframe never causes a jump from the current on-screen
 * position.
 */

import type { AnimatableProperty, EasingType, Keyframe, MotionLayer, Transform } from "../types/motion";

type EasingFn = (t: number) => number;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

function elasticOut(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

const EASINGS: Record<EasingType, EasingFn> = {
  linear: (t) => t,
  ease_in: (t) => t * t,
  ease_out: (t) => 1 - (1 - t) * (1 - t),
  ease_in_out: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  bounce: bounceOut,
  elastic: elasticOut,
};

/** t is clamped to [0,1] before easing — callers pass raw progress, not
 * pre-clamped, so this is the one place that guarantee is enforced. */
export function ease(type: EasingType, t: number): number {
  const fn = EASINGS[type] ?? EASINGS.linear;
  return fn(Math.min(1, Math.max(0, t)));
}

/** Value of one animatable property at timeMs, interpolating between the
 * two surrounding keyframes (eased by the LATER keyframe's easing — that's
 * the transition arriving AT it). Falls back to `fallback` (the layer's
 * static transform value) when the property has no keyframes. */
export function interpolateProperty(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  timeMs: number,
  fallback: number,
): number {
  const track = keyframes.filter((k) => k.property === property).sort((a, b) => a.time_ms - b.time_ms);
  if (track.length === 0) return fallback;
  if (timeMs <= track[0].time_ms) return track[0].value;
  const last = track[track.length - 1];
  if (timeMs >= last.time_ms) return last.value;

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (timeMs >= a.time_ms && timeMs <= b.time_ms) {
      const span = b.time_ms - a.time_ms;
      const progress = span === 0 ? 1 : (timeMs - a.time_ms) / span;
      return a.value + (b.value - a.value) * ease(b.easing, progress);
    }
  }
  return fallback;
}

/** The full transform for a layer at a point in playback time — what the
 * canvas should actually draw, whether or not any property is animated. */
export function resolveTransformAtTime(layer: MotionLayer, timeMs: number): Transform {
  const t = layer.transform;
  if (layer.keyframes.length === 0) return t;
  return {
    x: interpolateProperty(layer.keyframes, "x", timeMs, t.x),
    y: interpolateProperty(layer.keyframes, "y", timeMs, t.y),
    width: interpolateProperty(layer.keyframes, "width", timeMs, t.width),
    height: interpolateProperty(layer.keyframes, "height", timeMs, t.height),
    rotation: interpolateProperty(layer.keyframes, "rotation", timeMs, t.rotation),
    opacity: interpolateProperty(layer.keyframes, "opacity", timeMs, t.opacity),
  };
}
