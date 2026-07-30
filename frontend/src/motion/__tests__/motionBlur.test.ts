import { describe, expect, it } from "vitest";
import { computeMotionBlur, motionBlurFilterId } from "../motionblur/motionBlur";
import { createLayer } from "../layerFactory";

describe("LT-MOTIONBLUR velocity motion blur computation", () => {
  it("returns null when motion_blur is false or unset", () => {
    const layer = createLayer("rect");
    layer.motion_blur = false;
    layer.keyframes = [
      { id: "k1", time_ms: 0, property: "x", value: 0, easing: "linear" },
      { id: "k2", time_ms: 1000, property: "x", value: 1000, easing: "linear" },
    ];

    expect(computeMotionBlur(layer, 500)).toBeNull();
  });

  it("returns null for a static layer with motion_blur enabled", () => {
    const layer = createLayer("rect");
    layer.motion_blur = true;
    layer.keyframes = [];

    expect(computeMotionBlur(layer, 500)).toBeNull();
  });

  it("computes horizontal motion blur for x keyframes", () => {
    const layer = createLayer("rect");
    layer.motion_blur = true;
    layer.keyframes = [
      { id: "k1", time_ms: 0, property: "x", value: 0, easing: "linear" },
      { id: "k2", time_ms: 1000, property: "x", value: 1000, easing: "linear" },
    ];

    // At 30fps (33ms step), dx = 33px in 33ms -> rawBlurX = 33 * 0.4 = 13.2px
    const result = computeMotionBlur(layer, 500, 33);
    expect(result).not.toBeNull();
    expect(result!.blurX).toBeGreaterThan(5);
    expect(result!.blurY).toBeLessThan(0.1);
  });

  it("computes vertical motion blur for y keyframes", () => {
    const layer = createLayer("rect");
    layer.motion_blur = true;
    layer.keyframes = [
      { id: "k1", time_ms: 0, property: "y", value: 0, easing: "linear" },
      { id: "k2", time_ms: 1000, property: "y", value: 1000, easing: "linear" },
    ];

    const result = computeMotionBlur(layer, 500, 33);
    expect(result).not.toBeNull();
    expect(result!.blurY).toBeGreaterThan(5);
    expect(result!.blurX).toBeLessThan(0.1);
  });

  it("adds rotation velocity to motion blur", () => {
    const layer = createLayer("rect");
    layer.transform = { ...layer.transform, width: 200, height: 200 };
    layer.motion_blur = true;
    layer.keyframes = [
      { id: "k1", time_ms: 0, property: "rotation", value: 0, easing: "linear" },
      { id: "k2", time_ms: 1000, property: "rotation", value: 360, easing: "linear" },
    ];

    const result = computeMotionBlur(layer, 500, 33);
    expect(result).not.toBeNull();
    expect(result!.blurX).toBeGreaterThan(0.5);
    expect(result!.blurY).toBeGreaterThan(0.5);
  });

  it("clamps blur to MAX_BLUR_PX (40px) during ultra-fast motion", () => {
    const layer = createLayer("rect");
    layer.motion_blur = true;
    layer.keyframes = [
      { id: "k1", time_ms: 0, property: "x", value: 0, easing: "linear" },
      { id: "k2", time_ms: 1000, property: "x", value: 50000, easing: "linear" },
    ];

    const result = computeMotionBlur(layer, 500, 33);
    expect(result).not.toBeNull();
    expect(result!.blurX).toBe(40);
  });

  it("generates correct filter ID format", () => {
    expect(motionBlurFilterId("layer-123")).toBe("layer-123-motion-blur");
  });
});
