/**
 * Speed ramps for video layers (LT-SPEEDRAMP).
 *
 * With a constant playback_rate, source time is a multiplication:
 *
 *     sourceElapsed = localTime * rate
 *
 * With a ramp it is an INTEGRAL, because the rate itself changes with time:
 *
 *     sourceElapsed(T) = ∫₀ᵀ rate(u) du
 *
 * That distinction is the whole difficulty. You cannot compute frame N on its
 * own — how far into the footage you are depends on every moment before it.
 * A 900-frame export that re-integrated from zero for each frame would be
 * O(n²) and visibly slow, so this module precomputes one cumulative table per
 * distinct speed_keyframes array and reuses it.
 *
 * Both the editor canvas and the export renderer reach this through
 * videoSourceTimeMs() in types/motion.ts. There is deliberately no second
 * implementation: duplicated time mappings are the single most reliable
 * source of editor/export divergence in this project, and this one has
 * already bitten twice.
 */

import { ease } from "../easing";
import type { SpeedKeyframe } from "../../types/motion";

/** Integration step. The rate curve is smooth and bounded, so trapezoid at
 *  this resolution is accurate to well under a millisecond of source time
 *  over a minute of footage — far below one frame at any sane fps, which is
 *  the only precision that can actually be seen. Smaller steps cost memory
 *  in the cumulative table for no visible gain. */
const STEP_MS = 10;

/** Rate at a given scene time, given the ramp points (sorted by time).
 *
 *  Before the first point and after the last one the rate is held flat —
 *  extrapolating a trend outside the range the user actually drew is how you
 *  get a clip that silently accelerates to nothing. */
function rateAt(points: SpeedKeyframe[], timeMs: number): number {
  const first = points[0];
  if (timeMs <= first.time_ms) return Math.max(0, first.rate);
  const last = points[points.length - 1];
  if (timeMs >= last.time_ms) return Math.max(0, last.rate);

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (timeMs >= a.time_ms && timeMs <= b.time_ms) {
      const span = b.time_ms - a.time_ms;
      if (span <= 0) return Math.max(0, b.rate);
      const p = (timeMs - a.time_ms) / span;
      // The easing belongs to the point being travelled TOWARDS, matching how
      // regular keyframes work in this codebase.
      const eased = ease(b.easing, p, b.easing_bezier);
      return Math.max(0, a.rate + (b.rate - a.rate) * eased);
    }
  }
  return Math.max(0, last.rate);
}

interface RampTable {
  /** Scene time the table starts at (the layer's in-point). */
  originMs: number;
  /** cumulative[i] = source ms elapsed by originMs + i * STEP_MS. */
  cumulative: Float64Array;
  /** Rate held beyond the last ramp point, for linear extrapolation. */
  tailRate: number;
  /** Scene time the table ends at. */
  endMs: number;
}

/** One table per (speed_keyframes array identity, origin). Keyed weakly on
 *  the array so a project reload or an edit that produces a new array drops
 *  the old entry automatically — no manual invalidation to forget. */
const tableCache = new WeakMap<SpeedKeyframe[], Map<number, RampTable>>();

function buildTable(points: SpeedKeyframe[], originMs: number): RampTable {
  const sorted = [...points].sort((a, b) => a.time_ms - b.time_ms);
  const endMs = Math.max(originMs, sorted[sorted.length - 1].time_ms);
  const steps = Math.max(1, Math.ceil((endMs - originMs) / STEP_MS));
  const cumulative = new Float64Array(steps + 1);

  // Trapezoid rule. Monotonic by construction: rateAt is clamped to >= 0, so
  // every increment is >= 0 and source time can never run backwards.
  let acc = 0;
  let prevRate = rateAt(sorted, originMs);
  cumulative[0] = 0;
  for (let i = 1; i <= steps; i++) {
    const t = originMs + i * STEP_MS;
    const r = rateAt(sorted, t);
    acc += ((prevRate + r) / 2) * STEP_MS;
    cumulative[i] = acc;
    prevRate = r;
  }

  return {
    originMs,
    cumulative,
    tailRate: Math.max(0, sorted[sorted.length - 1].rate),
    endMs,
  };
}

function tableFor(points: SpeedKeyframe[], originMs: number): RampTable {
  let byOrigin = tableCache.get(points);
  if (!byOrigin) {
    byOrigin = new Map();
    tableCache.set(points, byOrigin);
  }
  let table = byOrigin.get(originMs);
  if (!table) {
    table = buildTable(points, originMs);
    byOrigin.set(originMs, table);
  }
  return table;
}

/**
 * Source-time elapsed, in ms, between the layer's in-point and `playheadMs`.
 *
 * Guaranteed non-decreasing in `playheadMs`: rates are clamped to >= 0, so a
 * ramp can hold a frame (rate 0) but can never rewind. Reverse playback would
 * need a different design — the <video> elements are seeked forward-only by
 * both renderers — and is deliberately not supported.
 */
export function rampedSourceElapsedMs(
  points: SpeedKeyframe[],
  playheadMs: number,
  visibleStartMs: number,
): number {
  if (points.length === 0) return 0;
  const local = playheadMs - visibleStartMs;
  if (local <= 0) return 0;

  const table = tableFor(points, visibleStartMs);
  const { cumulative, endMs, tailRate } = table;

  if (playheadMs >= endMs) {
    // Past the last ramp point the rate is flat, so extrapolate linearly
    // rather than extending the table forever.
    return cumulative[cumulative.length - 1] + (playheadMs - endMs) * tailRate;
  }

  // Linear interpolation within the step, so scrubbing is smooth rather than
  // quantised to STEP_MS.
  const exact = (playheadMs - visibleStartMs) / STEP_MS;
  const i = Math.floor(exact);
  const frac = exact - i;
  const a = cumulative[i];
  const b = cumulative[Math.min(i + 1, cumulative.length - 1)];
  return a + (b - a) * frac;
}
