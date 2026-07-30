/**
 * LT-LAYERSEARCH.
 *
 * The bug this whole file exists to pin: the PREVIOUS "search" filtered
 * only the top-level layer list and rendered a matched parent's children
 * unconditionally. So a query matching a CHILD's name but not its ancestor
 * folder's name made that child invisible — no error, nothing to grep
 * for, just a layer nobody could find. Every "nested" test below is aimed
 * squarely at that regression.
 */
import { describe, it, expect } from "vitest";
import { visibleLayerIds } from "../layerFilter";
import type { MotionLayer } from "../../types/motion";
import { withGroupTag } from "../subtitles/subtitleGroup";

function layer(id: string, name: string, type: MotionLayer["type"] = "rect", parentId: string | null = null): MotionLayer {
  return {
    id, name, type, parent_id: parentId,
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    rect: type === "rect" ? { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 } : null,
    ellipse: null,
    text: type === "text" ? { text: name, font_family: "Arial", font_size: 40, font_weight: 400, color: "#fff", align: "left" } : null,
    image: null, video: null,
    keyframes: [],
  };
}

describe("visibleLayerIds — no filter active", () => {
  it("returns null (meaning: show everything) when query and type filter are both unset", () => {
    const layers = [layer("a", "Rect"), layer("b", "Text", "text")];
    expect(visibleLayerIds(layers, "", "all")).toBeNull();
  });

  it("treats whitespace-only query the same as empty", () => {
    const layers = [layer("a", "Rect")];
    expect(visibleLayerIds(layers, "   ", "all")).toBeNull();
  });
});

describe("visibleLayerIds — the nested-child regression", () => {
  it("reveals a matching CHILD even when its ancestor folder's name does not match", () => {
    const layers = [
      layer("folder", "Group 1", "rect"),
      layer("child", "Logo Text", "text", "folder"),
      layer("unrelated", "Something else", "rect"),
    ];
    const visible = visibleLayerIds(layers, "logo", "all")!;
    expect(visible.has("child")).toBe(true);
    // The ancestor must ALSO render, or there's no path in the tree to
    // reach the match at all.
    expect(visible.has("folder")).toBe(true);
    expect(visible.has("unrelated")).toBe(false);
  });

  it("reveals every descendant when the query matches a FOLDER's own name", () => {
    const layers = [
      layer("folder", "Intro Group", "rect"),
      layer("child1", "Whatever", "text", "folder"),
      layer("child2", "Anything", "rect", "folder"),
      layer("outside", "Not related", "rect"),
    ];
    const visible = visibleLayerIds(layers, "intro", "all")!;
    expect(visible.has("folder")).toBe(true);
    expect(visible.has("child1")).toBe(true);
    expect(visible.has("child2")).toBe(true);
    expect(visible.has("outside")).toBe(false);
  });

  it("reveals a grandchild through TWO ancestor levels", () => {
    const layers = [
      layer("grandparent", "Outer", "rect"),
      layer("parent", "Middle", "rect", "grandparent"),
      layer("target", "Findme", "text", "parent"),
    ];
    const visible = visibleLayerIds(layers, "findme", "all")!;
    expect(visible.has("target")).toBe(true);
    expect(visible.has("parent")).toBe(true);
    expect(visible.has("grandparent")).toBe(true);
  });
});

describe("visibleLayerIds — type filter", () => {
  it("isolates a single type", () => {
    const layers = [layer("a", "One", "text"), layer("b", "Two", "rect"), layer("c", "Three", "video")];
    const visible = visibleLayerIds(layers, "", "video")!;
    expect([...visible]).toEqual(["c"]);
  });

  it("combines with the name query as AND, not OR", () => {
    const layers = [
      layer("a", "Caption text", "text"),
      layer("b", "Caption band", "rect"),
    ];
    // Matches the name on BOTH, but only one is the right type.
    const visible = visibleLayerIds(layers, "caption", "text")!;
    expect([...visible]).toEqual(["a"]);
  });

  it("an ancestor still renders to reveal a type-matching descendant", () => {
    const layers = [
      layer("folder", "Mixed Group", "rect"),
      layer("vid", "Clip", "video", "folder"),
      layer("txt", "Label", "text", "folder"),
    ];
    const visible = visibleLayerIds(layers, "", "video")!;
    expect(visible.has("vid")).toBe(true);
    expect(visible.has("folder")).toBe(true);
    expect(visible.has("txt")).toBe(false);
  });
});

describe("visibleLayerIds — subtitle group tag search (LT-CAPTIONSTYLE integration)", () => {
  it("an exact group tag isolates only that import's layers, even with two imports present", () => {
    const groupA = "aaaa1111";
    const groupB = "bbbb2222";
    const layers = [
      layer("a1", withGroupTag("Caption: Hello", groupA), "text"),
      layer("a2", withGroupTag("Caption BG 1", groupA), "rect"),
      layer("b1", withGroupTag("Caption: World", groupB), "text"),
    ];
    const visible = visibleLayerIds(layers, ` · cc:${groupA}`, "all")!;
    expect(visible.has("a1")).toBe(true);
    expect(visible.has("a2")).toBe(true);
    expect(visible.has("b1")).toBe(false);
  });

  it("a generic word shared by every caption's label still finds all of them", () => {
    const gid = "cccc3333";
    const layers = [
      layer("a", withGroupTag("Caption: Alpha", gid), "text"),
      layer("b", withGroupTag("Caption: Beta", gid), "text"),
      layer("c", "Unrelated rectangle", "rect"),
    ];
    const visible = visibleLayerIds(layers, "caption", "all")!;
    expect(visible.has("a")).toBe(true);
    expect(visible.has("b")).toBe(true);
    expect(visible.has("c")).toBe(false);
  });
});

describe("visibleLayerIds — matching is case-insensitive and trims whitespace", () => {
  it("matches regardless of case", () => {
    const layers = [layer("a", "MyLayer")];
    expect(visibleLayerIds(layers, "mylayer", "all")!.has("a")).toBe(true);
    expect(visibleLayerIds(layers, "MYLAYER", "all")!.has("a")).toBe(true);
  });

  it("trims leading/trailing whitespace from the query before matching", () => {
    const layers = [layer("a", "Target")];
    expect(visibleLayerIds(layers, "  target  ", "all")!.has("a")).toBe(true);
  });
});
