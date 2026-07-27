/**
 * Keyframe timeline: a time ruler + playhead + one row per layer showing
 * all of that layer's keyframes (merged across properties into one row —
 * per-property sub-tracks are a later refinement, not needed to prove the
 * animation engine end-to-end). Dragging a keyframe diamond updates a
 * local preview and commits once on mouse-up, same reasoning as the
 * canvas's move/resize drags: one commit per gesture, not one per pixel.
 */

import { useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, ZoomIn, ZoomOut } from "lucide-react";
import type { MotionScene } from "../types/motion";

interface TimelineProps {
  scene: MotionScene;
  playheadMs: number;
  selectedLayerIds: string[];
  isPlaying: boolean;
  onScrub: (ms: number) => void;
  onSelectLayer: (id: string) => void;
  onMoveKeyframe: (layerId: string, keyframeId: string, timeMs: number) => void;
  onDeleteKeyframe: (layerId: string, keyframeId: string) => void;
  onTogglePlay: () => void;
}

const ROW_HEIGHT = 28;
const RULER_HEIGHT = 24;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 400;
const FRAME_MS = 1000 / 30;

export function Timeline({
  scene,
  playheadMs,
  selectedLayerIds,
  isPlaying,
  onScrub,
  onSelectLayer,
  onMoveKeyframe,
  onDeleteKeyframe,
  onTogglePlay,
}: TimelineProps) {
  const [pxPerSec, setPxPerSec] = useState(80);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragKeyframe = useRef<{ layerId: string; keyframeId: string } | null>(null);
  const [dragPreviewMs, setDragPreviewMs] = useState<number | null>(null);

  function msToPx(ms: number): number {
    return (ms / 1000) * pxPerSec;
  }
  function pxToMs(px: number): number {
    return Math.max(0, (px / pxPerSec) * 1000);
  }

  function handleRulerClick(e: React.MouseEvent) {
    const rect = trackRef.current!.getBoundingClientRect();
    onScrub(pxToMs(e.clientX - rect.left));
  }

  function handleKeyframeMouseDown(e: React.MouseEvent, layerId: string, keyframeId: string) {
    e.stopPropagation();
    dragKeyframe.current = { layerId, keyframeId };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragKeyframe.current) return;
    const rect = trackRef.current!.getBoundingClientRect();
    setDragPreviewMs(pxToMs(e.clientX - rect.left));
  }

  function handleMouseUp() {
    if (dragKeyframe.current && dragPreviewMs !== null) {
      onMoveKeyframe(dragKeyframe.current.layerId, dragKeyframe.current.keyframeId, dragPreviewMs);
    }
    dragKeyframe.current = null;
    setDragPreviewMs(null);
  }

  const durationSec = scene.duration_ms / 1000;
  const width = Math.max(600, msToPx(scene.duration_ms) + 40);
  const secondMarks = Array.from({ length: Math.ceil(durationSec) + 1 }, (_, i) => i);

  return (
    <div className="flex flex-col h-full">
      <div className="h-9 shrink-0 border-b border-border flex items-center gap-1 px-2">
        <button
          type="button"
          title="Previous frame"
          onClick={() => onScrub(Math.max(0, playheadMs - FRAME_MS))}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          title={isPlaying ? "Pause" : "Play"}
          onClick={onTogglePlay}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          title="Next frame"
          onClick={() => onScrub(Math.min(scene.duration_ms, playheadMs + FRAME_MS))}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <SkipForward size={14} />
        </button>
        <span className="text-xs text-text-faint tabular-nums px-2">
          {(playheadMs / 1000).toFixed(2)}s / {(scene.duration_ms / 1000).toFixed(2)}s
        </span>
        <div className="flex-1" />
        <button
          type="button"
          title="Zoom out timeline"
          onClick={() => setPxPerSec((p) => Math.max(MIN_PX_PER_SEC, p / 1.4))}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          title="Zoom in timeline"
          onClick={() => setPxPerSec((p) => Math.min(MAX_PX_PER_SEC, p * 1.4))}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <ZoomIn size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        <div style={{ width }}>
          {/* Ruler */}
          <div
            ref={trackRef}
            className="relative border-b border-border cursor-pointer select-none"
            style={{ height: RULER_HEIGHT }}
            onClick={handleRulerClick}
          >
            {secondMarks.map((s) => (
              <div
                key={s}
                className="absolute top-0 bottom-0 border-l border-border text-[10px] text-text-faint pl-1"
                style={{ left: msToPx(s * 1000) }}
              >
                {s}s
              </div>
            ))}
            <div
              className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-10"
              style={{ left: msToPx(playheadMs) }}
            >
              <div className="w-2.5 h-2.5 -ml-[5px] -mt-0.5 bg-accent rotate-45" />
            </div>
          </div>

          {/* Layer rows */}
          <div className="relative">
            {scene.layers.map((layer) => {
              const selected = selectedLayerIds.includes(layer.id);
              return (
                <div
                  key={layer.id}
                  onClick={() => onSelectLayer(layer.id)}
                  className={`relative border-b border-border/50 cursor-pointer ${
                    selected ? "bg-accent-dim/30" : "hover:bg-surface-hover/50"
                  }`}
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[11px] text-text-muted truncate max-w-[140px] pointer-events-none">
                    {layer.name}
                  </span>
                  {layer.keyframes.map((kf) => {
                    const dragging = dragKeyframe.current?.keyframeId === kf.id;
                    const ms = dragging && dragPreviewMs !== null ? dragPreviewMs : kf.time_ms;
                    return (
                      <div
                        key={kf.id}
                        title={`${kf.property} = ${kf.value} @ ${(ms / 1000).toFixed(2)}s (${kf.easing})`}
                        onMouseDown={(e) => handleKeyframeMouseDown(e, layer.id, kf.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onDeleteKeyframe(layer.id, kf.id);
                        }}
                        className="absolute top-1/2 w-2.5 h-2.5 -mt-[5px] -ml-[5px] bg-accent rotate-45 border border-white/40 cursor-ew-resize"
                        style={{ left: msToPx(ms) }}
                      />
                    );
                  })}
                </div>
              );
            })}
            {scene.layers.length === 0 && (
              <p className="text-xs text-text-faint text-center py-3">
                Add a layer, then use the Inspector's keyframe buttons to animate it.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
