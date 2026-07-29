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

/** Damped harmonic oscillation that settles ON 1 rather than approaching it
 *  asymptotically. Unlike `elastic` (which is a decaying sine with a fixed
 *  period), spring's amplitude decays exponentially and the frequency is
 *  chosen so the motion reads as a physical settle. Overshoots 1 several
 *  times with decreasing magnitude. */
function springOut(t: number): number {
  if (t === 0 || t === 1) return t;
  const damping = 6;
  const frequency = 12;
  return 1 - Math.exp(-damping * t) * Math.cos(frequency * t);
}

/** Back-out: shoots past the target once, then settles. The 1.70158 constant
 *  is the standard "back" magic number — it makes the curve overshoot by
 *  ~10%, which reads as deliberate rather than as a bug. */
function overshootOut(t: number): number {
  // Endpoints returned exactly rather than computed. The polynomial is
  // mathematically 0 at t=0, but in floating point it evaluates to 2.2e-16,
  // and every other easing here returns a hard 0/1 (elasticOut and springOut
  // special-case theirs too). The visual difference is nil; the point is that
  // "every easing starts at 0 and ends at 1" stays a real invariant rather
  // than an approximate one, so the test for it can be strict.
  if (t === 0 || t === 1) return t;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Evaluate a cubic-bezier curve defined by four control points. The curve is
 *  the parametric cubic (x(t), y(t)) with t ∈ [0, 1], where x(t) is the cubic
 *  with control points (0, x1, x2, 1) and y(t) with (0, y1, y2, 1).
 *
 *  The caller wants y for a given progress x (the eased output progress). We
 *  solve x(t) = targetX via Newton-Raphson, then evaluate y at the solved t.
 *  The result is NOT clamped: see the note on the handles below — a y outside
 *  [0, 1] is a deliberate overshoot, not an error to be flattened.
 *
 *  Algorithm is the standard one used by CSS and every animation library. */
export function cubicBezierFor(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): EasingFn {
  // X is clamped to [0, 1]; Y deliberately is NOT.
  //
  // This is the CSS cubic-bezier() rule, and it isn't arbitrary. x must stay
  // in [0, 1] or the curve stops being a function of progress and the Newton
  // solve below has no unique answer. y outside [0, 1] is the entire point of
  // a custom curve: y > 1 overshoots past the target and settles back, y < 0
  // anticipates by pulling backwards first. Clamping y would silently flatten
  // every expressive curve a user drew into a plain ease, which is the one
  // thing custom easing exists to avoid.
  const cx1 = Math.min(1, Math.max(0, x1 ?? 0));
  const cx2 = Math.min(1, Math.max(0, x2 ?? 1));
  const cy1 = Number.isFinite(y1) ? y1 : 0;
  const cy2 = Number.isFinite(y2) ? y2 : 1;

  // Newton's method: find t such that x(t) == x, where x(t) is described by
  // control verts (0, cx1, cx2, 1). Cubic bezier sample and derivative at t.
  function sampleX (t: number): number {
    const u = 1 - t;
    return 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t;
  }

  function sampleDerivativeX (t: number): number {
    const u = 1 - t;
    return 3 * u * u * cx1 + 6 * u * t * (cx2 - cx1) + 3 * t * t * (1 - cx2);
  }

  function sampleY (t: number): number {
    const u = 1 - t;
    return 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t;
  }

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    // Initial guess: linear (most curves are close to linear near the middle)
    let t = x;
    for (let i = 0; i < 5; i++) {
      const guessX = sampleX(t) - x;
      const dx = sampleDerivativeX(t);
      if (Math.abs(dx) < 1e-12) break;
      t -= guessX / dx;
    }
    // Clamp t — Newton can overshoot for extreme curves.
    t = Math.min(1, Math.max(0, t));
    return sampleY(t);
  };
}

const EASINGS: Record<EasingType, EasingFn> = {
  linear: (t) => t,
  ease_in: (t) => t * t,
  ease_out: (t) => 1 - (1 - t) * (1 - t),
  ease_in_out: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  bounce: bounceOut,
  elastic: elasticOut,
  spring: springOut,
  overshoot: overshootOut,
  // "custom" is a sentinel — the real curve is the per-keyframe
  // easing_bezier tuple. The EASINGS record needs the key to exist
  // so the type is satisfied; if a call site reaches this without
  // providing the bezier, degrade to linear.
  custom: (t) => t,
};

/** t is clamped to [0,1] before easing — callers pass raw progress, not
 * pre-clamped, so this is the one place that guarantee is enforced.
 *
 * When `type === "custom"`, `bezier` must be provided — the four control points
 * (x1, y1, x2, y2) from the keyframe's easing_bezier field. Without them, custom
 * degrades to linear (same as the EASINGS record). */
export function ease(
  type: EasingType,
  t: number,
  bezier?: [number, number, number, number],
): number {
  t = Math.min(1, Math.max(0, t));
  if (type === "custom" && bezier) {
    return cubicBezierFor(bezier[0], bezier[1], bezier[2], bezier[3])(t);
  }
  const fn = EASINGS[type] ?? EASINGS.linear;
  return fn(t);
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
      return a.value + (b.value - a.value) * ease(b.easing, progress, b.easing_bezier);
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
    blur: interpolateProperty(layer.keyframes, "blur", timeMs, t.blur),
  };
}
