/**
 * Scene-level transition wiring. TransitionPicker gives a transition id;
 * applyTransition.ts (built in the previous task) turns a TransitionDefinition
 * into the Keyframe[] that realize that transition on ONE layer. Nothing
 * connects the two to a whole scene yet — this is that bridge.
 *
 * Export one pure function: given a scene, a transition id, and a duration,
 * return the APPLY_KEYFRAMES payloads for every eligible layer in that scene
 * — an array of { layerId, keyframes }.
 *
 * Eligible = not hidden and not locked. A locked layer is intentionally
 * pinned by the editor (transforms shouldn't shift underneath it); a hidden
 * layer isn't visible on the canvas so animating it is wasted work that would
 * also surprise the user on the next un-hide. Both are skipped.
 *
 * No dispatch, no React, no side effects — the caller is responsible for
 * folding the returned payloads into editor state, e.g. by dispatching one
 * APPLY_KEYFRAMES per element. The return shape matches the ApplyKeyframes
 * action variant in state.ts exactly ({ layerId, keyframes }) so the caller
 * can spread the array straight into a batch of dispatches.
 */

import type { Keyframe, MotionScene } from "../../types/motion";
import { applyTransition } from "./applyTransition";
import { TRANSITION_DEFINITIONS, type TransitionDef } from "./transitions";

/** One layer's worth of transition keyframes — matches the APPLY_KEYFRAMES
 * action variant in state.ts (`{ type: "APPLY_KEYFRAMES"; layerId; keyframes }`
 * minus the `type` tag, since this isn't an action, just a payload). */
export interface TransitionKeyframePayload {
  layerId: string;
  keyframes: Keyframe[];
}

/**
 * Resolve a transition id to its TransitionDefinition, or null if the id
 * isn't in the catalog. Kept local so callers of applyTransitionToScene don't
 * need to import the catalog themselves.
 */
function findTransition(transitionId: string): TransitionDef | undefined {
  return TRANSITION_DEFINITIONS.find((d) => d.id === transitionId);
}

/**
 * Generate APPLY_KEYFRAMES payloads for every eligible layer in `scene`,
 * animating each one in according to the `transitionId` transition over
 * `durationMs`.
 *
 * Pure: builds a fresh keyframe set per layer (applyTransition already mints
 * fresh ids via newId()), returns nothing but the payload array. The caller
 * dispatches them — typically as one undo-grouped batch, since applying a
 * transition to a scene should be a single undo step (mirror ALIGN_LAYERS's
 * one-snapshot-per-batch reasoning, not per-layer undo).
 */
export function applyTransitionToScene(
  scene: MotionScene,
  transitionId: string,
  durationMs: number,
): TransitionKeyframePayload[] {
  const transition = findTransition(transitionId);
  if (!transition) return [];

  const payloads: TransitionKeyframePayload[] = [];
  for (const layer of scene.layers) {
    // Skip hidden and locked layers — see module doc for the rationale.
    if (layer.hidden || layer.locked) continue;

    const keyframes = applyTransition(transition, layer, durationMs);
    // applyTransition returns [] for an unknown transition id, so we'd
    // produce an empty-payload entry. Filter those out so the caller can
    // short-circuit on `.length === 0` (matching how ALIGN_LAYERS treats an
    // empty updates array as a no-op rather than a spurious undo snapshot).
    if (keyframes.length === 0) continue;

    payloads.push({ layerId: layer.id, keyframes });
  }
  return payloads;
}
