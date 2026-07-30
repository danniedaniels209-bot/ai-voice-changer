import { describe, expect, it } from "vitest";
import { copyToClipboard, getClipboard, preparePaste, setClipboard } from "../clipboard";
import { editorReducer, getResolvedTransform, type EditorState } from "../state";
import type { MotionLayer, MotionProject, MotionScene } from "../../types/motion";

/** A layer whose x is KEYFRAMED to 500, while its base transform.x is 0. */
function animated(id: string): MotionLayer {
  return {
    id, name: id, type: "rect",
    transform: { x: 0, y: 0, width: 50, height: 50, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    rect: { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 },
    ellipse: null, text: null, image: null, video: null,
    keyframes: [
      { id: `${id}k1`, time_ms: 0, property: "x", value: 500, easing: "linear" },
      { id: `${id}k2`, time_ms: 2000, property: "x", value: 500, easing: "linear" },
    ],
  };
}

function stateWith(layers: MotionLayer[]): EditorState {
  const scene: MotionScene = {
    id: "s1", name: "s", width: 1920, height: 1080, duration_ms: 5000,
    background_color: "#000", layers, audio_tracks: [],
  };
  const project: MotionProject = {
    id: "p", name: "p", created_at: "", updated_at: "", scenes: [scene],
  };
  return {
    project, activeSceneId: "s1", selectedLayerIds: [layers[0].id],
    past: [], future: [], dirty: false, playheadMs: 500,
  };
}

/**
 * Duplicate and paste must visibly offset an ANIMATED layer
 * (offsetLayerPosition, motion/layerTree.ts).
 *
 * Offsetting only `transform.x/y` is a silent no-op when x/y are keyframed —
 * evaluation ignores the base entirely — so the copy landed exactly on top of
 * the original and both actions looked like they had done nothing. Found by
 * auditing every remaining direct `layer.transform.*` read after the same root
 * cause broke multi-drag, multi-resize and multi-nudge.
 */
describe("duplicate/paste offset on an ANIMATED layer", () => {
  it("DUPLICATE_LAYER offsets the duplicate visibly, not just its base transform", () => {
    const src = animated("orig");
    const state = stateWith([src]);
    const next = editorReducer(state, { type: "DUPLICATE_LAYER", layerId: "orig" });
    const layers = next.project.scenes[0].layers;
    expect(layers.length).toBe(2);
    const origX = getResolvedTransform(next, layers[0]).x;
    const dupX = getResolvedTransform(next, layers[1]).x;
    // The +16 offset exists specifically so the duplicate is visible.
    expect({ origX, dupX, visiblyOffset: origX !== dupX }).toEqual({
      origX: 500, dupX: 516, visiblyOffset: true,
    });
  });

  it("PASTE offsets the pasted copy visibly, not just its base transform", () => {
    const src = animated("orig");
    const state = stateWith([src]);
    copyToClipboard([src], []);
    const { layers: pasted } = preparePaste(getClipboard()!, state.project.scenes[0], 0);
    const withPasted = editorReducer(state, {
      type: "PASTE_LAYERS", layers: pasted, connectors: [],
    });
    const all = withPasted.project.scenes[0].layers;
    const origX = getResolvedTransform(withPasted, all[0]).x;
    const pastedX = getResolvedTransform(withPasted, all[1]).x;
    setClipboard(null);
    // The +20 offset exists specifically so the paste doesn't look like a no-op.
    expect({ origX, pastedX, visiblyOffset: origX !== pastedX }).toEqual({
      origX: 500, pastedX: 520, visiblyOffset: true,
    });
  });
});
