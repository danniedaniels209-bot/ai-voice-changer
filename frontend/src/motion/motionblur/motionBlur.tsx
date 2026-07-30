import type { ReactNode } from "react";
import type { MotionLayer } from "../../types/motion";
import { resolveTransformAtTime } from "../easing";

export interface MotionBlurResult {
  blurX: number;
  blurY: number;
}

const DEFAULT_DELTA_MS = 33; // ~1 frame at 30fps
const MAX_BLUR_PX = 40;
const VELOCITY_SCALE = 0.4;
const ROTATION_SCALE = 0.2;

/**
 * Computes instantaneous motion blur stdDev (blurX, blurY) for a layer at a given time.
 * Returns null if motion_blur is false or if layer velocity is below threshold (<0.1px).
 *
 * Fully stateless & frame-independent: evaluates resolveTransformAtTime(layer, timeMs)
 * vs resolveTransformAtTime(layer, timeMs - deltaMs). Works identically in editor canvas,
 * export (Playwright), and thumbnails.
 */
export function computeMotionBlur(
  layer: MotionLayer,
  timeMs: number,
  deltaMs = DEFAULT_DELTA_MS,
): MotionBlurResult | null {
  if (!layer.motion_blur) return null;

  const tCurr = resolveTransformAtTime(layer, timeMs);
  const prevTimeMs = Math.max(0, timeMs - deltaMs);
  const tPrev = resolveTransformAtTime(layer, prevTimeMs);

  const dx = tCurr.x - tPrev.x;
  const dy = tCurr.y - tPrev.y;
  const dRot = tCurr.rotation - tPrev.rotation;

  // Approximate rotational arc-length speed at outer layer boundary
  const radius = Math.sqrt(tCurr.width * tCurr.width + tCurr.height * tCurr.height) / 2;
  const rotSpeedPx = Math.abs(dRot) * (Math.PI / 180) * radius;

  const rawBlurX = Math.abs(dx) * VELOCITY_SCALE + rotSpeedPx * ROTATION_SCALE;
  const rawBlurY = Math.abs(dy) * VELOCITY_SCALE + rotSpeedPx * ROTATION_SCALE;

  if (rawBlurX < 0.1 && rawBlurY < 0.1) return null;

  return {
    blurX: Math.min(MAX_BLUR_PX, rawBlurX),
    blurY: Math.min(MAX_BLUR_PX, rawBlurY),
  };
}

/** Namespaced SVG filter ID for a layer's motion blur. */
export function motionBlurFilterId(layerId: string): string {
  return `${layerId}-motion-blur`;
}

/**
 * Emits the SVG <filter><feGaussianBlur stdDeviation="blurX blurY"> definition.
 */
export function renderMotionBlurFilter(
  layerId: string,
  blurX: number,
  blurY: number,
): ReactNode {
  const stdDev = `${blurX.toFixed(2)} ${blurY.toFixed(2)}`;
  return (
    <filter
      key={motionBlurFilterId(layerId)}
      id={motionBlurFilterId(layerId)}
      x="-100%"
      y="-100%"
      width="300%"
      height="300%"
    >
      <feGaussianBlur stdDeviation={stdDev} />
    </filter>
  );
}
