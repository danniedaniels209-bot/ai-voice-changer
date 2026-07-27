/**
 * Drives timeline playback off requestAnimationFrame, same reasoning as
 * the subtitle engine's useSubtitleClock: rAF tracks the display's actual
 * refresh rate instead of drifting like a fixed setInterval would.
 *
 * `onTick` is read through a ref rather than being an effect dependency —
 * MotionEditor re-renders on every tick (the playhead moves), so if the
 * effect restarted whenever `onTick` changed identity, playback would
 * reset its delta-time baseline every single frame and stutter.
 */

import { useEffect, useRef, useState } from "react";

export function usePlaybackClock(durationMs: number, playheadMs: number, onTick: (ms: number) => void) {
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef = useRef(0);
  const lastFrameTime = useRef<number | null>(null);
  const playheadRef = useRef(playheadMs);
  const onTickRef = useRef(onTick);
  playheadRef.current = playheadMs;
  onTickRef.current = onTick;

  useEffect(() => {
    if (!isPlaying) return;

    function tick(now: number) {
      if (lastFrameTime.current === null) lastFrameTime.current = now;
      const delta = now - lastFrameTime.current;
      lastFrameTime.current = now;
      const next = playheadRef.current + delta;
      onTickRef.current(next >= durationMs ? 0 : next);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastFrameTime.current = null;
    };
  }, [isPlaying, durationMs]);

  return {
    isPlaying,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    toggle: () => setIsPlaying((p) => !p),
  };
}
