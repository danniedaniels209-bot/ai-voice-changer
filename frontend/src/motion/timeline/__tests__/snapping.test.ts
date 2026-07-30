import { describe, it, expect } from "vitest";
import { findSnap } from "../snapping";

describe("findSnap", () => {
  it("returns the closest target within threshold", () => {
    // 80 px/s: 8px = 100ms. 500-420=80ms < 100ms → snaps to 420
    expect(findSnap(500, [0, 420, 1000], 80)).toBe(420);
  });

  it("returns null when no target is within threshold", () => {
    // 500-300=200ms > 100ms threshold at 80px/s → null
    expect(findSnap(500, [300], 80)).toBeNull();
  });

  it("returns closest of several targets", () => {
    // All within threshold; picks the closest (490)
    expect(findSnap(500, [490, 510, 400], 80)).toBe(490);
  });

  it("returns null for empty targets", () => {
    expect(findSnap(500, [], 80)).toBeNull();
  });

  it("snaps just inside the threshold boundary", () => {
    // 40 px/s: 8px = 200ms. 500-451=49ms < 200ms → snaps
    expect(findSnap(500, [451], 40)).toBe(451);
  });

  it("returns null just past the threshold boundary", () => {
    // 40 px/s: 8px = 200ms. 500-300=200ms, not < 200ms → null
    expect(findSnap(500, [300], 40)).toBeNull();
  });
});
