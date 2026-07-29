/**
 * Ripple delete / trim (LT-RIPPLE).
 *
 * The invariant that matters for ripple editing is ORDER: closing a gap may
 * move layers earlier, but it must never make a layer that was after another
 * one land before it. Everything else is a matter of taste; that one is
 * corruption of the user's edit.
 */

import { describe, expect, it } from "vitest";
import { editorReducer } from "../state";
import type { EditorState } from "../state";
import type { MotionLayer, MotionProject } from "../../types/motion";

function layer(id: string, start: number, end: number): MotionLayer {
  return {
    id, name: id, type: "rect",
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    rect: { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 },
    ellipse: null, text: null, image: null, video: null,
    visible_start_ms: start, visible_end_ms: end,
    keyframes: [],
  };
}

function stateWith(layers: MotionLayer[], selected: string[]): EditorState {
  const project: MotionProject = {
    id: "p1", name: "ripple",
    scenes: [{
      id: "s1", name: "Scene 1", width: 1920, height: 1080,
      duration_ms: 10000, background_color: "#000",
      layers, audio_tracks: [],
    }],
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    project, activeSceneId: "s1", selectedLayerIds: selected,
    past: [], future: [], dirty: false, playheadMs: 0,
  } as EditorState;
}

/** Resolved spans. A ripple writes concrete ints, so anything still null here
 *  means that layer wasn't touched — resolve it the way the reducer does. */
function spans(state: EditorState): Record<string, [number, number]> {
  const scene = state.project.scenes[0];
  return Object.fromEntries(
    scene.layers.map((l) => [
      l.id,
      [l.visible_start_ms ?? 0, l.visible_end_ms ?? scene.duration_ms] as [number, number],
    ]),
  );
}

describe("RIPPLE_DELETE", () => {
  it("closes the gap left by a single deleted layer", () => {
    const s = stateWith([layer("A", 1000, 2000), layer("B", 3000, 4000)], ["A"]);
    const next = editorReducer(s, { type: "RIPPLE_DELETE" });
    expect(spans(next)).toEqual({ B: [2000, 3000] });
  });

  it("leaves layers that start before the deleted region alone", () => {
    const s = stateWith([layer("A", 0, 1000), layer("B", 2000, 3000), layer("C", 4000, 5000)], ["B"]);
    const next = editorReducer(s, { type: "RIPPLE_DELETE" });
    expect(spans(next)).toEqual({ A: [0, 1000], C: [3000, 4000] });
  });

  it("takes exactly one undo step for a multi-layer delete", () => {
    const s = stateWith([layer("A", 0, 1000), layer("B", 2000, 3000)], ["A", "B"]);
    const next = editorReducer(s, { type: "RIPPLE_DELETE" });
    expect(next.past.length).toBe(1);
  });

  it("never reorders surviving layers when the selection is non-contiguous", () => {
    // A[1-2s] B[3-4s] C[5-6s] D[7-8s]; delete A and C, which are NOT adjacent.
    // Total removed content is 2s, in two separate gaps. Whatever the policy
    // for how far things move, D started after B and must still be after B.
    const s = stateWith(
      [layer("A", 1000, 2000), layer("B", 3000, 4000), layer("C", 5000, 6000), layer("D", 7000, 8000)],
      ["A", "C"],
    );
    const next = editorReducer(s, { type: "RIPPLE_DELETE" });
    const after = spans(next);
    expect(after.D[0]).toBeGreaterThanOrEqual(after.B[1]);
  });

  it("does not move a layer to a negative start time", () => {
    const s = stateWith([layer("A", 0, 6000), layer("B", 7000, 8000)], ["A"]);
    const next = editorReducer(s, { type: "RIPPLE_DELETE" });
    for (const [start] of Object.values(spans(next))) {
      expect(start).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("RIPPLE_TRIM", () => {
  it("pushes later layers right when a layer is extended", () => {
    const s = stateWith([layer("A", 0, 1000), layer("B", 2000, 3000)], []);
    const next = editorReducer(s, { type: "RIPPLE_TRIM", layerId: "A", endMs: 1500 });
    expect(spans(next)).toEqual({ A: [0, 1500], B: [2500, 3500] });
  });

  it("pulls later layers left when a layer is shortened", () => {
    const s = stateWith([layer("A", 0, 2000), layer("B", 3000, 4000)], []);
    const next = editorReducer(s, { type: "RIPPLE_TRIM", layerId: "A", endMs: 1000 });
    expect(spans(next)).toEqual({ A: [0, 1000], B: [2000, 3000] });
  });

  it("is a no-op, with no undo entry, when the end doesn't move", () => {
    const s = stateWith([layer("A", 0, 2000), layer("B", 3000, 4000)], []);
    const next = editorReducer(s, { type: "RIPPLE_TRIM", layerId: "A", endMs: 2000 });
    expect(next.past.length).toBe(0);
  });

  it("never pulls a later layer back past the trimmed layer's new end", () => {
    const s = stateWith([layer("A", 0, 5000), layer("B", 6000, 7000)], []);
    const next = editorReducer(s, { type: "RIPPLE_TRIM", layerId: "A", endMs: 500 });
    const after = spans(next);
    expect(after.B[0]).toBeGreaterThanOrEqual(after.A[1]);
  });
});
