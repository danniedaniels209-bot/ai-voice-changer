import { describe, expect, it } from "vitest";
import { applyTransitionToScene } from "../transitions/applyTransitionToScene";
import type { MotionLayer, MotionScene } from "../../types/motion";

function scene(): MotionScene {
  const layer: MotionLayer = {
    id: "L1", name: "L1", type: "rect",
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    rect: { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 },
    ellipse: null, text: null, image: null, video: null,
    keyframes: [],
  };
  return {
    id: "s1", name: "s", width: 1920, height: 1080, duration_ms: 5000,
    background_color: "#000", layers: [layer], audio_tracks: [],
  };
}

describe("transition duration (LT-TRANSITIONDURATION)", () => {
  it("keyframe span REACHES the chosen duration, not merely stays inside it", () => {
    const results: Record<number, number> = {};
    for (const d of [200, 600, 1200, 2000]) {
      // Returns TransitionKeyframePayload[] — {layerId, keyframes}, not a scene.
      const out = applyTransitionToScene(scene(), "fade", d);
      const times = out.flatMap((p) => p.keyframes.map((k) => k.time_ms));
      results[d] = times.length ? Math.max(...times) : -1;
    }
    // Assert the span actually REACHES the requested duration, not merely
    // that it stays inside it — "inside [0, d]" is satisfied by keyframes
    // that all sit at 0.
    expect(results).toEqual({ 200: 200, 600: 600, 1200: 1200, 2000: 2000 });
  });
});
