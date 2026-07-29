/**
 * Speed ramps (LT-SPEEDRAMP).
 *
 * The property that matters is that source time is an INTEGRAL of rate over
 * scene time, not a multiplication, and that it is monotonic. A ramp that
 * goes backwards would make the renderers seek a <video> element backwards,
 * which neither is built to do.
 *
 * The no-ramp cases are here too, because the one thing this feature must not
 * do is change what an existing project looks like.
 */

import { describe, expect, it } from "vitest";
import { rampedSourceElapsedMs } from "../video/speedRamp";
import { videoSourceTimeMs } from "../../types/motion";
import type { SpeedKeyframe, VideoLayerProps } from "../../types/motion";

function kf(time_ms: number, rate: number, easing: SpeedKeyframe["easing"] = "linear"): SpeedKeyframe {
  return { id: `k${time_ms}`, time_ms, rate, easing };
}

function video(patch: Partial<VideoLayerProps> = {}): VideoLayerProps {
  return {
    source_url: "/a.mp4", trim_start_ms: 0, trim_end_ms: 0,
    playback_rate: 1, muted: false, volume: 1, fit: "contain",
    ...patch,
  };
}

describe("rampedSourceElapsedMs", () => {
  it("matches a plain multiplication when the rate is constant", () => {
    const ramp = [kf(0, 2), kf(4000, 2)];
    expect(rampedSourceElapsedMs(ramp, 1000, 0)).toBeCloseTo(2000, 3);
    expect(rampedSourceElapsedMs(ramp, 2000, 0)).toBeCloseTo(4000, 3);
  });

  it("integrates a linear ramp to the area under it, not the endpoint rate", () => {
    // Rate goes 0 -> 2 linearly over 2s. The area is ½ · 2s · 2 = 2s of
    // source. Multiplying by the final rate would wrongly give 4s.
    const ramp = [kf(0, 0), kf(2000, 2)];
    expect(rampedSourceElapsedMs(ramp, 2000, 0)).toBeCloseTo(2000, 0);
  });

  it("is monotonic non-decreasing across the whole ramp", () => {
    const ramp = [kf(0, 0.25), kf(1000, 3), kf(2000, 0), kf(3000, 1.5)];
    let prev = -1;
    for (let t = 0; t <= 4000; t += 25) {
      const v = rampedSourceElapsedMs(ramp, t, 0);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("holds the frame while the rate is 0", () => {
    const ramp = [kf(0, 0), kf(2000, 0)];
    expect(rampedSourceElapsedMs(ramp, 500, 0)).toBeCloseTo(0, 6);
    expect(rampedSourceElapsedMs(ramp, 2000, 0)).toBeCloseTo(0, 6);
  });

  it("clamps a negative rate to 0 rather than rewinding", () => {
    // The backend rejects these; this is the defensive half, for a project
    // JSON edited by hand.
    const ramp = [kf(0, -5), kf(1000, -5)];
    expect(rampedSourceElapsedMs(ramp, 1000, 0)).toBeCloseTo(0, 6);
  });

  it("holds the last rate flat past the final point instead of extrapolating", () => {
    const ramp = [kf(0, 1), kf(1000, 3)];
    const atEnd = rampedSourceElapsedMs(ramp, 1000, 0);
    // One more second at rate 3.
    expect(rampedSourceElapsedMs(ramp, 2000, 0)).toBeCloseTo(atEnd + 3000, 0);
  });

  it("holds the first rate flat before the first point", () => {
    const ramp = [kf(1000, 2), kf(2000, 2)];
    expect(rampedSourceElapsedMs(ramp, 500, 0)).toBeCloseTo(1000, 0);
  });

  it("measures from the layer's in-point, not from scene zero", () => {
    const ramp = [kf(2000, 2), kf(4000, 2)];
    expect(rampedSourceElapsedMs(ramp, 2000, 2000)).toBeCloseTo(0, 6);
    expect(rampedSourceElapsedMs(ramp, 3000, 2000)).toBeCloseTo(2000, 0);
  });

  it("returns 0 before the layer appears", () => {
    expect(rampedSourceElapsedMs([kf(0, 2)], 500, 2000)).toBe(0);
  });

  it("gives the same answer whether called forwards or at random", () => {
    // The cumulative table is shared and mutable-looking; make sure lookups
    // don't depend on call order, which an export (sequential) and an editor
    // (scrubbing) would otherwise disagree about.
    const ramp = [kf(0, 0.5), kf(1500, 2.5), kf(3000, 1)];
    const forwards: number[] = [];
    for (let t = 0; t <= 3000; t += 100) forwards.push(rampedSourceElapsedMs(ramp, t, 0));
    const shuffled = [2000, 100, 2900, 700, 1500];
    for (const t of shuffled) {
      expect(rampedSourceElapsedMs(ramp, t, 0)).toBeCloseTo(forwards[t / 100], 6);
    }
  });

  it("costs the same per lookup on the 900th frame as the 1st", () => {
    // Guards the O(n^2) trap: re-integrating from zero for every frame.
    const ramp = [kf(0, 0.5), kf(15000, 2), kf(30000, 1)];
    const time = (t: number) => {
      const s = performance.now();
      for (let i = 0; i < 200; i++) rampedSourceElapsedMs(ramp, t, 0);
      return performance.now() - s;
    };
    time(100); // warm the table
    const early = time(100);
    const late = time(29000);
    expect(late).toBeLessThan(Math.max(early * 8, 12));
  });
});

describe("videoSourceTimeMs with ramps", () => {
  it("is unchanged, exactly, when there are no ramp points", () => {
    for (const ramp of [undefined, []]) {
      const v = video({ trim_start_ms: 250, playback_rate: 2, speed_keyframes: ramp });
      expect(videoSourceTimeMs(v, 3000, 1000)).toBe(250 + 2000 * 2);
    }
  });

  it("adds the integral onto trim_start_ms", () => {
    const v = video({ trim_start_ms: 500, speed_keyframes: [kf(0, 2), kf(1000, 2)] });
    expect(videoSourceTimeMs(v, 1000, 0)).toBeCloseTo(2500, 0);
  });

  it("lets freeze_frame_ms win over the ramp", () => {
    const v = video({ freeze_frame_ms: 700, speed_keyframes: [kf(0, 4), kf(1000, 4)] });
    expect(videoSourceTimeMs(v, 0, 0)).toBe(700);
    expect(videoSourceTimeMs(v, 5000, 0)).toBe(700);
  });

  it("still respects trim_end_ms as a ceiling", () => {
    const v = video({ trim_end_ms: 1200, speed_keyframes: [kf(0, 8), kf(1000, 8)] });
    expect(videoSourceTimeMs(v, 1000, 0)).toBe(1200);
  });
});
