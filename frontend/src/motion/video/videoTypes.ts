/**
 * Draft proposal for video clip layer support in Motion Studio.
 * This file is a proposal and is not yet wired into types/motion.ts.
 */

export interface VideoLayerProps {
  /** URL to the underlying media file */
  source_url: string;
  /** Start point within the source media (in milliseconds) */
  trim_start_ms: number;
  /** End point within the source media (in milliseconds) */
  trim_end_ms: number;
  /** Playback speed (1.0 is normal speed) */
  playback_rate: number;
  /** Whether the audio track of the video is completely silenced */
  muted: boolean;
  /** Audio volume multiplier (0.0 to 1.0+) */
  volume: number;
}

/**
 * Proposed extensions to existing types:
 *
 * type LayerType = "rect" | "ellipse" | "text" | "image" | "video";
 *
 * interface MotionLayer {
 *   // ... existing fields ...
 *   video: VideoLayerProps | null;
 * }
 */
