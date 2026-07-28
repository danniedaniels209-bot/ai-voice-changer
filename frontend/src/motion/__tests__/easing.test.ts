/**
 * Property tests for the easing functions.
 *
 * The rules here aren't stylistic — each one corresponds to a visible bug:
 *
 *   ease(t, 0) === 0 and ease(t, 1) === 1
 *     An easing that doesn't start at 0 or land exactly on 1 makes every
 *     animation using it jump at its start or end. Keyframe interpolation is
 *     `k1.value + (k2.value - k1.value) * eased`, so eased(1) !== 1 means the
 *     property never actually reaches the keyframe's value.
 *
 *   clamping
 *     ease() is documented as the single place raw progress gets clamped.
 *     Callers pass unclamped values, so out-of-range input must not escape.
 *
 *   overshoot behaviour
 *     `overshoot` and `elastic` are SUPPOSED to exceed 1 mid-curve — that's
 *     the effect. This asserts they do, so a future "fix" that clamps them
 *     into [0,1] (which would silently turn them into ease_out) gets caught.
 */

import { describe, expect, it } from "vitest";
import { ease, interpolateProperty } from "../easing";
import type { EasingType, Keyframe } from "../../types/motion";

const ALL_EASINGS: EasingType[] = [
  "linear",
  "ease_in",
  "ease_out",
  "ease_in_out",
  "bounce",
  "elastic",
  "spring",
  "overshoot",
];

/** Easings that deliberately exceed the [0,1] range mid-curve. */
const OVERSHOOTING: EasingType[] = ["elastic", "spring", "overshoot"];

describe("ease", () => {
  it.each(ALL_EASINGS)("%s starts at exactly 0", (type) => {
    expect(ease(type, 0)).toBe(0);
  });

  it.each(ALL_EASINGS)("%s lands on exactly 1", (type) => {
    // Not toBeCloseTo — an easing that ends at 0.9999 leaves the animated
    // property fractionally short of its keyframe forever.
    expect(ease(type, 1)).toBeCloseTo(1, 10);
  });

  it.each(ALL_EASINGS)("%s clamps input below 0", (type) => {
    expect(ease(type, -5)).toBe(ease(type, 0));
  });

  it.each(ALL_EASINGS)("%s clamps input above 1", (type) => {
    expect(ease(type, 5)).toBe(ease(type, 1));
  });

  it.each(ALL_EASINGS)("%s returns a finite number across the curve", (type) => {
    for (let i = 0; i <= 100; i++) {
      const v = ease(type, i / 100);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it.each(OVERSHOOTING)("%s actually exceeds 1 somewhere (that's the effect)", (type) => {
    let max = -Infinity;
    for (let i = 0; i <= 1000; i++) max = Math.max(max, ease(type, i / 1000));
    expect(max).toBeGreaterThan(1);
  });

  it.each(ALL_EASINGS.filter((e) => !OVERSHOOTING.includes(e)))(
    "%s stays within [0, 1]",
    (type) => {
      for (let i = 0; i <= 1000; i++) {
        const v = ease(type, i / 1000);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    },
  );

  it("falls back to linear for an unknown easing rather than throwing", () => {
    // Project JSON is user-editable on disk; an unrecognised easing should
    // degrade to linear, not crash the editor.
    expect(ease("not-a-real-easing" as EasingType, 0.5)).toBe(0.5);
  });
});

describe("interpolateProperty", () => {
  const kf = (time_ms: number, value: number, easing: EasingType = "linear"): Keyframe => ({
    id: `k${time_ms}`,
    time_ms,
    property: "x",
    value,
    easing,
  });

  it("returns the fallback when the property has no keyframes", () => {
    expect(interpolateProperty([], "x", 500, 42)).toBe(42);
  });

  it("clamps to the first keyframe's value before it", () => {
    // Deliberate: adding a first keyframe must not make a layer jump from
    // wherever it currently sits.
    expect(interpolateProperty([kf(1000, 99)], "x", 0, 5)).toBe(99);
  });

  it("clamps to the last keyframe's value after it", () => {
    expect(interpolateProperty([kf(0, 1), kf(100, 99)], "x", 99999, 5)).toBe(99);
  });

  it("interpolates linearly between two keyframes", () => {
    expect(interpolateProperty([kf(0, 0), kf(1000, 100)], "x", 500, 0)).toBeCloseTo(50, 6);
  });

  it("reaches the target value exactly at the later keyframe, for every easing", () => {
    // The end-to-end version of the ease(_,1)===1 rule: whatever the easing,
    // the property must actually arrive at the keyframe's value.
    for (const easing of ALL_EASINGS) {
      const v = interpolateProperty([kf(0, 0), kf(1000, 100, easing)], "x", 1000, 0);
      expect(v).toBeCloseTo(100, 6);
    }
  });

  it("ignores keyframes belonging to other properties", () => {
    const mixed: Keyframe[] = [
      { id: "a", time_ms: 0, property: "y", value: 999, easing: "linear" },
      kf(0, 10),
      kf(1000, 20),
    ];
    expect(interpolateProperty(mixed, "x", 0, 0)).toBe(10);
  });
});
