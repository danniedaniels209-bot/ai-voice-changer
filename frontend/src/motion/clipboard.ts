import type { MotionConnector, MotionLayer, MotionScene } from "../types/motion";
import { newId } from "./state";
import { resolveTransformAtTime } from "./easing";

export interface ClipboardData {
  layers: MotionLayer[];
  connectors: MotionConnector[];
}

let clipboard: ClipboardData | null = null;

export function getClipboard(): ClipboardData | null {
  return clipboard;
}

export function setClipboard(data: ClipboardData | null): void {
  clipboard = data;
}

export function copyToClipboard(
  layers: MotionLayer[],
  connectors: MotionConnector[],
): void {
  clipboard = { layers, connectors };
}

export interface PasteResult {
  layers: MotionLayer[];
  connectors: MotionConnector[];
}

export function preparePaste(
  clipboard: ClipboardData,
  targetScene: MotionScene,
  playheadMs: number,
): PasteResult {
  const oldToNew = new Map<string, string>();
  const origMinStart = Math.min(
    ...clipboard.layers.map((l) => l.visible_start_ms ?? 0),
  );

  const pastedLayers: MotionLayer[] = clipboard.layers.map((l) => {
    const newLayerId = newId();
    oldToNew.set(l.id, newLayerId);
    const origStart = l.visible_start_ms ?? 0;
    const origEnd = l.visible_end_ms ?? targetScene.duration_ms;

    return {
      ...l,
      id: newLayerId,
      visible_start_ms: playheadMs + (origStart - origMinStart),
      visible_end_ms: playheadMs + (origEnd - origMinStart),
      transform: {
        ...l.transform,
        x: l.transform.x + 20,
        y: l.transform.y + 20,
      },
      keyframes: l.keyframes.map((k) => ({
        ...k,
        id: newId(),
        time_ms: playheadMs + (k.time_ms - origMinStart),
      })),
    };
  });

  const pastedConnectors: MotionConnector[] = clipboard.connectors
    .map((c) => {
      const newSourceId = oldToNew.get(c.source.layer_id);
      const newTargetId = oldToNew.get(c.target.layer_id);
      if (!newSourceId || !newTargetId) return null;
      return {
        ...c,
        id: newId(),
        source: { ...c.source, layer_id: newSourceId },
        target: { ...c.target, layer_id: newTargetId },
      };
    })
    .filter((c): c is MotionConnector => c !== null);

  return { layers: pastedLayers, connectors: pastedConnectors };
}

export function preparePasteSpecial(
  clipboard: ClipboardData,
  targetScene: MotionScene,
  playheadMs: number,
): PasteResult {
  const oldToNew = new Map<string, string>();
  const origMinStart = Math.min(
    ...clipboard.layers.map((l) => l.visible_start_ms ?? 0),
  );

  const pastedLayers: MotionLayer[] = clipboard.layers.map((l) => {
    const newLayerId = newId();
    oldToNew.set(l.id, newLayerId);
    const origStart = l.visible_start_ms ?? 0;
    const origEnd = l.visible_end_ms ?? targetScene.duration_ms;
    const resolved = resolveTransformAtTime(l, playheadMs);

    return {
      ...l,
      id: newLayerId,
      visible_start_ms: playheadMs + (origStart - origMinStart),
      visible_end_ms: playheadMs + (origEnd - origMinStart),
      transform: {
        ...resolved,
        x: resolved.x + 20,
        y: resolved.y + 20,
      },
      keyframes: [],
    };
  });

  const pastedConnectors: MotionConnector[] = clipboard.connectors
    .map((c) => {
      const newSourceId = oldToNew.get(c.source.layer_id);
      const newTargetId = oldToNew.get(c.target.layer_id);
      if (!newSourceId || !newTargetId) return null;
      return {
        ...c,
        id: newId(),
        source: { ...c.source, layer_id: newSourceId },
        target: { ...c.target, layer_id: newTargetId },
      };
    })
    .filter((c): c is MotionConnector => c !== null);

  return { layers: pastedLayers, connectors: pastedConnectors };
}
