/**
 * Crop and freeze-frame controls for a video layer (LT-VIDEOEDIT).
 *
 * A separate component rather than more JSX inside Inspector.tsx: Inspector
 * is the single most contested file in this project — several agents need it
 * at once — and a self-contained control means adding this feature costs one
 * line there instead of eighty.
 *
 * Both features are pure VideoLayerProps edits, so undo/redo, autosave and
 * export all work through the existing layer-patch path with nothing new
 * plumbed.
 */

import { Snowflake } from "lucide-react";
import { videoSourceTimeMs } from "../../types/motion";
import type { VideoLayerProps } from "../../types/motion";

export interface VideoCropControlsProps {
  video: VideoLayerProps;
  /** Patch the layer's video props. */
  onChange: (patch: Partial<VideoLayerProps>) => void;
  /** Current scene time, used to resolve "freeze the frame I'm looking at". */
  playheadMs: number;
  /** The layer's scene-time in-point, so that resolution matches what the
   *  canvas is actually showing for a retimed layer. */
  visibleStartMs: number;
}

const EDGES = [
  { key: "crop_top", label: "Top" },
  { key: "crop_right", label: "Right" },
  { key: "crop_bottom", label: "Bottom" },
  { key: "crop_left", label: "Left" },
] as const;

/** Percent in the UI, fraction on the wire. Users think in percentages; the
 *  model stores 0–1 so it stays resolution-independent. */
function CropEdge({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted block mb-1">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="flex-1 accent-accent min-w-0"
        />
        <span className="text-[10px] text-text-faint tabular-nums w-8 text-right shrink-0">
          {Math.round(value * 100)}%
        </span>
      </div>
    </label>
  );
}

export function VideoCropControls({
  video,
  onChange,
  playheadMs,
  visibleStartMs,
}: VideoCropControlsProps) {
  const cropped = EDGES.some(({ key }) => (video[key] ?? 0) > 0);
  const frozen = video.freeze_frame_ms != null;

  return (
    <>
      <div className="pt-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-text-muted">Crop</span>
          {cropped && (
            <button
              type="button"
              onClick={() =>
                onChange({ crop_top: 0, crop_right: 0, crop_bottom: 0, crop_left: 0 })
              }
              className="text-[10px] text-text-faint hover:text-text underline"
            >
              Reset
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {EDGES.map(({ key, label }) => (
            <CropEdge
              key={key}
              label={label}
              value={video[key] ?? 0}
              onChange={(v) => onChange({ [key]: v })}
            />
          ))}
        </div>
        {cropped && (
          <p className="text-[10px] text-text-faint mt-1.5 leading-snug">
            Cropping trims the edges away; it doesn't zoom in. Resize the layer to
            fill the frame with what's left.
          </p>
        )}
      </div>

      <div className="pt-1">
        <span className="text-xs text-text-muted block mb-1.5">Freeze frame</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              onChange({
                freeze_frame_ms: frozen
                  ? null
                  : Math.round(videoSourceTimeMs(video, playheadMs, visibleStartMs)),
              })
            }
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs border transition-colors ${
              frozen
                ? "bg-accent-dim border-accent text-accent"
                : "bg-surface border-border text-text-muted hover:text-text"
            }`}
            title={
              frozen
                ? "Resume normal playback"
                : "Hold the frame currently under the playhead for the whole layer"
            }
          >
            <Snowflake size={13} />
            {frozen ? "Frozen" : "Freeze at playhead"}
          </button>
          {frozen && (
            <span className="text-[10px] text-text-faint tabular-nums">
              {(video.freeze_frame_ms! / 1000).toFixed(2)}s into the clip
            </span>
          )}
        </div>
      </div>
    </>
  );
}
