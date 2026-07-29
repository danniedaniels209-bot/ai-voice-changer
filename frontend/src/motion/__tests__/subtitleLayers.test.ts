/**
 * LT-SUBTITLES unit tests.
 *
 * These are the CHEAP half of the verification and they are not the proof.
 * Per house rule 2, the bug in a feature like this lives in the seam between
 * the generator and the renderers — a caption whose object looks perfect but
 * lands in the wrong place, or is on screen at the wrong time, in the
 * exported video. That is verified by exporting real frames and inspecting
 * pixels (see the chat log). What these tests pin down is the part pixels
 * can't show cheaply: parsing edge cases, timing arithmetic, and the
 * invariants that must hold for EVERY cue in a long file.
 */

import { describe, it, expect } from "vitest";
import { isLayerVisibleAt } from "../../types/motion";
import { getPreset } from "../../subtitle/presets";
import { wrapTextToLines } from "../textWrap";
import { parseSubtitles, parseTimestamp } from "../subtitles/subtitleParse";
import { subtitleCuesToLayers } from "../subtitles/subtitleLayers";

const SRT = `1
00:00:01,000 --> 00:00:03,000
First caption

2
00:00:04,500 --> 00:00:06,000
Second caption
on two lines

3
00:00:07,000 --> 00:00:09,000
<i>Third</i> caption
`;

const SCENE = { sceneWidth: 1920, sceneHeight: 1080, sceneDurationMs: 10000 };

function gen(src: string, presetId = "classic", extra: Record<string, unknown> = {}) {
  const { cues } = parseSubtitles(src);
  return subtitleCuesToLayers(cues, { style: getPreset(presetId), ...SCENE, ...extra });
}

describe("parseTimestamp", () => {
  it("reads SRT comma and VTT dot forms identically", () => {
    expect(parseTimestamp("00:00:01,500")).toBe(1.5);
    expect(parseTimestamp("00:00:01.500")).toBe(1.5);
  });
  it("reads the VTT short form with no hours", () => {
    expect(parseTimestamp("01:30.250")).toBe(90.25);
  });
  it("treats a short fraction as tenths/hundredths, not thousandths", () => {
    expect(parseTimestamp("00:00:01.5")).toBe(1.5);
    expect(parseTimestamp("00:00:01.05")).toBe(1.05);
  });
  it("returns null rather than 0 for garbage", () => {
    expect(parseTimestamp("not a time")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });
});

describe("parseSubtitles", () => {
  it("parses SRT and strips inline markup", () => {
    const r = parseSubtitles(SRT);
    expect(r.format).toBe("srt");
    expect(r.cues).toHaveLength(3);
    expect(r.cues[2].text).toBe("Third caption");
    expect(r.cues[1].text).toBe("Second caption\non two lines");
  });

  it("parses WebVTT with cue ids, settings and NOTE blocks", () => {
    const r = parseSubtitles(
      "WEBVTT\n\nNOTE this is a comment\nspanning two lines\n\nintro\n00:00.000 --> 00:02.000 line:90% align:center\nHello\n",
    );
    expect(r.format).toBe("vtt");
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0]).toMatchObject({ start: 0, end: 2, text: "Hello" });
  });

  it("survives a UTF-8 BOM and CRLF line endings", () => {
    const r = parseSubtitles("﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n");
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0].text).toBe("Hi");
  });

  it("keeps the good cues and WARNS about the bad ones instead of failing the file", () => {
    const r = parseSubtitles(
      "1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\n99:bad --> 00:00:04,000\nBad\n\n3\n00:00:06,000 --> 00:00:05,000\nBackwards\n",
    );
    expect(r.cues.map((c) => c.text)).toEqual(["Good"]);
    expect(r.warnings).toHaveLength(2);
  });

  it("sorts out-of-order cues, because findActiveCue binary-searches", () => {
    const r = parseSubtitles(
      "1\n00:00:05,000 --> 00:00:06,000\nLater\n\n2\n00:00:01,000 --> 00:00:02,000\nEarlier\n",
    );
    expect(r.cues.map((c) => c.text)).toEqual(["Earlier", "Later"]);
  });

  it("reports overlapping cues rather than silently trimming them", () => {
    const r = parseSubtitles(
      "1\n00:00:01,000 --> 00:00:05,000\nA\n\n2\n00:00:03,000 --> 00:00:06,000\nB\n",
    );
    expect(r.cues).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/overlap/);
  });
});

describe("subtitleCuesToLayers — timing", () => {
  it("sets the visibility window from the cue timings, in ms", () => {
    const { layers } = gen(SRT);
    expect(layers).toHaveLength(3);
    expect(layers.map((l) => [l.visible_start_ms, l.visible_end_ms])).toEqual([
      [1000, 3000],
      [4500, 6000],
      [7000, 9000],
    ]);
  });

  it("is visible only inside its window, as the renderers evaluate it", () => {
    const { layers } = gen(SRT);
    const first = layers[0];
    expect(isLayerVisibleAt(first, 10000, 999)).toBe(false);
    expect(isLayerVisibleAt(first, 10000, 1000)).toBe(true);
    expect(isLayerVisibleAt(first, 10000, 2999)).toBe(true);
    // Half-open: the end instant belongs to the NEXT caption, not this one.
    expect(isLayerVisibleAt(first, 10000, 3000)).toBe(false);
  });

  it("never has two whole-line captions on screen at once for a non-overlapping file", () => {
    const { layers } = gen(SRT);
    for (let t = 0; t <= 10000; t += 50) {
      const visible = layers.filter((l) => isLayerVisibleAt(l, 10000, t));
      expect(visible.length).toBeLessThanOrEqual(1);
    }
  });

  it("shifts every caption by the offset", () => {
    const { layers } = gen(SRT, "classic", { offsetMs: 500 });
    expect(layers[0].visible_start_ms).toBe(1500);
    expect(layers[0].visible_end_ms).toBe(3500);
  });

  it("drops cues that fall entirely outside the scene and says how many", () => {
    const r = gen(SRT, "classic", { sceneDurationMs: 4000 });
    expect(r.droppedCueCount).toBe(2);
    expect(r.layers).toHaveLength(1);
    expect(r.notes.join(" ")).toMatch(/2 caption\(s\) fall outside/);
  });

  it("does NOT clamp a caption that merely straddles the scene end", () => {
    // Clamping would silently retime the caption against its audio.
    const r = gen(SRT, "classic", { sceneDurationMs: 8000 });
    expect(r.layers[2].visible_end_ms).toBe(9000);
  });
});

describe("subtitleCuesToLayers — the model contract", () => {
  it("emits ONLY ordinary layer types with no invented fields", () => {
    const { layers } = gen(SRT, "capcut");
    const allowed = new Set([
      "id", "name", "type", "transform", "locked", "hidden", "rect", "ellipse",
      "text", "image", "video", "shadow", "visible_start_ms", "visible_end_ms", "keyframes",
    ]);
    for (const l of layers) {
      expect(["text", "rect"]).toContain(l.type);
      for (const key of Object.keys(l)) expect(allowed).toContain(key);
    }
  });

  it("gives every layer and every keyframe a distinct id", () => {
    const { layers } = gen(SRT, "capcut");
    const ids = [...layers.map((l) => l.id), ...layers.flatMap((l) => l.keyframes.map((k) => k.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("spells out linear easing on generated keyframes", () => {
    // RenderFrame carries its own interpolator whose no-easing fallback is
    // ease_in_out while MotionCanvas goes through easing.ts — an unstated
    // easing would be an editor/export divergence.
    const { layers } = gen(SRT);
    const ks = layers.flatMap((l) => l.keyframes);
    expect(ks.length).toBeGreaterThan(0);
    for (const k of ks) expect(k.easing).toBe("linear");
  });

  it("fades within the visible window and never outside it", () => {
    const { layers } = gen(SRT);
    for (const l of layers) {
      for (const k of l.keyframes) {
        expect(k.time_ms).toBeGreaterThanOrEqual(l.visible_start_ms!);
        expect(k.time_ms).toBeLessThanOrEqual(l.visible_end_ms!);
      }
    }
  });

  it("does not let the two fades overlap on a very short caption", () => {
    const { layers } = gen("1\n00:00:01,000 --> 00:00:01,100\nBlink\n");
    const times = layers[0].keyframes.map((k) => k.time_ms);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("subtitleCuesToLayers — layout parity with the renderers", () => {
  const LONG =
    "1\n00:00:01,000 --> 00:00:04,000\nThis is a deliberately long caption that has to wrap onto several lines to fit inside the safe area\n";

  it("wraps long captions with the SHARED wrapper, and stores the result as a fixed point", () => {
    const { layers } = gen(LONG);
    const stored = layers[0].text!.text;
    expect(stored).toContain("\n");
    // The renderers re-wrap the stored string. If re-wrapping changed the
    // breaks, the editor and the export would disagree with the box height
    // computed here — so the stored text must survive its own wrapper.
    const rewrapped = wrapTextToLines(stored, {
      maxWidthPx: layers[0].transform.width,
      fontSize: layers[0].text!.font_size,
    });
    expect(rewrapped).toEqual(stored.split("\n"));
  });

  it("keeps a wrapped caption inside the frame and off the bottom edge", () => {
    const { layers } = gen(LONG);
    const t = layers[0].transform;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(1920);
    expect(t.y).toBeGreaterThan(0);
    expect(t.y + t.height).toBeLessThanOrEqual(1080);
    // "bottom, margin 80" — the block's bottom must sit at that margin.
    expect(t.y + t.height).toBeCloseTo(1080 - 80, 0);
  });

  it("scales the whole style to a vertical scene instead of overflowing it", () => {
    const { layers } = gen(SRT, "classic", { sceneWidth: 1080, sceneHeight: 1920 });
    const t = layers[0].transform;
    expect(layers[0].text!.font_size).toBeCloseTo(64 * (1080 / 1920), 5);
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(1080);
    expect(t.y + t.height).toBeCloseTo(1920 - 80 * (1080 / 1920), 0);
  });

  it("anchors top and center presets where they claim to be", () => {
    const bottom = gen(SRT, "classic").layers[0].transform;
    const center = gen(SRT, "word_pop").layers[0].transform;
    expect(center.y + center.height / 2).toBeCloseTo(1080 / 2, 0);
    expect(bottom.y).toBeGreaterThan(center.y);
  });
});

describe("subtitleCuesToLayers — style presets", () => {
  it("word mode emits one layer per word, in order, covering the cue", () => {
    const { layers } = gen("1\n00:00:01,000 --> 00:00:03,000\nfour separate little words\n", "word_pop");
    expect(layers).toHaveLength(4);
    expect(layers.map((l) => l.text!.text)).toEqual(["four", "separate", "little", "words"]);
    expect(layers[0].visible_start_ms).toBe(1000);
    expect(layers[3].visible_end_ms).toBe(3000);
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].visible_start_ms).toBe(layers[i - 1].visible_end_ms);
    }
  });

  it("puts the background band BEHIND its caption and on the same clock", () => {
    const { layers } = gen("1\n00:00:01,000 --> 00:00:03,000\nBanded\n", "capcut");
    const [band, text] = layers;
    expect(band.type).toBe("rect");
    expect(text.type).toBe("text");
    // Array order is paint order in all three renderers.
    expect(layers.indexOf(band)).toBeLessThan(layers.indexOf(text));
    expect(band.visible_start_ms).toBe(text.visible_start_ms);
    expect(band.visible_end_ms).toBe(text.visible_end_ms);
    // The band must actually cover the words it sits behind.
    expect(band.transform.y).toBeLessThanOrEqual(text.transform.y);
    expect(band.transform.y + band.transform.height).toBeGreaterThanOrEqual(
      text.transform.y + text.transform.height,
    );
  });

  it("honours the band opt-out even when the preset wants one", () => {
    const { layers } = gen("1\n00:00:01,000 --> 00:00:03,000\nBanded\n", "capcut", {
      includeBackground: false,
    });
    expect(layers.every((l) => l.type === "text")).toBe(true);
  });

  it("applies the outline from the preset", () => {
    const { layers } = gen(SRT, "classic");
    expect(layers[0].text!.stroke_color).toBe("#000000");
    expect(layers[0].text!.stroke_width).toBe(3);
  });

  it("downgrades karaoke/highlight to whole lines and SAYS so", () => {
    const r = gen(SRT, "karaoke");
    expect(r.layers).toHaveLength(3);
    expect(r.notes.join(" ")).toMatch(/karaoke sweeps colour/i);
  });
});
