/**
 * The color grade filter (LT-COLORGRADE): the identity check that
 * guarantees an ungraded layer renders byte-identical to before this
 * feature existed, and that the brightness/contrast math is the single
 * definition all three renderers import — nobody re-derives it locally.
 */

import { describe, expect, it } from "vitest";
import { isIdentityColorGrade } from "../colorgrade/colorGrade";
import type { ColorGrade } from "../../types/motion";

describe("isIdentityColorGrade", () => {
  it("is identity for null/undefined — existing projects have no field at all", () => {
    expect(isIdentityColorGrade(null)).toBe(true);
    expect(isIdentityColorGrade(undefined)).toBe(true);
  });

  it("is identity for the exact default values", () => {
    expect(isIdentityColorGrade({ brightness: 1, contrast: 1, saturation: 1, hue_deg: 0 })).toBe(true);
  });

  it("is not identity when any single value differs", () => {
    const base: ColorGrade = { brightness: 1, contrast: 1, saturation: 1, hue_deg: 0 };
    expect(isIdentityColorGrade({ ...base, brightness: 1.01 })).toBe(false);
    expect(isIdentityColorGrade({ ...base, contrast: 0.99 })).toBe(false);
    expect(isIdentityColorGrade({ ...base, saturation: 0 })).toBe(false);
    expect(isIdentityColorGrade({ ...base, hue_deg: 1 })).toBe(false);
  });
});
