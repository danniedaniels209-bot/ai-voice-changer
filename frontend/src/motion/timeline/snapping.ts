const SNAP_THRESHOLD_PX = 8;

export function findSnap(
  candidateMs: number,
  targets: number[],
  pxPerSec: number,
): number | null {
  const thresholdMs = (SNAP_THRESHOLD_PX / pxPerSec) * 1000;
  let closest: number | null = null;
  let closestDist = thresholdMs;
  for (const t of targets) {
    const dist = Math.abs(candidateMs - t);
    if (dist < closestDist) {
      closest = t;
      closestDist = dist;
    }
  }
  return closest;
}
