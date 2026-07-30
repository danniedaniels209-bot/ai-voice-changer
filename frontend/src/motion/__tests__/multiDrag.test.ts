import { describe, expect, it } from "vitest";
import { editorReducer, getResolvedTransform, type EditorState } from "../state";
import { createLayer } from "../layerFactory";
import type { MotionProject } from "../../types/motion";

function makeTestState(): EditorState {
  const layerA = createLayer("rect");
  layerA.id = "layer-a";
  layerA.name = "Layer A";
  layerA.transform = { x: 100, y: 100, width: 50, height: 50, rotation: 0, opacity: 1, blur: 0 };

  const layerB = createLayer("ellipse");
  layerB.id = "layer-b";
  layerB.name = "Layer B (Animated)";
  layerB.transform = { x: 200, y: 150, width: 60, height: 60, rotation: 0, opacity: 1, blur: 0 };
  // Add a keyframe on x for layerB to test keyframe update during multi-drag
  layerB.keyframes = [
    {
      id: "kf-1",
      time_ms: 0,
      property: "x",
      value: 200,
      easing: "linear",
    },
  ];

  const layerC = createLayer("text");
  layerC.id = "layer-c";
  layerC.name = "Layer C";
  layerC.transform = { x: 300, y: 200, width: 100, height: 30, rotation: 0, opacity: 1, blur: 0 };

  const layerLocked = createLayer("rect");
  layerLocked.id = "layer-locked";
  layerLocked.name = "Layer Locked";
  layerLocked.transform = { x: 400, y: 250, width: 40, height: 40, rotation: 0, opacity: 1, blur: 0 };
  layerLocked.locked = true;

  const project: MotionProject = {
    id: "test-proj",
    name: "Test Project",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    scenes: [
      {
        id: "scene-1",
        name: "Scene 1",
        duration_ms: 5000,
        width: 1920,
        height: 1080,
        background_color: "#0f172a",
        layers: [layerA, layerB, layerC, layerLocked],
        audio_tracks: [],
      },
    ],
  };

  return {
    project,
    activeSceneId: "scene-1",
    selectedLayerIds: ["layer-a", "layer-b", "layer-c", "layer-locked"],
    past: [],
    future: [],
    dirty: false,
    playheadMs: 0,
  };
}

describe("LT-MULTIDRAG batch moves & undo", () => {
  it("moves 3 selected layers by identical (dx, dy) deltas in ONE undo step, handling keyframed layers correctly", () => {
    const initialState = makeTestState();
    const scene = initialState.project.scenes[0];
    const dx = 50;
    const dy = -25;

    // Filter out locked layer (as MotionCanvas handleLayerMouseDown does)
    const activeLayers = scene.layers.filter((l) =>
      initialState.selectedLayerIds.includes(l.id) && !l.locked
    );
    expect(activeLayers.map((l) => l.id)).toEqual(["layer-a", "layer-b", "layer-c"]);

    // Simulate multi-layer drag completion via MOVE_LAYERS_BATCH
    const updates = activeLayers.map((l) => {
      const current = getResolvedTransform(initialState, l);
      return {
        layerId: l.id,
        transform: { x: current.x + dx, y: current.y + dy },
      };
    });

    const nextState = editorReducer(initialState, {
      type: "MOVE_LAYERS_BATCH",
      updates,
      timeMs: initialState.playheadMs,
    });

    const newScene = nextState.project.scenes[0];
    const newA = newScene.layers.find((l) => l.id === "layer-a")!;
    const newB = newScene.layers.find((l) => l.id === "layer-b")!;
    const newC = newScene.layers.find((l) => l.id === "layer-c")!;
    const newLocked = newScene.layers.find((l) => l.id === "layer-locked")!;

    // 1. Explicitly assert locked layer did NOT move
    expect(newLocked.transform.x).toBe(400);
    expect(newLocked.transform.y).toBe(250);

    // 2. Verify static base layer A delta
    expect(newA.transform.x - 100).toBe(dx);
    expect(newA.transform.y - 100).toBe(dy);

    // 3. Verify keyframed layer B has keyframe updated at timeMs, and getResolvedTransform evaluates to new position!
    const resolvedB = getResolvedTransform(nextState, newB);
    expect(resolvedB.x - 200).toBe(dx);
    expect(resolvedB.y - 150).toBe(dy);

    // 4. Verify static base layer C delta
    expect(newC.transform.x - 300).toBe(dx);
    expect(newC.transform.y - 200).toBe(dy);

    // 5. Verify history recorded exactly ONE undo snapshot
    expect(nextState.past.length).toBe(1);

    // 6. Revert with ONE Ctrl+Z (UNDO)
    const undoneState = editorReducer(nextState, { type: "UNDO" });
    const undoneScene = undoneState.project.scenes[0];
    const revertedA = undoneScene.layers.find((l) => l.id === "layer-a")!;
    const revertedB = undoneScene.layers.find((l) => l.id === "layer-b")!;
    const revertedC = undoneScene.layers.find((l) => l.id === "layer-c")!;

    expect(revertedA.transform.x).toBe(100);
    expect(revertedA.transform.y).toBe(100);
    expect(getResolvedTransform(undoneState, revertedB).x).toBe(200);
    expect(revertedB.transform.y).toBe(150);
    expect(revertedC.transform.x).toBe(300);
    expect(revertedC.transform.y).toBe(200);
  });
});
