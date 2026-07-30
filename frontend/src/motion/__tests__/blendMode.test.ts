/**
 * LT-LAYERBLEND: the identity check that guarantees an unset blend_mode
 * renders byte-identical to before this feature existed, plus a pin on the
 * canonical CSS style the three renderers must apply. The whole point of
 * having a single shared helper is that none of the three renderers is
 * allowed to derive this style differently — if a renderer ever disagrees
 * with this test, the whole "one shared function, three callers" discipline
 * is broken.
 */

import { describe, expect, it } from "vitest";
import { blendStyle, isNormalBlend } from "../blend/blendMode";

describe("isNormalBlend", () => {
  it("is normal for null/undefined — existing projects have no field at all", () => {
    expect(isNormalBlend(null)).toBe(true);
    expect(isNormalBlend(undefined)).toBe(true);
  });

  it("is normal for the literal string 'normal'", () => {
    expect(isNormalBlend("normal")).toBe(true);
  });

  it("is not normal for any other blend mode", () => {
    expect(isNormalBlend("multiply")).toBe(false);
    expect(isNormalBlend("screen")).toBe(false);
    expect(isNormalBlend("overlay")).toBe(false);
    expect(isNormalBlend("difference")).toBe(false);
  });
});

describe("blendStyle", () => {
  it("returns undefined for null/undefined — no style attribute at all on the <g>", () => {
    expect(blendStyle(null)).toBeUndefined();
    expect(blendStyle(undefined)).toBeUndefined();
  });

  it("returns undefined for 'normal' — same as no field set, byte-identical SVG", () => {
    expect(blendStyle("normal")).toBeUndefined();
  });

  it("returns a mixBlendMode style for any other blend mode", () => {
    expect(blendStyle("multiply")).toEqual({ mixBlendMode: "multiply" });
    expect(blendStyle("screen")).toEqual({ mixBlendMode: "screen" });
    expect(blendStyle("luminosity")).toEqual({ mixBlendMode: "luminosity" });
  });
});