/**
 * Tests for canvas snapping.
 *
 * Snapping is felt, not read — when it's subtly wrong the editor just "feels
 * off" and nobody files a bug with a stack trace. These lock down the rules
 * that make it feel right:
 *
 *   - it snaps to scene edges/centre AND to other layers' edges/centres
 *   - it does NOT snap past the threshold (otherwise layers get yanked from
 *     across the canvas and precise placement becomes impossible)
 *   - the reported guide line matches the edge actually snapped to (a guide
 *     drawn somewhere other than where the layer landed is worse than none)
 *   - suppress (Alt) genuinely disables it — the escape hatch has to work
 *   - resize anchors two edges per handle and only moves the other two
 */

import { describe, expect, it } from "vitest";
import { computeDragSnap, computeResizeSnap } from "../guides";
import type { Transform } from "../../types/motion";

const SCENE_W = 1920;
const SCENE_H = 1080;
const THRESHOLD = 8;

/** A layer occupying x:[800,1100], y:[200,400]. */
const OTHER = [{ x: 800, y: 200, width: 300, height: 200 }];

function t(x: number, y: number, width: number, height: number): Transform {
  return { x, y, width, height, rotation: 0, opacity: 1 };
}

describe("computeDragSnap", () => {
  it("snaps a layer's left edge to another layer's left edge", () => {
    // Released 5px shy of 800 — inside the threshold, so it should land on it.
    const r = computeDragSnap(795, 700, 100, 100, SCENE_W, SCENE_H, OTHER, THRESHOLD, false);
    expect(r.x).toBeCloseTo(800, 6);
  });

  it("snaps to the scene's horizontal centre", () => {
    // Scene centre is 960; a 100-wide layer centred there starts at 910.
    const r = computeDragSnap(906, 700, 100, 100, SCENE_W, SCENE_H, [], THRESHOLD, false);
    expect(r.x + 50).toBeCloseTo(960, 6);
  });

  it("snaps to the scene's left edge", () => {
    const r = computeDragSnap(4, 700, 100, 100, SCENE_W, SCENE_H, [], THRESHOLD, false);
    expect(r.x).toBeCloseTo(0, 6);
  });

  it("does not snap when the distance exceeds the threshold", () => {
    // 40px away: must stay exactly where the user put it. Snapping from this
    // far would make fine positioning impossible.
    const r = computeDragSnap(760, 700, 100, 100, SCENE_W, SCENE_H, OTHER, THRESHOLD, false);
    expect(r.x).toBeCloseTo(760, 6);
    expect(r.guides).toHaveLength(0);
  });

  it("reports a guide at the position it actually snapped to", () => {
    const r = computeDragSnap(795, 700, 100, 100, SCENE_W, SCENE_H, OTHER, THRESHOLD, false);
    const vertical = r.guides.filter((g) => g.axis === "vertical");
    expect(vertical).toHaveLength(1);
    expect(vertical[0].position).toBeCloseTo(800, 6);
    // The guide must describe where the layer ended up, not where it was.
    expect(vertical[0].position).toBeCloseTo(r.x, 6);
  });

  it("snaps x and y independently", () => {
    // Near another layer's left edge (800) horizontally and its top (200)
    // vertically — both should engage, with a guide each.
    const r = computeDragSnap(795, 196, 100, 100, SCENE_W, SCENE_H, OTHER, THRESHOLD, false);
    expect(r.x).toBeCloseTo(800, 6);
    expect(r.y).toBeCloseTo(200, 6);
    expect(r.guides).toHaveLength(2);
  });

  it("returns the raw position and no guides when suppressed", () => {
    // Alt-drag: the escape hatch. Without this you cannot place a layer
    // 3px from an edge, ever.
    const r = computeDragSnap(795, 196, 100, 100, SCENE_W, SCENE_H, OTHER, THRESHOLD, true);
    expect(r.x).toBe(795);
    expect(r.y).toBe(196);
    expect(r.guides).toHaveLength(0);
  });

  it("snaps the layer's right edge, not just its left", () => {
    // Right edge at 795+100=895 lands near nothing; but at 700+100=800 it
    // meets the other layer's left edge, so the layer should shift to 700.
    const r = computeDragSnap(703, 700, 100, 100, SCENE_W, SCENE_H, OTHER, THRESHOLD, false);
    expect(r.x + 100).toBeCloseTo(800, 6);
  });
});

describe("computeResizeSnap", () => {
  const start = t(400, 300, 200, 150); // x:[400,600], y:[300,450]

  it("keeps the anchored corner fixed when dragging the SE handle", () => {
    // SE moves right/bottom; left and top must not move at all.
    const r = computeResizeSnap("se", start, 50, 40, SCENE_W, SCENE_H, [], THRESHOLD, true);
    expect(r.x).toBeCloseTo(400, 6);
    expect(r.y).toBeCloseTo(300, 6);
    expect(r.width).toBeCloseTo(250, 6);
    expect(r.height).toBeCloseTo(190, 6);
  });

  it("keeps the anchored corner fixed when dragging the NW handle", () => {
    // NW moves left/top; the right and bottom edges stay put, so width and
    // height shrink by the same amount x and y grew.
    const r = computeResizeSnap("nw", start, 50, 40, SCENE_W, SCENE_H, [], THRESHOLD, true);
    expect(r.x).toBeCloseTo(450, 6);
    expect(r.y).toBeCloseTo(340, 6);
    expect(r.x + r.width).toBeCloseTo(600, 6);
    expect(r.y + r.height).toBeCloseTo(450, 6);
  });

  it("snaps a moving edge to another layer's edge", () => {
    // Drag SE so the right edge lands 5px shy of 800; it should reach it.
    const r = computeResizeSnap("se", start, 195, 0, SCENE_W, SCENE_H, OTHER, THRESHOLD, false);
    expect(r.x + r.width).toBeCloseTo(800, 6);
  });

  it("never produces a width or height below the minimum", () => {
    // Dragging a handle past the opposite edge must not invert the box or
    // collapse it to zero — a zero-size layer is unselectable afterwards.
    const r = computeResizeSnap("se", start, -9999, -9999, SCENE_W, SCENE_H, [], THRESHOLD, false);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it("returns no guides when suppressed", () => {
    const r = computeResizeSnap("se", start, 195, 0, SCENE_W, SCENE_H, OTHER, THRESHOLD, true);
    expect(r.guides).toHaveLength(0);
  });

  it("produces finite values for every handle", () => {
    for (const handle of ["nw", "ne", "sw", "se"] as const) {
      const r = computeResizeSnap(handle, start, 37, -21, SCENE_W, SCENE_H, OTHER, THRESHOLD, false);
      for (const v of [r.x, r.y, r.width, r.height]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
