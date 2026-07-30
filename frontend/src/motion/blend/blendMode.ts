/**
 * CSS mix-blend-mode for any layer (LT-LAYERBLEND). Applied to the layer's
 * outer <g> so the blend happens against everything already painted below
 * the layer in the scene (scene background, earlier-z layers).
 *
 * Why this is its own module and not just an inline `style={...}` at each
 * call site: gradient, shadow, and blur each ALREADY have their own
 * `render*Filter` function duplicated three times, once per renderer — the
 * exact shape of bug that's cost this project real time this week (Claude
 * flagged it explicitly when shipping LT-COLORGRADE). Per-layer effects
 * must be defined ONCE and imported by all three renderers, not written
 * three times and allowed to drift. mix-blend-mode is just a CSS property
 * so there's less code than the filter cases, but the principle is the
 * same: one helper, three callers, no drift possible.
 *
 * Identity rule: a layer with `blend_mode == null` (or absent) emits NO
 * style attribute at all on its outer <g>. That's byte-identical to today,
 * which is what every existing project depends on. Setting it to the
 * literal string "normal" would also produce the same visual result but
 * would NOT be byte-identical — an `style="mix-blend-mode: normal"` on
 * every layer's <g> would show up in every diff of every export. The
 * "null = no style at all" rule is the only one that keeps `null` and
 * "no field on the wire" rendering exactly the same SVG.
 */

import type { CSSProperties } from "react";
import type { BlendMode } from "../../types/motion";

/** The valid BlendMode values, in the order the picker should display them.
 *  Mirrored from the backend Literal in models.py — adding a new blend
 *  mode requires changing both, the renderer helper, AND the picker, so
 *  all three stay in lockstep. "normal" is intentionally first so the
 *  "no effect" reset is a single click. */
export const BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

/** True for null/undefined OR the literal "normal" string. Callers skip
 *  emitting any style attribute in that case — see the identity rule in
 *  the module header. Treating "normal" as the same as null lets the
 *  picker default to "normal" (which is the visually-correct value) AND
 *  keeps the rendered SVG byte-identical to a layer that never had the
 *  field set at all. */
export function isNormalBlend(blend: BlendMode | null | undefined): boolean {
  return !blend || blend === "normal";
}

/** The single definition of "how does a layer's blend_mode become CSS?"
 *  Returns undefined when no style is needed (null/absent/"normal"), so
 *  callers can spread it into a <g style={...}> without ever producing
 *  `style={undefined}` or `style={{}}` — both of which are syntactically
 *  fine but visibly different from "no style attribute at all" in some
 *  diff tools, and the byte-identical goal is sharp enough that "fine"
 *  isn't good enough.
 *
 *  Return type is `Pick<CSSProperties, "mixBlendMode">` (not just
 *  `{ mixBlendMode: string }`) so the helper's output composes with
 *  React's typed style prop on every renderer. Casting through the css
 *  type's MixBlendMode union is required because our own BlendMode union
 *  is a SUBSET of CSS's — TypeScript can't prove that without the cast,
 *  but the backend Literal in models.py already pins the same set. */
export function blendStyle(blend: BlendMode | null | undefined): Pick<CSSProperties, "mixBlendMode"> | undefined {
  if (isNormalBlend(blend)) return undefined;
  return { mixBlendMode: blend as CSSProperties["mixBlendMode"] };
}