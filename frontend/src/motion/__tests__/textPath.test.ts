import { describe, expect, it } from "vitest";
import { getTextPathD, renderTextLayer } from "../textpath/textPath";
import type { MotionLayer, Transform } from "../../types/motion";

describe("LT-TEXTONPATH textPath helper", () => {
  it("getTextPathD returns null for 'none' or missing path_type", () => {
    expect(getTextPathD("none", undefined, 200, 100)).toBeNull();
    expect(getTextPathD(undefined, undefined, 200, 100)).toBeNull();
  });

  it("getTextPathD generates preset SVG path strings", () => {
    const arcUp = getTextPathD("arc-up", undefined, 200, 100);
    expect(arcUp).toContain("M 0,85 Q 100,15 200,85");

    const arcDown = getTextPathD("arc-down", undefined, 200, 100);
    expect(arcDown).toContain("M 0,15 Q 100,85 200,15");

    const wave = getTextPathD("wave", undefined, 200, 100);
    expect(wave).toContain("M 0,50");

    const circle = getTextPathD("circle", undefined, 200, 100);
    expect(circle).toContain("A 100,50");
  });

  it("getTextPathD returns customD when path_type is custom", () => {
    const custom = "M 10 10 L 90 90";
    expect(getTextPathD("custom", custom, 200, 100)).toBe(custom);
    expect(getTextPathD("custom", null, 200, 100)).toBeNull();
  });

  it("renderTextLayer renders standard wrapped text for path_type 'none'", () => {
    const layer: MotionLayer = {
      id: "text-1",
      name: "Text 1",
      type: "text",
      transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0, opacity: 1, blur: 0 },
      locked: false,
      hidden: false,
      text: {
        text: "Curved Text",
        font_family: "Inter",
        font_size: 24,
        font_weight: 400,
        color: "#ffffff",
        align: "center",
        path_type: "none",
      },
      rect: null,
      ellipse: null,
      image: null,
      video: null,
      keyframes: [],
    };

    const transform: Transform = { x: 0, y: 0, width: 200, height: 100, rotation: 0, opacity: 1, blur: 0 };
    const element = renderTextLayer({ layer, transform, resolveFill: () => "#ffffff" });
    expect(element).not.toBeNull();
    // React element for standard text tag
    expect((element as any).type).toBe("text");
  });

  it("renderTextLayer renders <g> with <defs><path> and <textPath> for active path", () => {
    const layer: MotionLayer = {
      id: "text-2",
      name: "Text 2",
      type: "text",
      transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0, opacity: 1, blur: 0 },
      locked: false,
      hidden: false,
      text: {
        text: "Curved Text",
        font_family: "Inter",
        font_size: 24,
        font_weight: 400,
        color: "#ffffff",
        align: "center",
        path_type: "arc-up",
      },
      rect: null,
      ellipse: null,
      image: null,
      video: null,
      keyframes: [],
    };

    const transform: Transform = { x: 0, y: 0, width: 200, height: 100, rotation: 0, opacity: 1, blur: 0 };
    const element = renderTextLayer({ layer, transform, resolveFill: () => "#ffffff" });
    expect(element).not.toBeNull();
    expect((element as any).type).toBe("g");
  });
});
