/**
 * Transition keyframe generator — turns a TransitionDefinition (from
 * transitions.ts, which is data-only) into the actual Keyframe[] that realize
 * that transition on a layer. Pure: no side effects, no state reads. The
 * caller is responsible for merging the returned keyframes into the layer's
 * existing `keyframes` array however it sees fit.
 *
 * Mirrors the exact pattern motionPresets.ts uses to build keyframe arrays:
 * a local newId() for ids anchored at the layer's own transform (so a
 * transition never jumps a layer away from where the editor placed it — the
 * keyframes animate FROM somewhere back TO t.x/t.y/t.width/t.height/t.opacity,
 * the layer's static transform, matching how interpolateProperty in easing.ts
 * resolves a property before its first keyframe).
 *
 * The TransitionDef in transitions.ts is { id, label, previewGlyph,
 * duration_ms }. The `id` is what selects the transition kind here. Note the
 * id space overlaps motionPresets.ts's PresetId ("fade", "slide-left", ...)
 * intentionally — transitions are the *between-scene* analog of an entry
 * preset — but the signatures differ (a transition takes an explicit duration
 * rather than deriving one from a scene length), so this is a standalone
 * function, not a branch of applyPreset.
 */

import type { EasingType, Keyframe, MotionLayer } from "../../types/motion";
import type { TransitionDef } from "./transitions";

function newId(): string {
  return crypto.randomUUID().slice(0, 12);
}

function keyframe(
  time_ms: number,
  property: "x" | "y" | "width" | "height" | "rotation" | "opacity",
  value: number,
  easing: EasingType,
): Keyframe {
  return { id: newId(), time_ms, property, value, easing };
}

/**
 * Generate the keyframes that realize `transition` on `layer` over
 * `durationMs`. The animation plays forward from time 0 (the scene boundary)
 * to durationMs — same convention as motionPresets.ts, which documents why a
 * negative "before the timeline" start would be invisible.
 *
 * Each transition animates the layer FROM an off-screen / hidden / altered
 * state back TO its static transform, so at the end of the transition the
 * layer is exactly where the editor placed it.
 */
export function applyTransition(
  transition: TransitionDef,
  layer: MotionLayer,
  durationMs: number,
): Keyframe[] {
  const t = layer.transform;
  const start = 0;
  const end = Math.max(1, Math.round(durationMs));

  switch (transition.id) {
    case "fade": {
      // Opacity 0 -> layer's opacity over the duration.
      return [
        keyframe(start, "opacity", 0, "ease_in_out"),
        keyframe(end, "opacity", t.opacity, "linear"),
      ];
    }

    case "slide-left": {
      // Layer enters from the right, slides left to its resting x.
      const offset = t.width * 1.5 + 80;
      return [
        keyframe(start, "x", t.x + offset, "ease_out"),
        keyframe(end, "x", t.x, "linear"),
      ];
    }

    case "slide-right": {
      // Layer enters from the left, slides right to its resting x.
      const offset = t.width * 1.5 + 80;
      return [
        keyframe(start, "x", t.x - offset, "ease_out"),
        keyframe(end, "x", t.x, "linear"),
      ];
    }

    case "slide-up": {
      // Layer enters from below, slides up to its resting y.
      const offset = t.height * 1.5 + 80;
      return [
        keyframe(start, "y", t.y + offset, "ease_out"),
        keyframe(end, "y", t.y, "linear"),
      ];
    }

    case "slide-down": {
      // Layer enters from above, slides down to its resting y.
      const offset = t.height * 1.5 + 80;
      return [
        keyframe(start, "y", t.y - offset, "ease_out"),
        keyframe(end, "y", t.y, "linear"),
      ];
    }

    case "push": {
      // A "push" reads as the layer sliding in from the right with a firmer,
      // constant-velocity feel (linear easing, no soft landing). Same x path
      // as slide-left but linear so it keeps moving all the way to rest.
      const offset = t.width + 80;
      return [
        keyframe(start, "x", t.x + offset, "linear"),
        keyframe(end, "x", t.x, "linear"),
      ];
    }

    case "zoom": {
      // Scale up from near-zero to full size. Width/height are the only scale
      // knobs the engine has (there's no separate scale property), so animate
      // both. Elastic gives the zoom a slight overshoot settle.
      return [
        keyframe(start, "width", t.width * 0.05, "elastic"),
        keyframe(end, "width", t.width, "linear"),
        keyframe(start, "height", t.height * 0.05, "elastic"),
        keyframe(end, "height", t.height, "linear"),
      ];
    }

    case "wipe": {
      // A wipe is approximated as a horizontal scale-in: width starts at 0
      // and grows to full, anchored at the layer's left edge by offsetting x
      // so the layer's left side stays put as width expands. (There's no clip
      // primitive in the engine, so this fakes "reveal left-to-right" by
      // growing the rect from its left edge rather than masking it.)
      return [
        keyframe(start, "x", t.x - t.width / 2, "linear"),
        keyframe(end, "x", t.x, "linear"),
        keyframe(start, "width", 0, "linear"),
        keyframe(end, "width", t.width, "linear"),
      ];
    }

    case "dissolve": {
      // Dissolve is a softer, longer fade — opacity 0 -> rest, but with
      // ease_in_out for a gentler curve than a plain fade, plus a very slight
      // scale breath (width/height dip ~6% and recover) so it doesn't read as
      // a literal identical twin of "fade". The breath is small enough that a
      // text or rect layer still looks like it's settling, not bouncing.
      return [
        keyframe(start, "opacity", 0, "ease_in_out"),
        keyframe(end, "opacity", t.opacity, "ease_in_out"),
        keyframe(start, "width", t.width * 0.94, "ease_in_out"),
        keyframe(end, "width", t.width, "linear"),
        keyframe(start, "height", t.height * 0.94, "ease_in_out"),
        keyframe(end, "height", t.height, "linear"),
      ];
    }

    default:
      return [];
  }
}
