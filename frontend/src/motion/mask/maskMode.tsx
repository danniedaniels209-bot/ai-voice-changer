/**
 * SVG mask wiring for any layer (LT-LAYERMASK). When a layer has
 * `is_mask === true`, that layer is hidden from the visible scene and
 * instead becomes a luminance mask that clips the layer directly beneath
 * it in z-order. Built into SVG <mask> via the same defs-and-wrap pattern
 * the other per-layer effects (colorgrade/shadow/blur) use, so the markup
 * itself is identical across all three renderers.
 *
 * Why a shared helper returning JSX: gradient/shadow/blur each have their
 * OWN render*Filter function duplicated three times across the three
 * renderers — the exact shape of bug Claude has flagged repeatedly.
 * Mask changes DOM STRUCTURE (wrapping the masked layer in <g mask=...>)
 * on top of just emitting a <defs> node, so a renderer that disagrees
 * with the others would silently break the export/editor parity. The
 * shared helper is the only safe shape.
 *
 * The shape itself is NOT built here — each renderer's renderLayer already
 * computes the <rect>/<ellipse>/<path>/<text>/etc. for the layer, and
 * duplicating that into the helper would just move the duplication from
 * three renderers to one helper (still 3 places to keep in sync). Instead
 * the renderer passes the already-built shape in, and the helper wraps it
 * for the <mask> contents.
 *
 * Identity rule: a layer without `is_mask === true` emits NO <mask> def,
 * and a layer whose neighbor is not a mask is wrapped in NO <g mask=...>.
 * That keeps projects without any mask byte-identical to before this
 * feature — both sides of the conditional have to skip, not just one.
 */

import type { ReactNode } from "react";
import type { MotionLayer } from "../../types/motion";

/** Stable id for the SVG <mask> element. Namespaced by the mask layer's
 *  id so multiple masks don't collide. Used by renderMaskDef (to write
 *  the id attribute on the <mask>) and maskWrapIdFor (to write the
 *  url(#...) reference on the wrapping <g>). */
export function maskIdFor(maskLayerId: string): string {
  return `${maskLayerId}-mask`;
}

/** True when this layer should act as a mask. Centralised so the three
 *  renderers don't each reinvent the truthiness check. */
export function isMaskLayer(layer: MotionLayer | null | undefined): boolean {
  return !!layer && layer.is_mask === true;
}

/** The full <mask> JSX element for a layer with `is_mask === true`.
 *  Returns null when the layer isn't a mask (identity rule), so callers
 *  can drop this straight into a renderLayer map:
 *  `{renderMask(layer, shape, width, height)}`.
 *
 *  The renderer passes in the same shape it built for normal rendering.
 *  We wrap that shape inside the <mask> with fill="#ffffff" stroke="#ffffff"
 *  so SVG luminance masking reveals the masked region regardless of what
 *  colour the original shape was authored with — fill inheritance from
 *  the <g> cascades into the <rect>/<ellipse>/etc. children.
 *
 *  Mask region: `userSpaceOnUse` with bounding box of `(-pad, -pad,
 *  width+2*pad, height+2*pad)` to give shadow/blur/rotation a bit of
 *  bleed room. Without the padding, a shadowed layer would visually
 *  escape the mask at the edges.
 *
 *  Placement note: SVG <mask> elements can live anywhere in the tree and
 *  still be referenced by id. The renderers drop these inline in the
 *  layer map (NOT inside a single <defs> block) because the mask shape
 *  is only available after the renderer's existing shape-building code
 *  runs, and that code already runs once per layer inside renderLayer.
 *  Hoisting the mask into a separate <defs> pass would require extracting
 *  the shape-building logic into its own shared helper — outside the
 *  scope of LT-LAYERMASK, which is about not duplicating the MASK
 *  WIRING (not about refactoring the shape pipeline). Browsers and SVG
 *  libraries all handle inline <mask> correctly; identity rule below
 *  ensures the markup is byte-identical when no mask is in use.
 */
export function renderMask(
  layer: MotionLayer,
  shape: ReactNode,
  width: number,
  height: number,
  pad = 20
): ReactNode {
  if (!isMaskLayer(layer)) return null;
  return (
    <mask
      id={maskIdFor(layer.id)}
      maskUnits="userSpaceOnUse"
      x={-pad}
      y={-pad}
      width={width + 2 * pad}
      height={height + 2 * pad}
    >
      <g fill="#ffffff" stroke="#ffffff">
        {shape}
      </g>
    </mask>
  );
}

/** True when the layer at index i has the layer at i+1 marked as a mask
 *  (i.e. this layer should be wrapped in <g mask=...>). The three
 *  renderers call this with their full layer list and the current
 *  index to decide whether to wrap. */
export function isLayerMaskedByNext(layers: readonly MotionLayer[], index: number): boolean {
  if (index < 0 || index >= layers.length - 1) return false;
  return isMaskLayer(layers[index + 1]);
}

/** Returns the id of the mask that should wrap the layer at index i,
 *  or null if no wrapping is needed. Pairs with isLayerMaskedByNext so
 *  the renderer does one check then one wrap. */
export function maskWrapIdFor(layers: readonly MotionLayer[], index: number): string | null {
  if (!isLayerMaskedByNext(layers, index)) return null;
  return maskIdFor(layers[index + 1].id);
}

/** Convenience wrapper: returns the layer's already-built JSX wrapped in
 *  `<g mask="url(#...)">` if the layer below it is a mask, or returns
 *  the JSX unchanged if not. Used by all three renderers so the wrap
 *  markup can't drift. */
export function applyMaskToLayer(
  layers: readonly MotionLayer[],
  index: number,
  renderedShape: ReactNode
): ReactNode {
  const maskId = maskWrapIdFor(layers, index);
  if (!maskId) return renderedShape;
  return <g mask={`url(#${maskId})`}>{renderedShape}</g>;
}