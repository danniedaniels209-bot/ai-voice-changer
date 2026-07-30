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
  layerB.name = "Layer B (Animated rotation)";
  layerB.transform = { x: 300, y: 100, width: 100, height: 100, rotation: 0, opacity: 1, blur: 0 };
  layerB.keyframes = [
    {
      id: "kf-rot1",
      time_ms: 0,
      property: "rotation",
      value: 0,
      easing: "linear",
    },
  ];

  const layerLocked = createLayer("rect");
  layerLocked.id = "layer-locked";
  layerLocked.name = "Layer Locked";
  layerLocked.transform = { x: 500, y: 100, width: 50, height: 50, rotation: 0, opacity: 1, blur: 0 };
  layerLocked.locked = true;

  const project: MotionProject = {
    id: "test-proj-rotate",
    name: "Test Rotate Project",
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

describe("LT-ROTATE-GROUP group rotation & undo", () => {
  it("rotates 2 unlocked layers around group center by 90° in ONE undo step", () => {
    const initialState = makeTestState();

    // Group bounding box center:
    // layerA: (100, 100, w=100, h=100) → box (100..200, 100..200)
    // layerB: (300, 100, w=100, h=100) → box (300..400, 100..200)
    // Group box: (100..400, 100..200) → center = (250, 150)
    const cx = 250;
    const cy = 150;
    const deltaAngleDeg = 90;
    const deltaAngleRad = (deltaAngleDeg * Math.PI) / 180;
    const cos = Math.cos(deltaAngleRad);
    const sin = Math.sin(deltaAngleRad);

    // Compute rotated positions for layerA and layerB
    // Layer A center: (150, 150), rel to group center: (-100, 0)
    // Rotated: (-100*cos - 0*sin, -100*sin + 0*cos) = (0, -100)
    // New center: (250, 50) → new top-left: (200, 0)
    const aLayerCx = 150;
    const aLayerCy = 150;
    const aRelX = aLayerCx - cx;
    const aRelY = aLayerCy - cy;
    const aNewRelX = aRelX * cos - aRelY * sin;
    const aNewRelY = aRelX * sin + aRelY * cos;
    const aNewX = cx + aNewRelX - 50; // -width/2
    const aNewY = cy + aNewRelY - 50; // -height/2

    // Layer B center: (350, 150), rel to group center: (100, 0)
    // Rotated: (100*cos - 0*sin, 100*sin + 0*cos) = (0, 100)
    // New center: (250, 250) → new top-left: (200, 200)
    const bLayerCx = 350;
    const bLayerCy = 150;
    const bRelX = bLayerCx - cx;
    const bRelY = bLayerCy - cy;
    const bNewRelX = bRelX * cos - bRelY * sin;
    const bNewRelY = bRelX * sin + bRelY * cos;
    const bNewX = cx + bNewRelX - 50;
    const bNewY = cy + bNewRelY - 50;

    // Filter out locked layer (as MotionCanvas does)
    const updates = [
      {
        layerId: "layer-a",
        transform: {
          x: aNewX,
          y: aNewY,
          rotation: 0 + deltaAngleDeg,
        },
      },
      {
        layerId: "layer-b",
        transform: {
          x: bNewX,
          y: bNewY,
          rotation: 0 + deltaAngleDeg,
        },
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

    // 1. Locked layer did NOT move or rotate
    expect(newLocked.transform.x).toBe(500);
    expect(newLocked.transform.y).toBe(100);
    expect(newLocked.transform.rotation).toBe(0);

    // 2. Layer A (static rotation): new position and rotation updated in base transform
    expect(newA.transform.x).toBeCloseTo(aNewX, 5);
    expect(newA.transform.y).toBeCloseTo(aNewY, 5);
    expect(newA.transform.rotation).toBe(90);

    // 3. Layer B (keyframed rotation): rotation updated via keyframe, position updated in base
    const resolvedB = getResolvedTransform(nextState, newB);
    expect(resolvedB.x).toBeCloseTo(bNewX, 5);
    expect(resolvedB.y).toBeCloseTo(bNewY, 5);
    expect(resolvedB.rotation).toBe(90);

    // 4. ONE undo snapshot
    expect(nextState.past.length).toBe(1);

    // 5. ONE Ctrl+Z reverts all layers
    const undoneState = editorReducer(nextState, { type: "UNDO" });
    const undoneScene = undoneState.project.scenes[0];

    const revertedA = undoneScene.layers.find((l) => l.id === "layer-a")!;
    const revertedB = undoneScene.layers.find((l) => l.id === "layer-b")!;

    expect(revertedA.transform.x).toBe(100);
    expect(revertedA.transform.y).toBe(100);
    expect(revertedA.transform.rotation).toBe(0);
    expect(getResolvedTransform(undoneState, revertedB).rotation).toBe(0);
    expect(revertedB.transform.x).toBe(300);
  });
});
