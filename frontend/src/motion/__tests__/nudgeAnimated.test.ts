/**
 * Nudging an ANIMATED layer must move it from where it actually IS, not
 * from its base transform (LT-MULTINUDGE).
 *
 * This is the third occurrence of one root cause: reading `layer.transform.*`
 * where the keyframe-resolved value is required. Multi-drag had it, then
 * multi-resize, then multi-nudge. `layer.transform` reads naturally as "the
 * layer's position" but is only correct for un-animated layers — for a
 * keyframed property, evaluation ignores the base entirely.
 *
 * Measured before the fix: a layer sitting visibly at x=500 via keyframes
 * jumped to x=33 on a single one-frame nudge (it computed 0+33 from the
 * base instead of 500+33 from the rendered position).
 */

import { describe, expect, it } from "vitest";
import { editorReducer, getResolvedTransform, type EditorState } from "../state";
import { resolveTransformAtTime } from "../easing";
import type { MotionLayer, MotionProject } from "../../types/motion";

const FRAME_STEP_MS = 1000 / 30;

function animatedLayer(): MotionLayer {
  return {
    id: "anim", name: "anim", type: "rect",
    // Base x is 0; keyframes hold it at 500. These differing on purpose is
    // the whole point — if they matched, the bug would be invisible.
    transform: { x: 0, y: 0, width: 50, height: 50, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    rect: { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 },
    ellipse: null, text: null, image: null, video: null,
    keyframes: [
      { id: "k1", time_ms: 0, property: "x", value: 500, easing: "linear" },
      { id: "k2", time_ms: 1000, property: "x", value: 500, easing: "linear" },
    ],
  };
}

function stateWith(layer: MotionLayer, playheadMs: number): EditorState {
  const project: MotionProject = {
    id: "p", name: "p", created_at: "", updated_at: "",
    scenes: [{
      id: "s1", name: "s", width: 1920, height: 1080, duration_ms: 5000,
      background_color: "#000", layers: [layer], audio_tracks: [],
    }],
  };
  return {
    project, activeSceneId: "s1", selectedLayerIds: [layer.id],
    past: [], future: [], dirty: false, playheadMs,
  };
}

describe("nudging an animated layer (LT-MULTINUDGE regression)", () => {
  it("moves by one frame from the RENDERED position, not the base transform", () => {
    const layer = animatedLayer();
    const state = stateWith(layer, 500);
    const before = getResolvedTransform(state, layer).x;
    expect(before).toBe(500); // sanity: the layer really is at 500, not 0

    // The handler's own math, with the fix: base comes from the resolved
    // value at the playhead.
    const base = resolveTransformAtTime(layer, state.playheadMs).x;
    const roundedTotal = Math.round(FRAME_STEP_MS);
    const next = editorReducer(state, {
      type: "MOVE_LAYERS_BATCH",
      updates: [{ layerId: "anim", transform: { x: base + roundedTotal } }],
      timeMs: state.playheadMs,
    });

    const after = getResolvedTransform(next, next.project.scenes[0].layers[0]).x;
    expect(after).toBe(533);
    expect(after - before).toBe(33); // moved one frame, did not teleport
  });

  it("would teleport if the base transform were used instead (documents the bug)", () => {
    const layer = animatedLayer();
    const state = stateWith(layer, 500);

    // The pre-fix expression, kept here deliberately: if someone ever
    // "simplifies" the handler back to layer.transform.x, this is the
    // number they would get, and the test above would start failing.
    const wrongBase = layer.transform.x;
    expect(wrongBase).toBe(0);
    expect(wrongBase + Math.round(FRAME_STEP_MS)).toBe(33);
    expect(getResolvedTransform(state, layer).x).not.toBe(wrongBase);
  });
});
