/**
 * Speed ramp controls for a video layer (LT-SPEEDRAMP).
 *
 * Separate component for the same reason VideoCropControls is: Inspector.tsx
 * is the most contested file in this project, so a feature costs one line
 * there rather than a hundred.
 *
 * Ramp points are ordinary VideoLayerProps data, so undo/redo, autosave and
 * export all work through the existing layer-patch path with nothing new
 * plumbed.
 */

import { Gauge, Plus, X } from "lucide-react";
import { rampedSourceElapsedMs } from "./speedRamp";
import type { SpeedKeyframe, VideoLayerProps } from "../../types/motion";

export interface VideoSpeedControlsProps {
  video: VideoLayerProps;
  onChange: (patch: Partial<VideoLayerProps>) => void;
  playheadMs: number;
  visibleStartMs: number;
}

/** Handy multipliers. 0 is included deliberately — holding on a frame mid-clip
 *  is one of the most-used "speed" effects, and expressing it as rate 0 keeps
 *  it on the same curve as everything else rather than a separate mode. */
const PRESETS = [0, 0.25, 0.5, 1, 2, 4];

export function VideoSpeedControls({
  video,
  onChange,
  playheadMs,
  visibleStartMs,
}: VideoSpeedControlsProps) {
  const points = video.speed_keyframes ?? [];
  const sorted = [...points].sort((a, b) => a.time_ms - b.time_ms);

  function setPoints(next: SpeedKeyframe[]) {
    onChange({ speed_keyframes: [...next].sort((a, b) => a.time_ms - b.time_ms) });
  }

  function addAtPlayhead() {
    // Replace rather than duplicate if one already sits here — two points at
    // the same time make a zero-length segment with no defined rate.
    const existing = sorted.find((p) => Math.abs(p.time_ms - playheadMs) < 16);
    if (existing) return;
    setPoints([
      ...sorted,
      {
        id: `sp${Math.random().toString(36).slice(2, 10)}`,
        time_ms: Math.round(playheadMs),
        rate: 1,
        easing: "ease_in_out",
      },
    ]);
  }

  const rampedMs = points.length
    ? rampedSourceElapsedMs(points, playheadMs, visibleStartMs)
    : (playheadMs - visibleStartMs) * (video.playback_rate || 1);

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-text-muted flex items-center gap-1">
          <Gauge size={12} /> Speed ramp
        </span>
        <div className="flex items-center gap-2">
          {points.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ speed_keyframes: [] })}
              className="text-[10px] text-text-faint hover:text-text underline"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={addAtPlayhead}
            title="Add a speed point at the playhead"
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text border border-border rounded px-1.5 py-0.5"
          >
            <Plus size={10} /> Point
          </button>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="text-[10px] text-text-faint leading-snug">
          Constant {video.playback_rate ?? 1}×. Add two or more points to ramp
          between speeds — rate 0 holds a frame.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {sorted.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-faint tabular-nums w-10 shrink-0">
                  {(p.time_ms / 1000).toFixed(2)}s
                </span>
                <select
                  value={PRESETS.includes(p.rate) ? String(p.rate) : "custom"}
                  onChange={(e) => {
                    if (e.target.value === "custom") return;
                    setPoints(
                      sorted.map((q) =>
                        q.id === p.id ? { ...q, rate: Number(e.target.value) } : q,
                      ),
                    );
                  }}
                  className="flex-1 min-w-0 bg-surface border border-border rounded px-1 py-0.5 text-xs"
                >
                  {PRESETS.map((r) => (
                    <option key={r} value={r}>
                      {r === 0 ? "0× (hold)" : `${r}×`}
                    </option>
                  ))}
                  {!PRESETS.includes(p.rate) && (
                    <option value="custom">{p.rate}×</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => setPoints(sorted.filter((q) => q.id !== p.id))}
                  title="Remove this speed point"
                  className="text-text-faint hover:text-danger shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          {sorted.length === 1 && (
            <p className="text-[10px] text-text-faint mt-1.5 leading-snug">
              One point sets a constant speed. Add a second to ramp between two.
            </p>
          )}
          <p className="text-[10px] text-text-faint mt-1.5 tabular-nums">
            At the playhead: {(rampedMs / 1000).toFixed(2)}s into the clip
          </p>
        </>
      )}
    </div>
  );
}
