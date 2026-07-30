/**
 * Copy/paste (LT-COPYPASTE). Verifies the exact scenario the task's own
 * done-bar asked for: 3 layers, one with keyframes, one connector between
 * two of them, pasted into a DIFFERENT scene — new ids, correct relative
 * keyframe times, connector preserved between the pasted copies, one undo
 * step removes all 3.
 */

import { describe, expect, it } from "vitest";
import { copyToClipboard, getClipboard, preparePaste, preparePasteSpecial, setClipboard } from "../clipboard";
import { editorReducer, type EditorState } from "../state";
import type { MotionConnector, MotionLayer, MotionProject, MotionScene } from "../../types/motion";

function layer(id: string, x: number, opts: Partial<MotionLayer> = {}): MotionLayer {
  return {
    id, name: id, type: "rect",
    transform: { x, y: 0, width: 50, height: 50, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    rect: { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 },
    ellipse: null, text: null, image: null, video: null,
    keyframes: [],
    ...opts,
  };
}

function makeState(layers: MotionLayer[], connectors: MotionConnector[]): EditorState {
  const sceneA: MotionScene = {
    id: "sceneA", name: "A", width: 1920, height: 1080, duration_ms: 5000,
    background_color: "#000", layers, audio_tracks: [], connectors,
  };
  const sceneB: MotionScene = {
    id: "sceneB", name: "B", width: 1920, height: 1080, duration_ms: 5000,
    background_color: "#000", layers: [], audio_tracks: [],
  };
  const project: MotionProject = {
    id: "p", name: "p", created_at: "", updated_at: "", scenes: [sceneA, sceneB],
  };
  return {
    project, activeSceneId: "sceneA", selectedLayerIds: [],
    past: [], future: [], dirty: false, playheadMs: 0,
  };
}

describe("copy/paste across scenes", () => {
  it("pastes 3 layers (one keyframed, one connector) into a DIFFERENT scene correctly", () => {
    const connector: MotionConnector = {
      id: "conn1", name: "c", style: "curved", stroke_color: "#fff", stroke_width: 2, dash_pattern: null, animated: false,
      source: { layer_id: "L1", anchor: "center" },
      target: { layer_id: "L2", anchor: "center" },
    };
    const layers = [
      layer("L1", 100),
      layer("L2", 200, {
        keyframes: [
          { id: "kfa", time_ms: 0, property: "x", value: 200, easing: "linear" },
          { id: "kfb", time_ms: 1000, property: "x", value: 400, easing: "linear" },
        ],
      }),
      layer("L3", 300),
    ];
    const state = makeState(layers, [connector]);

    // Copy: same logic as the Ctrl+C handler — layers in selection, plus
    // connectors where BOTH endpoints are in the selection.
    const ids = new Set(["L1", "L2", "L3"]);
    const copiedLayers = layers.filter((l) => ids.has(l.id));
    const copiedConnectors = [connector].filter(
      (c) => ids.has(c.source.layer_id) && ids.has(c.target.layer_id),
    );
    copyToClipboard(copiedLayers, copiedConnectors);
    expect(getClipboard()?.layers.length).toBe(3);
    expect(getClipboard()?.connectors.length).toBe(1);

    // Paste into scene B (a DIFFERENT scene from the copy source) at playhead 5000.
    const sceneB = state.project.scenes[1];
    const clip = getClipboard()!;
    const { layers: pasted, connectors: pastedConnectors } = preparePaste(clip, sceneB, 5000);

    // New ids, never reusing the originals.
    const pastedIds = pasted.map((l) => l.id);
    expect(new Set(pastedIds).size).toBe(3);
    for (const id of pastedIds) expect(ids.has(id)).toBe(false);

    // Keyframe times preserved RELATIVE to the layer, offset to the new
    // paste position — original had kfa@0/kfb@1000 relative to the layer's
    // own start (0, since visible_start_ms was unset); pasted at playhead
    // 5000, so the keyframes should land at 5000 and 6000.
    const pastedL2 = pasted.find((l) => l.transform.x === 200 + 20)!; // +20 paste offset
    expect(pastedL2.keyframes.map((k) => k.time_ms).sort((a, b) => a - b)).toEqual([5000, 6000]);
    // Keyframe ids must also be fresh, not reused from the originals.
    expect(pastedL2.keyframes.every((k) => k.id !== "kfa" && k.id !== "kfb")).toBe(true);

    // Connector preserved between the TWO pasted copies of L1/L2.
    expect(pastedConnectors.length).toBe(1);
    const oldToNewByX = new Map(pasted.map((l) => [l.transform.x - 20, l.id]));
    expect(pastedConnectors[0].source.layer_id).toBe(oldToNewByX.get(100)); // was L1 (x=100)
    expect(pastedConnectors[0].target.layer_id).toBe(oldToNewByX.get(200)); // was L2 (x=200)

    // Dispatch PASTE_LAYERS against scene B and confirm ONE undo step
    // removes all 3 pasted layers.
    const afterPaste = editorReducer(
      { ...state, activeSceneId: "sceneB" },
      { type: "PASTE_LAYERS", layers: pasted, connectors: pastedConnectors },
    );
    expect(afterPaste.project.scenes[1].layers.length).toBe(3);
    expect(afterPaste.past.length).toBe(1);

    const undone = editorReducer(afterPaste, { type: "UNDO" });
    expect(undone.project.scenes[1].layers.length).toBe(0);

    setClipboard(null);
  });

  it("preparePasteSpecial strips keyframes and captures the CURRENT playhead's resolved position", () => {
    const animated = layer("L1", 0, {
      keyframes: [
        { id: "k1", time_ms: 0, property: "x", value: 0, easing: "linear" },
        { id: "k2", time_ms: 1000, property: "x", value: 1000, easing: "linear" },
      ],
    });
    const state = makeState([animated], []);
    copyToClipboard([animated], []);
    const clip = getClipboard()!;

    // At playhead 500ms (halfway), x should resolve to 500, then +20 paste offset.
    const { layers: pasted } = preparePasteSpecial(clip, state.project.scenes[0], 500);
    expect(pasted[0].keyframes).toEqual([]);
    expect(pasted[0].transform.x).toBeCloseTo(500 + 20, 0);

    setClipboard(null);
  });
});
