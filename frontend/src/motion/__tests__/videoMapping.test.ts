/**
 * The scene-time -> source-time mapping and the crop geometry (LT-VIDEOEDIT).
 *
 * These two functions exist specifically so the editor canvas and the export
 * renderer cannot disagree. They had disagreed: RenderFrame subtracted the
 * layer's visible_start_ms before mapping and VideoLayerView did not, so a
 * video layer that started partway into the scene previewed one frame and
 * exported another. Both now call videoSourceTimeMs, and the visible_start
 * cases below are what stops that regressing.
 */

import { describe, expect, it } from "vitest";
import { cropInset, videoSourceTimeMs } from "../../types/motion";
import type { VideoLayerProps } from "../../types/motion";

function video(patch: Partial<VideoLayerProps> = {}): VideoLayerProps {
  return {
    source_url: "/motion/assets/clip.mp4",
    trim_start_ms: 0,
    trim_end_ms: 0,
    playback_rate: 1,
    muted: false,
    volume: 1,
    fit: "contain",
    ...patch,
  };
}

describe("videoSourceTimeMs", () => {
  it("maps scene time straight through for an untrimmed layer", () => {
    expect(videoSourceTimeMs(video(), 1500)).toBe(1500);
  });

  it("offsets by trim_start_ms", () => {
    expect(videoSourceTimeMs(video({ trim_start_ms: 2000 }), 500)).toBe(2500);
  });

  it("treats trim_end_ms of 0 as 'no end trim', not 'trim everything'", () => {
    expect(videoSourceTimeMs(video({ trim_end_ms: 0 }), 9000)).toBe(9000);
  });

  it("clamps to trim_end_ms once one is set", () => {
    expect(videoSourceTimeMs(video({ trim_end_ms: 3000 }), 9000)).toBe(3000);
  });

  it("scales by playback_rate", () => {
    expect(videoSourceTimeMs(video({ playback_rate: 2 }), 1000)).toBe(2000);
    expect(videoSourceTimeMs(video({ playback_rate: 0.5 }), 1000)).toBe(500);
  });

  it("never returns a negative source time", () => {
    expect(videoSourceTimeMs(video(), -500)).toBe(0);
  });

  // --- the parity cases ---

  it("starts the footage at its trim point when the layer's in-point is reached", () => {
    // Layer appears at 2s. At scene time 2s the viewer should see the FIRST
    // frame of the clip, not the frame 2s in.
    expect(videoSourceTimeMs(video(), 2000, 2000)).toBe(0);
  });

  it("advances from the in-point, not from scene zero", () => {
    expect(videoSourceTimeMs(video(), 3500, 2000)).toBe(1500);
  });

  it("combines an in-point with trim and rate the way both renderers must", () => {
    // in-point 1s, trim 500ms in, double speed, playhead 3s
    //   -> 500 + (3000 - 1000) * 2 = 4500
    expect(
      videoSourceTimeMs(video({ trim_start_ms: 500, playback_rate: 2 }), 3000, 1000),
    ).toBe(4500);
  });

  it("clamps to 0 before the layer's in-point rather than going negative", () => {
    expect(videoSourceTimeMs(video(), 500, 2000)).toBe(0);
  });

  // --- freeze ---

  it("holds the frozen frame regardless of the playhead", () => {
    const frozen = video({ freeze_frame_ms: 1200 });
    expect(videoSourceTimeMs(frozen, 0)).toBe(1200);
    expect(videoSourceTimeMs(frozen, 5000)).toBe(1200);
    expect(videoSourceTimeMs(frozen, 5000, 2000)).toBe(1200);
  });

  it("distinguishes freezing at 0ms from not being frozen", () => {
    expect(videoSourceTimeMs(video({ freeze_frame_ms: 0 }), 4000)).toBe(0);
    expect(videoSourceTimeMs(video({ freeze_frame_ms: null }), 4000)).toBe(4000);
    expect(videoSourceTimeMs(video(), 4000)).toBe(4000);
  });

  it("ignores trim and rate while frozen — the held frame is absolute", () => {
    expect(
      videoSourceTimeMs(
        video({ freeze_frame_ms: 800, trim_start_ms: 3000, playback_rate: 4 }),
        9000,
      ),
    ).toBe(800);
  });
});

describe("cropInset", () => {
  it("returns undefined when nothing is cropped, so no clip-path is emitted", () => {
    expect(cropInset(video())).toBeUndefined();
    expect(
      cropInset(video({ crop_top: 0, crop_right: 0, crop_bottom: 0, crop_left: 0 })),
    ).toBeUndefined();
  });

  it("emits inset() in top right bottom left order", () => {
    const css = cropInset(video({ crop_top: 0.1, crop_right: 0.2, crop_bottom: 0.3, crop_left: 0.4 }));
    expect(css).toMatch(/^inset\(/);
    const nums = css!.match(/[\d.]+(?=%)/g)!.map(Number);
    expect(nums).toEqual([10, 20, 30, 40]);
  });

  it("handles a single cropped edge", () => {
    const nums = cropInset(video({ crop_left: 0.25 }))!.match(/[\d.]+(?=%)/g)!.map(Number);
    expect(nums).toEqual([0, 0, 0, 25]);
  });

  it("leaves a sliver visible when opposite edges would consume the whole frame", () => {
    // Otherwise the layer disappears entirely and there is nothing left on the
    // canvas to grab in order to undo the crop.
    const nums = cropInset(video({ crop_left: 0.8, crop_right: 0.8 }))!
      .match(/[\d.]+(?=%)/g)!
      .map(Number);
    expect(nums[1] + nums[3]).toBeCloseTo(99, 3);
    expect(nums[1]).toBeCloseTo(nums[3], 3); // proportions preserved
  });

  it("preserves the ratio between two unequal over-budget edges", () => {
    const nums = cropInset(video({ crop_top: 0.9, crop_bottom: 0.3 }))!
      .match(/[\d.]+(?=%)/g)!
      .map(Number);
    expect(nums[0] / nums[2]).toBeCloseTo(3, 3);
    expect(nums[0] + nums[2]).toBeCloseTo(99, 3);
  });

  it("clamps out-of-range values rather than emitting nonsense CSS", () => {
    const nums = cropInset(video({ crop_top: -0.5, crop_bottom: 2 }))!
      .match(/[\d.]+(?=%)/g)!
      .map(Number);
    expect(nums[0]).toBe(0);
    expect(nums[2]).toBeLessThanOrEqual(99);
  });
});
