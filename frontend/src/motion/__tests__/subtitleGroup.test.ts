import { describe, it, expect } from "vitest";
import { getPreset } from "../../subtitle/presets";
import { parseSubtitles } from "../subtitles/subtitleParse";
import { subtitleCuesToLayers } from "../subtitles/subtitleLayers";
import { groupIdOf, isSubtitleGroupLayer, siblingsOf, stripGroupTag, withGroupTag } from "../subtitles/subtitleGroup";

const SRT = `1
00:00:01,000 --> 00:00:03,000
First

2
00:00:04,000 --> 00:00:06,000
Second
`;

function gen(presetId = "capcut") {
  const { cues } = parseSubtitles(SRT);
  return subtitleCuesToLayers(cues, {
    style: getPreset(presetId),
    sceneWidth: 1920,
    sceneHeight: 1080,
    sceneDurationMs: 8000,
  });
}

describe("tag helpers", () => {
  it("round-trips a group id through withGroupTag/groupIdOf", () => {
    const name = withGroupTag("Caption: hi", "abc123");
    expect(groupIdOf({ name } as never)).toBe("abc123");
  });

  it("strips the tag back to the original label", () => {
    const name = withGroupTag("Caption: hi", "abc123");
    expect(stripGroupTag(name)).toBe("Caption: hi");
  });

  it("re-tagging replaces rather than accumulating suffixes", () => {
    const once = withGroupTag("Caption: hi", "abc123");
    const twice = withGroupTag(once, "def456");
    expect(twice).toBe("Caption: hi · cc:def456");
    expect(groupIdOf({ name: twice } as never)).toBe("def456");
  });

  it("a plain name has no group id", () => {
    expect(groupIdOf({ name: "Rectangle" } as never)).toBeNull();
    expect(isSubtitleGroupLayer({ name: "Rectangle" } as never)).toBe(false);
  });
});

describe("subtitleCuesToLayers tagging", () => {
  it("tags every generated layer with the SAME group id", () => {
    const { layers } = gen("capcut"); // has a background band -> rect + text pairs
    expect(layers.length).toBeGreaterThan(1);
    const ids = new Set(layers.map((l) => groupIdOf(l)));
    expect(ids.size).toBe(1);
    expect([...ids][0]).not.toBeNull();
  });

  it("two separate imports get DIFFERENT group ids", () => {
    const a = gen("classic").layers;
    const b = gen("classic").layers;
    expect(groupIdOf(a[0])).not.toBe(groupIdOf(b[0]));
  });

  it("siblingsOf finds every layer from the same import, and only those", () => {
    const { layers } = gen("capcut");
    const unrelated = { ...layers[0], id: "z", name: "Rectangle" };
    const all = [...layers, unrelated];
    const sibs = siblingsOf(layers[0], all);
    expect(sibs).toHaveLength(layers.length);
    expect(sibs).not.toContain(unrelated);
  });

  it("a layer with no tag has no siblings, even in a populated scene", () => {
    const { layers } = gen("capcut");
    const plain = { ...layers[0], id: "y", name: "Some other layer" };
    expect(siblingsOf(plain, [...layers, plain])).toHaveLength(0);
  });
});
