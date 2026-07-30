/**
 * Scrub audio rate limiting (LT-AUDIOSCRUB).
 *
 * The rate limiter is the part that actually matters. A scrub drag fires many
 * times a second; without a floor between grains the same 120ms of audio
 * retriggers ~60x/sec and is heard as a buzz rather than as the underlying
 * track. Stacking is prevented separately (one live source, stopped before
 * the next starts), but that alone does NOT fix the buzz — both are needed.
 *
 * Grains are counted via createBufferSource, which is called exactly once per
 * grain that actually starts. An earlier version of this test counted a spy
 * that only runs inside the async decode continuation, so a synchronous test
 * body observed zero every time and the assertions passed while measuring
 * nothing — hence the explicit flush() below.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

let grainsStarted = 0;

vi.mock("../audio/waveform", () => ({
  getSharedAudioContext: () => ({
    state: "running",
    currentTime: 0,
    resume: () => {},
    createBufferSource: () => {
      grainsStarted += 1;
      return {
        buffer: null,
        connect: () => ({ connect: () => {} }),
        start: () => {},
        stop: () => {},
        onended: null,
      };
    },
    createGain: () => ({
      gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
      connect: () => ({ connect: () => {} }),
    }),
    decodeAudioData: async () => ({ duration: 10 }),
  }),
}));

vi.mock("../../api/motion", () => ({ resolveMotionAssetUrl: (u: string) => u }));

vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));

const { resetScrubAudioForTest, scrubAudioAt } = await import("../audio/scrubAudio");

/** Let the decode promise chain settle so grains actually start. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("scrub audio rate limiting", () => {
  beforeEach(() => {
    resetScrubAudioForTest();
    grainsStarted = 0;
  });

  it("collapses a rapid drag into far fewer grains than events", async () => {
    // A realistic drag: events every ~16ms (60fps), 6 events over 80ms.
    for (let i = 0; i < 6; i++) scrubAudioAt("/a.mp3", 1, 1000 + i * 16);
    await flush();
    expect(grainsStarted).toBeGreaterThan(0); // it does play something
    expect(grainsStarted).toBeLessThanOrEqual(2); // but not once per event
  });

  it("starts another grain once the floor has elapsed", async () => {
    scrubAudioAt("/a.mp3", 1, 1000);
    await flush();
    const afterFirst = grainsStarted;
    expect(afterFirst).toBe(1);

    scrubAudioAt("/a.mp3", 2, 1500); // well past the floor
    await flush();
    expect(grainsStarted).toBe(afterFirst + 1);
  });

  it("plays nothing for an offset past the end of the track", async () => {
    scrubAudioAt("/a.mp3", 99, 2000); // buffer duration is 10s
    await flush();
    expect(grainsStarted).toBe(0);
  });

  it("ignores empty urls and negative offsets rather than throwing", async () => {
    expect(() => scrubAudioAt("", 1, 5000)).not.toThrow();
    expect(() => scrubAudioAt("/a.mp3", -1, 6000)).not.toThrow();
    await flush();
    expect(grainsStarted).toBe(0);
  });

  it("does not go permanently silent after a failed fetch", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    scrubAudioAt("/missing.mp3", 1, 7000);
    await flush();
    expect(grainsStarted).toBe(0);

    // A rejected decode must not be cached, or this url would stay silent
    // for the rest of the session even once it's reachable again.
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    scrubAudioAt("/missing.mp3", 1, 9000);
    await flush();
    expect(grainsStarted).toBe(1);
  });
});
