/**
 * Tests for the transition keyframe generators.
 *
 * These lock down three properties that the whole transition feature rests
 * on, and that are easy to break without noticing:
 *
 *   1. Every transition in the catalog actually produces keyframes. The
 *      catalog (TRANSITION_DEFINITIONS) and the implementation (a switch in
 *      applyTransition) are two separate lists that must stay in sync. Adding
 *      a 10th catalog entry without a matching case fails SILENTLY — the
 *      picker offers it, clicking it does nothing. That's the drift this
 *      guards against.
 *   2. Keyframes stay inside [0, durationMs]. Keyframes before 0 are
 *      unreachable: SET_PLAYHEAD clamps to >= 0, so an animation starting at
 *      a negative time is simply invisible. motionPresets.ts had exactly this
 *      bug once.
 *   3. Animations settle back to the layer's own static transform. Every
 *      transition animates FROM some altered state TO where the editor placed
 *      the layer. If the last keyframe doesn't match the layer's transform,
 *      the layer visibly jumps at the end of the transition.
 */

import { describe, expect, it } from "vitest";
import type { MotionLayer, MotionScene, Transform } from "../../../types/motion";
import { TRANSITION_DEFINITIONS } from "../transitions";
import { applyTransition } from "../applyTransition";
import { applyTransitionToScene } from "../applyTransitionToScene";

const DURATION = 600;

function makeTransform(over: Partial<Transform> = {}): Transform {
  return { x: 400, y: 300, width: 320, height: 200, rotation: 0, opacity: 1, blur: 0, ...over };
}

function makeLayer(over: Partial<MotionLayer> = {}): MotionLayer {
  return {
    id: `layer-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test layer",
    type: "rect",
    transform: makeTransform(),
    locked: false,
    hidden: false,
    rect: { fill: "#4F46E5", corner_radius: 0, stroke_color: "#000000", stroke_width: 0 },
    ellipse: null,
    text: null,
    image: null,
    video: null,
    keyframes: [],
    ...over,
  };
}

function makeScene(layers: MotionLayer[]): MotionScene {
  return {
    id: "scene-1",
    name: "Scene 1",
    width: 1920,
    height: 1080,
    duration_ms: 5000,
    background_color: "#0B0B0F",
    layers,
    audio_tracks: [],
  };
}

describe("applyTransition", () => {
  it("has an implementation for every transition in the catalog", () => {
    // The guard against catalog/implementation drift. If this fails, someone
    // added a TRANSITION_DEFINITIONS entry without a matching switch case.
    const empty = TRANSITION_DEFINITIONS.filter(
      (def) => applyTransition(def, makeLayer(), DURATION).length === 0,
    ).map((def) => def.id);
    expect(empty).toEqual([]);
  });

  it.each(TRANSITION_DEFINITIONS.map((d) => [d.id, d] as const))(
    "%s keeps every keyframe inside [0, durationMs]",
    (_id, def) => {
      for (const kf of applyTransition(def, makeLayer(), DURATION)) {
        expect(kf.time_ms).toBeGreaterThanOrEqual(0);
        expect(kf.time_ms).toBeLessThanOrEqual(DURATION);
      }
    },
  );

  it.each(TRANSITION_DEFINITIONS.map((d) => [d.id, d] as const))(
    "%s settles back to the layer's static transform",
    (_id, def) => {
      const layer = makeLayer({ transform: makeTransform({ x: 123, y: 456, opacity: 0.8 }) });
      const keyframes = applyTransition(def, layer, DURATION);

      // Group by property and check the LAST keyframe of each track lands on
      // the layer's resting value — that's what stops a visible jump when the
      // transition finishes.
      const byProperty = new Map<string, typeof keyframes>();
      for (const kf of keyframes) {
        byProperty.set(kf.property, [...(byProperty.get(kf.property) ?? []), kf]);
      }
      for (const [property, track] of byProperty) {
        const last = [...track].sort((a, b) => a.time_ms - b.time_ms).at(-1)!;
        const resting = layer.transform[property as keyof Transform];
        expect(last.value).toBeCloseTo(resting, 5);
      }
    },
  );

  it("gives every keyframe a unique id", () => {
    // Keyframes are addressed by id when dragged or deleted in the timeline;
    // duplicates would make the wrong one move.
    const keyframes = applyTransition(TRANSITION_DEFINITIONS[0], makeLayer(), DURATION);
    expect(new Set(keyframes.map((k) => k.id)).size).toBe(keyframes.length);
  });
});

describe("applyTransitionToScene", () => {
  const anyTransition = TRANSITION_DEFINITIONS[0].id;

  it("returns one payload per eligible layer", () => {
    const scene = makeScene([makeLayer(), makeLayer(), makeLayer()]);
    const payloads = applyTransitionToScene(scene, anyTransition, DURATION);
    expect(payloads).toHaveLength(3);
    expect(payloads.map((p) => p.layerId)).toEqual(scene.layers.map((l) => l.id));
    for (const p of payloads) expect(p.keyframes.length).toBeGreaterThan(0);
  });

  it("skips hidden and locked layers", () => {
    // Locked layers are deliberately pinned by the user; hidden ones aren't
    // on screen, so animating either would be a surprise.
    const visible = makeLayer({ name: "visible" });
    const scene = makeScene([
      visible,
      makeLayer({ name: "hidden", hidden: true }),
      makeLayer({ name: "locked", locked: true }),
    ]);
    const payloads = applyTransitionToScene(scene, anyTransition, DURATION);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].layerId).toBe(visible.id);
  });

  it("returns an empty array for an id that isn't in the catalog", () => {
    const scene = makeScene([makeLayer()]);
    expect(applyTransitionToScene(scene, "does-not-exist", DURATION)).toEqual([]);
  });

  it("returns an empty array for a scene with no layers", () => {
    expect(applyTransitionToScene(makeScene([]), anyTransition, DURATION)).toEqual([]);
  });

  it("does not mutate the scene it is given", () => {
    // It's a pure function by contract — the caller dispatches the payloads.
    const scene = makeScene([makeLayer()]);
    const before = JSON.stringify(scene);
    applyTransitionToScene(scene, anyTransition, DURATION);
    expect(JSON.stringify(scene)).toBe(before);
  });
});
