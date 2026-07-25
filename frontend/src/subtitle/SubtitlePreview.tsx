/**
 * Small looping demo: no real video, just a self-driven rAF clock over a
 * fixed sample cue, rendered through the same SubtitleFrame that draws the
 * real burned-in export — so choosing a style in Settings shows exactly
 * what it will look like.
 */

import { useEffect, useRef, useState } from "react";
import { SubtitleFrame } from "./SubtitleFrame";
import type { SubtitleStyle } from "../types/subtitle";

const DEMO_CUES = [
  { id: "demo", start: 0, end: 2.4, text: "This is how your captions will look", words: [] },
];
const LOOP_DURATION = 3; // seconds — a beat of silence after the cue before it repeats
const DEMO_WIDTH = 480; // px, drives the 1920-reference scale factor

interface SubtitlePreviewProps {
  style: SubtitleStyle;
}

export function SubtitlePreview({ style }: SubtitlePreviewProps) {
  const [t, setT] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    function tick(now: number) {
      if (startRef.current === null) startRef.current = now;
      const elapsed = ((now - startRef.current) / 1000) % LOOP_DURATION;
      setT(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: DEMO_WIDTH,
        height: (DEMO_WIDTH * 9) / 16,
        background: "#1a1a1a",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <SubtitleFrame currentTime={t} cues={DEMO_CUES} style={style} scale={DEMO_WIDTH / 1920} />
    </div>
  );
}
