/**
 * Layer masking (LT-LAYERMASK).
 *
 * The identity rule is the load-bearing part: a scene with NO mask must
 * produce byte-identical SVG to before the feature existed. That needs BOTH
 * sides of the conditional to no-op — no `<mask>` def emitted, AND no
 * `<g mask=...>` wrapper. Testing only one side would pass while the other
 * silently wrapped every layer in a pointless `<g>`.
 *
 * The neighbour logic is the other risk: "masked by the layer BELOW me in
 * z-order" is an index relationship, and an off-by-one here would mask the
 * wrong layer in a way that looks plausible on a two-layer scene and wrong
 * on a three-layer one.
 */

import { describe, expect, it } from "vitest";
import {
  isLayerMaskedByNext,
  isMaskLayer,
  maskIdFor,
  maskWrapIdFor,
} from "../mask/maskMode";
import type { MotionLayer } from "../../types/motion";

function layer(id: string, isMask = false): MotionLayer {
  return {
    id, name: id, type: "rect",
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, blur: 0 },
    locked: false, hidden: false,
    rect: { fill: "#fff", corner_radius: 0, stroke_color: "#000", stroke_width: 0 },
    ellipse: null, text: null, image: null, video: null,
    keyframes: [],
    ...(isMask ? { is_mask: true } : {}),
  };
}

describe("mask identity rule", () => {
  it("treats an absent is_mask as not-a-mask", () => {
    expect(isMaskLayer(layer("a"))).toBe(false);
    expect(isMaskLayer(null)).toBe(false);
    expect(isMaskLayer(undefined)).toBe(false);
  });

  it("emits no wrapper for a scene with no masks at all", () => {
    const layers = [layer("a"), layer("b"), layer("c")];
    for (let i = 0; i < layers.length; i++) {
      expect(isLayerMaskedByNext(layers, i)).toBe(false);
      expect(maskWrapIdFor(layers, i)).toBeNull();
    }
  });
});

describe("mask neighbour resolution", () => {
  it("masks the layer directly BELOW the mask in z-order, and only that one", () => {
    // Render order is bottom-to-top, so layers[i+1] paints above layers[i].
    // A mask at index 2 masks index 1 — not index 0, not index 3.
    const layers = [layer("bottom"), layer("masked"), layer("themask", true), layer("top")];

    expect(isLayerMaskedByNext(layers, 1)).toBe(true);
    expect(maskWrapIdFor(layers, 1)).toBe(maskIdFor("themask"));

    expect(isLayerMaskedByNext(layers, 0)).toBe(false);
    expect(isLayerMaskedByNext(layers, 2)).toBe(false);
    expect(isLayerMaskedByNext(layers, 3)).toBe(false);
  });

  it("handles a mask as the very last layer without running off the end", () => {
    const layers = [layer("a"), layer("m", true)];
    expect(isLayerMaskedByNext(layers, 0)).toBe(true);
    // Index 1 is the mask itself; there is no layers[2] to read.
    expect(isLayerMaskedByNext(layers, 1)).toBe(false);
    expect(maskWrapIdFor(layers, 1)).toBeNull();
  });

  it("returns false for out-of-range indices rather than throwing", () => {
    const layers = [layer("a"), layer("m", true)];
    expect(isLayerMaskedByNext(layers, -1)).toBe(false);
    expect(isLayerMaskedByNext(layers, 99)).toBe(false);
    expect(isLayerMaskedByNext([], 0)).toBe(false);
  });

  it("namespaces mask ids per layer so two masks in one scene cannot collide", () => {
    expect(maskIdFor("abc")).not.toBe(maskIdFor("def"));
    const layers = [layer("l1"), layer("m1", true), layer("l2"), layer("m2", true)];
    expect(maskWrapIdFor(layers, 0)).toBe(maskIdFor("m1"));
    expect(maskWrapIdFor(layers, 2)).toBe(maskIdFor("m2"));
    expect(maskWrapIdFor(layers, 0)).not.toBe(maskWrapIdFor(layers, 2));
  });
});
