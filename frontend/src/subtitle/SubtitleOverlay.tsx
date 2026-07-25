/**
 * Live subtitle preview: an absolutely-positioned layer over a <video>
 * element. Thin wrapper — useSubtitleClock supplies the 60fps-driven
 * current time/active cue/word off the video, SubtitleFrame does the
 * actual drawing (shared with the style-picker preview widget so both
 * render identically).
 */

import type { RefObject } from "react";
import { useSubtitleClock } from "./useSubtitleClock";
import { SubtitleFrame } from "./SubtitleFrame";
import type { SubtitleCue, SubtitleStyle } from "../types/subtitle";

interface SubtitleOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cues: SubtitleCue[];
  style: SubtitleStyle;
}

/** The style's px values are authored against a 1920x1080 reference canvas
 * (matching the ASS renderer's PlayResX/Y) — scale them to however big the
 * <video> element is actually rendered on screen. */
function playerScale(video: HTMLVideoElement | null): number {
  const width = video?.clientWidth;
  return width ? width / 1920 : 1;
}

export function SubtitleOverlay({ videoRef, cues, style }: SubtitleOverlayProps) {
  const { currentTime } = useSubtitleClock(videoRef, cues);
  const scale = playerScale(videoRef.current);
  return <SubtitleFrame currentTime={currentTime} cues={cues} style={style} scale={scale} />;
}
