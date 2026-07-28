/**
 * Tests for connector endpoint resolution.
 *
 * Connectors are stored as (layer_id, anchor) pairs and resolved to concrete
 * points at draw time — that indirection is what makes them follow their
 * layers when those move, resize or animate. It also means every failure here
 * is silent: a wrong anchor draws a line to the wrong place, and a missing
 * layer throws inside a render pass, which in the export renderer means a
 * blank frame rather than a stack trace anyone sees.
 */

import { describe, expect, it } from "vitest";
import { resolveConnectorEndpoints } from "../connectorGeometry";
import type {
  ConnectorEndAnchor,
  Keyframe,
  MotionConnector,
  MotionLayer,
} from "../../types/motion";

function layer(id: string, x: number, y: number, w = 100, h = 60, keyframes: Keyframe[] = []): MotionLayer {
  return {
    id,
    name: id,
    type: "rect",
    transform: { x, y, width: w, height: h, rotation: 0, opacity: 1, blur: 0 },
    locked: false,
    hidden: false,
    rect: { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 },
    ellipse: null,
    text: null,
    image: null,
    video: null,
    keyframes,
  };
}

function connector(
  sourceId: string,
  targetId: string,
  sourceAnchor: ConnectorEndAnchor = "center",
  targetAnchor: ConnectorEndAnchor = "center",
): MotionConnector {
  return {
    id: "c1",
    name: "c",
    source: { layer_id: sourceId, anchor: sourceAnchor },
    target: { layer_id: targetId, anchor: targetAnchor },
    style: "straight",
    stroke_color: "#888",
    stroke_width: 2,
    dash_pattern: null,
    animated: false,
  };
}

describe("resolveConnectorEndpoints", () => {
  // A 100x60 box at (200, 100): centre (250,130), left (200,130),
  // right (300,130), top (250,100), bottom (250,160).
  const box = layer("a", 200, 100);
  const other = layer("b", 600, 400);

  it.each<[ConnectorEndAnchor, number, number]>([
    ["center", 250, 130],
    ["left", 200, 130],
    ["right", 300, 130],
    ["top", 250, 100],
    ["bottom", 250, 160],
  ])("resolves the %s anchor to the right point on the bounding box", (anchor, ex, ey) => {
    const r = resolveConnectorEndpoints(connector("a", "b", anchor), [box, other], 0);
    expect(r).not.toBeNull();
    expect(r!.source.x).toBeCloseTo(ex, 6);
    expect(r!.source.y).toBeCloseTo(ey, 6);
  });

  it("resolves the target endpoint independently of the source", () => {
    const r = resolveConnectorEndpoints(connector("a", "b", "right", "left"), [box, other], 0);
    expect(r!.source).toEqual({ x: 300, y: 130 });
    expect(r!.target).toEqual({ x: 600, y: 430 });
  });

  it("follows a layer when its transform changes", () => {
    // The whole point of anchoring to a layer instead of storing absolute
    // points: move the layer, the connector moves with it, no sync step.
    const before = resolveConnectorEndpoints(connector("a", "b"), [box, other], 0)!;
    const moved = layer("a", 500, 300);
    const after = resolveConnectorEndpoints(connector("a", "b"), [moved, other], 0)!;
    expect(after.source.x - before.source.x).toBeCloseTo(300, 6);
    expect(after.source.y - before.source.y).toBeCloseTo(200, 6);
  });

  it("resolves at the requested time, not the layer's static transform", () => {
    // An animated layer drags its connectors along mid-animation. If this
    // read layer.transform directly, connectors would detach during playback
    // and in every exported frame after t=0.
    const animated = layer("a", 0, 100, 100, 60, [
      { id: "k1", time_ms: 0, property: "x", value: 0, easing: "linear" },
      { id: "k2", time_ms: 1000, property: "x", value: 1000, easing: "linear" },
    ]);
    const atStart = resolveConnectorEndpoints(connector("a", "b"), [animated, other], 0)!;
    const midway = resolveConnectorEndpoints(connector("a", "b"), [animated, other], 500)!;
    expect(atStart.source.x).toBeCloseTo(50, 6); // 0 + width/2
    expect(midway.source.x).toBeCloseTo(550, 6); // 500 + width/2
  });

  it("returns null when the source layer is gone", () => {
    // Deleting a layer must not throw inside a render pass — in the export
    // renderer that produces a blank frame with no visible error.
    expect(resolveConnectorEndpoints(connector("missing", "b"), [other], 0)).toBeNull();
  });

  it("returns null when the target layer is gone", () => {
    expect(resolveConnectorEndpoints(connector("a", "missing"), [box], 0)).toBeNull();
  });

  it("returns null when there are no layers at all", () => {
    expect(resolveConnectorEndpoints(connector("a", "b"), [], 0)).toBeNull();
  });

  it("handles a zero-size layer without producing NaN", () => {
    // A degenerate layer shouldn't poison the path data — NaN in an SVG
    // coordinate silently drops the whole element.
    const flat = layer("a", 10, 20, 0, 0);
    const r = resolveConnectorEndpoints(connector("a", "b"), [flat, other], 0)!;
    expect(Number.isFinite(r.source.x)).toBe(true);
    expect(Number.isFinite(r.source.y)).toBe(true);
  });
});
