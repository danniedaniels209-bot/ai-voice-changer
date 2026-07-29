/**
 * A video layer rendered inside the live editor canvas, driven by the
 * timeline playhead rather than playing on its own.
 *
 * The canvas previously rendered video with `autoPlay loop`, which meant the
 * footage ran on an independent clock: scrubbing the timeline didn't move it,
 * pressing play didn't sync it, and the frame you saw at a given playhead
 * position was not the frame that would be exported. This component makes the
 * element a controlled surface — scene time in, correct source frame out.
 *
 * The scene-time -> source-time mapping here is deliberately identical to the
 * one the export renderer uses:
 *
 *     sourceTime = (trim_start_ms + playheadMs * playback_rate) / 1000
 *
 * If those two ever diverge, the editor silently lies about what you're going
 * to get, so keep them in lockstep (see RenderFrame.tsx / LT-VIDEOEXPORT).
 */

import { useEffect, useRef } from "react";
import { resolveMotionAssetUrl } from "../../api/motion";
import { cropInset, videoSourceTimeMs } from "../../types/motion";
import type { VideoLayerProps } from "../../types/motion";

export interface VideoLayerViewProps {
  video: VideoLayerProps;
  width: number;
  height: number;
  playheadMs: number;
  isPlaying: boolean;
  /** The layer's scene-time in-point, so the footage starts at its trim
   *  point when the layer appears rather than already partway through.
   *  The export renderer has always done this; the canvas didn't, which
   *  made retimed video layers preview a different frame than they
   *  exported. */
  visibleStartMs?: number;
}

/** While playing we let the element run on its own clock and only correct it
 * when it drifts past this much (seconds). Seeking on every playhead tick
 * would stutter badly — browsers can't seek at 60fps. */
const DRIFT_TOLERANCE_S = 0.15;

export function VideoLayerView({
  video,
  width,
  height,
  playheadMs,
  isPlaying,
  visibleStartMs = 0,
}: VideoLayerViewProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const src = resolveMotionAssetUrl(video.source_url);
  const sourceTimeS = videoSourceTimeMs(video, playheadMs, visibleStartMs) / 1000;

  // Keep the element's playback state in step with the transport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A frozen layer holds one frame, so it never runs — otherwise its audio
    // would keep playing under a still image.
    if (isPlaying && video.freeze_frame_ms == null) {
      // play() rejects if the element isn't ready yet or autoplay policy
      // blocks it. Neither is fatal here — the drift correction below will
      // still keep the displayed frame roughly right — so swallow it rather
      // than letting an unhandled rejection surface in the console.
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying, video.freeze_frame_ms]);

  // Seek to match the playhead. While paused (scrubbing) this is exact;
  // while playing it only corrects real drift so playback stays smooth.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = sourceTimeS;
    if (!Number.isFinite(target)) return;
    const frozen = video.freeze_frame_ms != null;
    if (!isPlaying || frozen || Math.abs(el.currentTime - target) > DRIFT_TOLERANCE_S) {
      try {
        el.currentTime = target;
      } catch {
        // Seeking before metadata loads throws in some browsers; the
        // loadedmetadata pass below re-applies it.
      }
    }
  }, [video, sourceTimeS, isPlaying]);

  // Apply the layer's own audio/rate settings.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.playbackRate = video.playback_rate || 1;
    el.muted = video.muted;
    el.volume = Math.min(1, Math.max(0, video.volume));
  }, [video.playback_rate, video.muted, video.volume]);

  return (
    <foreignObject width={width} height={height}>
      <video
        ref={ref}
        src={src}
        playsInline
        preload="auto"
        // Deliberately no autoPlay/loop: this element's time is owned by the
        // playhead effects above, not by the browser.
        onLoadedMetadata={(e) => {
          // Metadata arriving after the seek effect ran would otherwise leave
          // the element parked at 0 until the next playhead change.
          const el = e.currentTarget;
          if (Number.isFinite(sourceTimeS)) el.currentTime = sourceTimeS;
        }}
        style={{
          width: "100%",
          height: "100%",
          objectFit: video.fit === "cover" ? "cover" : video.fit === "fill" ? "fill" : "contain",
          clipPath: cropInset(video),
        }}
      />
    </foreignObject>
  );
}
