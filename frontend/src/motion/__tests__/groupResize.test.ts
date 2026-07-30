import { describe, expect, it } from "vitest";
import { editorReducer, getResolvedTransform, type EditorState } from "../state";
import { createLayer } from "../layerFactory";
import type { MotionProject } from "../../types/motion";

function makeTestState(): EditorState {
  const layerA = createLayer("rect");
  layerA.id = "layer-a";
  layerA.name = "Layer A";
  layerA.transform = { x: 100, y: 100, width: 100, height: 100, rotation: 0, opacity: 1, blur: 0 };

  const layerB = createLayer("ellipse");
  layerB.id = "layer-b";
  layerB.name = "Layer B (Animated Width)";
  layerB.transform = { x: 300, y: 100, width: 100, height: 100, rotation: 0, opacity: 1, blur: 0 };
  layerB.keyframes = [
    {
      id: "kf-w1",
      time_ms: 0,
      property: "width",
      value: 100,
      easing: "linear",
    },
  ];

  const layerLocked = createLayer("rect");
  layerLocked.id = "layer-locked";
  layerLocked.name = "Layer Locked";
  layerLocked.transform = { x: 500, y: 100, width: 50, height: 50, rotation: 0, opacity: 1, blur: 0 };
  layerLocked.locked = true;

  const project: MotionProject = {
    id: "test-proj-resize",
    name: "Test Resize Project",
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
        layers: [layerA, layerB, layerLocked],
        audio_tracks: [],
      },
    ],
  };

  return {
    project,
    activeSceneId: "scene-1",
    selectedLayerIds: ["layer-a", "layer-b", "layer-locked"],
    past: [],
    future: [],
    dirty: false,
    playheadMs: 0,
  };
}

describe("LT-RESIZE-GROUP multi-layer group resize & undo", () => {
  it("resizes 2 unlocked layers proportionally around top-left anchor in ONE undo step", () => {
    const initialState = makeTestState();
    const scene = initialState.project.scenes[0];

    // Filter out locked layer
    const activeLayers = scene.layers.filter(
      (l) => initialState.selectedLayerIds.includes(l.id) && !l.locked
    );
    expect(activeLayers.map((l) => l.id)).toEqual(["layer-a", "layer-b"]);

    // Bounding box of layerA (100..200, 100..200) + layerB (300..400, 100..200)
    // Group bounds: minX=100, minY=100, maxX=400, maxY=200 -> width=300, height=100
    // Scale up by 1.5x around top-left (100, 100) anchor
    // New group width=450, height=150
    // Layer A rel pos (0, 0) -> new pos (100, 100), new size (150, 150)
    // Layer B rel pos (200, 0) -> new rel pos (300, 0) -> new pos (400, 100), new size (150, 150)

    const updates = [
      {
        layerId: "layer-a",
        transform: { x: 100, y: 100, width: 150, height: 150 },
      },
      {
        layerId: "layer-b",
        transform: { x: 400, y: 100, width: 150, height: 150 },
      },
    ];

    const nextState = editorReducer(initialState, {
      type: "MOVE_LAYERS_BATCH",
      updates,
      timeMs: initialState.playheadMs,
    });

    const newScene = nextState.project.scenes[0];
    const newA = newScene.layers.find((l) => l.id === "layer-a")!;
    const newB = newScene.layers.find((l) => l.id === "layer-b")!;
    const newLocked = newScene.layers.find((l) => l.id === "layer-locked")!;

    // 1. Assert locked layer did not resize or move
    expect(newLocked.transform.x).toBe(500);
    expect(newLocked.transform.width).toBe(50);

    // 2. Assert layer A (un-animated) resized to 150x150 at (100, 100)
    expect(newA.transform.x).toBe(100);
    expect(newA.transform.width).toBe(150);
    expect(newA.transform.height).toBe(150);

    // 3. Assert layer B (keyframed width) evaluated via getResolvedTransform evaluates width=150 at (400, 100)
    const resolvedB = getResolvedTransform(nextState, newB);
    expect(resolvedB.x).toBe(400);
    expect(resolvedB.width).toBe(150);
    expect(resolvedB.height).toBe(150);

    // 4. Assert ONE undo snapshot was recorded
    expect(nextState.past.length).toBe(1);

    // 5. Assert ONE Ctrl+Z (UNDO) reverts both layers to initial state
    const undoneState = editorReducer(nextState, { type: "UNDO" });
    const undoneScene = undoneState.project.scenes[0];
    const revertedA = undoneScene.layers.find((l) => l.id === "layer-a")!;
    const revertedB = undoneScene.layers.find((l) => l.id === "layer-b")!;

    expect(revertedA.transform.width).toBe(100);
    expect(getResolvedTransform(undoneState, revertedB).width).toBe(100);
    expect(getResolvedTransform(undoneState, revertedB).x).toBe(300);
  });
});
