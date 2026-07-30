/**
 * UPDATE_LAYERS_BATCH (LT-CAPTIONSTYLE) — the plural UPDATE_LAYER, added so
 * a batch restyle across a subtitle import is one undo step, not one per
 * caption. Generic: not itself subtitle-aware, just like ALIGN_LAYERS isn't
 * itself alignment-aware.
 */

import { describe, expect, it } from "vitest";
import { editorReducer } from "../state";
import type { EditorState } from "../state";
import type { MotionLayer, MotionProject } from "../../types/motion";

function textLayer(id: string, text: string, color: string, parentId: string | null = null): MotionLayer {
  return {
    id, name: id, type: "text",
    transform: { x: 0, y: 0, width: 100, height: 40, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    parent_id: parentId,
    rect: null, ellipse: null, image: null, video: null,
    text: { text, font_family: "Arial", font_size: 40, font_weight: 400, color, align: "left" },
    keyframes: [],
  };
}

function stateWith(layers: MotionLayer[]): EditorState {
  const project: MotionProject = {
    id: "p1", name: "batch",
    scenes: [{
      id: "s1", name: "Scene 1", width: 1920, height: 1080,
      duration_ms: 10000, background_color: "#000",
      layers, audio_tracks: [],
    }],
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    project, activeSceneId: "s1", selectedLayerIds: [],
    past: [], future: [], dirty: false, playheadMs: 0,
  } as EditorState;
}

describe("UPDATE_LAYERS_BATCH", () => {
  it("patches every listed layer and leaves untouched ones alone", () => {
    const state = stateWith([textLayer("a", "Alpha", "#fff"), textLayer("b", "Beta", "#fff"), textLayer("c", "Gamma", "#fff")]);
    const next = editorReducer(state, {
      type: "UPDATE_LAYERS_BATCH",
      updates: [
        { layerId: "a", patch: { text: { ...state.project.scenes[0].layers[0].text!, color: "#f00" } } },
        { layerId: "b", patch: { text: { ...state.project.scenes[0].layers[1].text!, color: "#f00" } } },
      ],
    });
    const byId = Object.fromEntries(next.project.scenes[0].layers.map((l) => [l.id, l]));
    expect(byId.a.text!.color).toBe("#f00");
    expect(byId.b.text!.color).toBe("#f00");
    expect(byId.c.text!.color).toBe("#fff"); // not in the update list
    // Each sibling keeps its OWN text content — restyling isn't retexting.
    expect(byId.a.text!.text).toBe("Alpha");
    expect(byId.b.text!.text).toBe("Beta");
  });

  it("is ONE undo step for the whole batch, not one per layer", () => {
    const state = stateWith([textLayer("a", "Alpha", "#fff"), textLayer("b", "Beta", "#fff")]);
    const next = editorReducer(state, {
      type: "UPDATE_LAYERS_BATCH",
      updates: [
        { layerId: "a", patch: { text: { ...state.project.scenes[0].layers[0].text!, color: "#f00" } } },
        { layerId: "b", patch: { text: { ...state.project.scenes[0].layers[1].text!, color: "#f00" } } },
      ],
    });
    expect(next.past).toHaveLength(1);
    const undone = editorReducer(next, { type: "UNDO" });
    const byId = Object.fromEntries(undone.project.scenes[0].layers.map((l) => [l.id, l]));
    expect(byId.a.text!.color).toBe("#fff");
    expect(byId.b.text!.color).toBe("#fff");
  });

  it("an empty update list is a no-op, not an empty undo step", () => {
    const state = stateWith([textLayer("a", "Alpha", "#fff")]);
    const next = editorReducer(state, { type: "UPDATE_LAYERS_BATCH", updates: [] });
    expect(next).toBe(state);
  });

  it("drops a single cycle-creating parent_id update rather than failing the whole batch", () => {
    const state = stateWith([textLayer("a", "Alpha", "#fff"), textLayer("b", "Beta", "#fff", "a")]);
    // a -> parent_id: b would make b its own ancestor's descendant (a is
    // already b's parent), a genuine cycle.
    const next = editorReducer(state, {
      type: "UPDATE_LAYERS_BATCH",
      updates: [
        { layerId: "a", patch: { parent_id: "b" } }, // rejected: cycle
        { layerId: "b", patch: { text: { ...state.project.scenes[0].layers[1].text!, color: "#0f0" } } }, // applied
      ],
    });
    const byId = Object.fromEntries(next.project.scenes[0].layers.map((l) => [l.id, l]));
    expect(byId.a.parent_id).toBe(null); // unchanged
    expect(byId.b.text!.color).toBe("#0f0"); // still applied
  });
});
