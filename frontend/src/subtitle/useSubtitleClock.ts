/**
 * Drives the live subtitle preview off requestAnimationFrame (matches the
 * display's actual refresh rate — 60Hz on typical hardware — rather than a
 * fixed setInterval that can drift out of sync with the video). Only
 * commits a React state update when the visible cue or active word
 * actually changes, so a caption sitting on screen unchanged for two
 * seconds doesn't cause 120 wasted re-renders.
 */

import { useEffect, useRef, useState } from "react";
import type { SubtitleCue } from "../types/subtitle";
import { findActiveCue, findActiveWordIndex } from "./timing";

export interface SubtitleClockState {
  currentTime: number;
  activeCue: SubtitleCue | null;
  activeWordIndex: number; // -1 when there's no active cue or no words
}

const EMPTY_STATE: SubtitleClockState = { currentTime: 0, activeCue: null, activeWordIndex: -1 };

export function useSubtitleClock(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  cues: SubtitleCue[],
): SubtitleClockState {
  const [state, setState] = useState<SubtitleClockState>(EMPTY_STATE);
  const rafRef = useRef(0);
  const lastCueId = useRef<string | null>(null);
  const lastWordIdx = useRef(-1);

  useEffect(() => {
    function tick() {
      const video = videoRef.current;
      if (video) {
        const t = video.currentTime;
        const cue = findActiveCue(cues, t);
        const wordIdx = findActiveWordIndex(cue, t);
        if (cue?.id !== lastCueId.current || wordIdx !== lastWordIdx.current) {
          lastCueId.current = cue?.id ?? null;
          lastWordIdx.current = wordIdx;
          setState({ currentTime: t, activeCue: cue, activeWordIndex: wordIdx });
        } else if (cue) {
          // Same cue/word still active, but karaoke's sweep-fill needs
          // currentTime every frame to keep animating smoothly.
          setState((prev) => ({ ...prev, currentTime: t }));
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef, cues]);

  return state;
}
