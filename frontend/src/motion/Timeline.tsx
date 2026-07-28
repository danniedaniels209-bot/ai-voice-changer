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
import type { MotionScene, AudioTrack } from "../types/motion";
import { Waveform } from "./audio/WaveformCanvas";

interface TimelineProps {
  scene: MotionScene;
  activeAudioTrack?: AudioTrack;
  playheadMs: number;
  selectedLayerIds: string[];
  isPlaying: boolean;
  onScrub: (ms: number) => void;
  onSelectLayer: (id: string) => void;
  onMoveKeyframe: (layerId: string, keyframeId: string, timeMs: number) => void;
  onDeleteKeyframe: (layerId: string, keyframeId: string) => void;
  onTogglePlay: () => void;
  // LT-TIMELINE — drag the bar body / drag a trim handle. Optional so this
  // file compiles even if the host hasn't wired the reducer yet (the bars
  // simply won't be draggable until those props are passed).
  onRetimeLayer?: (layerId: string, deltaMs: number) => void;
  onTrimLayer?: (layerId: string, startMs: number | null, endMs: number | null) => void;
}

const ROW_HEIGHT = 28;
const RULER_HEIGHT = 24;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 400;
const FRAME_MS = 1000 / 30;
const HANDLE_WIDTH_PX = 6;
const BAR_MIN_WIDTH_PX = 12; // keep both handles grabbable at very small zoom

/** Discriminated drag state for the per-layer time bars. Every drag is
 *  committed once on mouse-up (matching keyframe drag's "one commit per
 *  gesture" convention). Modes:
 *  - "body": drag the whole bar -> onRetimeLayer(layerId, deltaMs)
 *  - "start": drag the left handle -> onTrimLayer(layerId, newStart, null)
 *  - "end": drag the right handle -> onTrimLayer(layerId, null, newEnd)
 *  While dragging, dragPreview holds the live preview { start, end } in
 *  scene-ms; renderers read it in place of the layer's own range so the
 *  bar follows the cursor without dispatching per pixel. */
type BarDrag =
  | { mode: "body"; layerId: string; grabOffsetMs: number; start: number; end: number }
  | { mode: "start"; layerId: string; end: number; start: number }
  | { mode: "end"; layerId: string; start: number; end: number };

export function Timeline({
  scene,
  activeAudioTrack,
  playheadMs,
  selectedLayerIds,
  isPlaying,
  onScrub,
  onSelectLayer,
  onMoveKeyframe,
  onDeleteKeyframe,
  onTogglePlay,
  onRetimeLayer,
  onTrimLayer,
}: TimelineProps) {
  const [pxPerSec, setPxPerSec] = useState(80);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragKeyframe = useRef<{ layerId: string; keyframeId: string } | null>(null);
  const [dragPreviewMs, setDragPreviewMs] = useState<number | null>(null);
  const barDrag = useRef<BarDrag | null>(null);
  const [barPreview, setBarPreview] = useState<{ start: number; end: number } | null>(null);

  function msToPx(ms: number): number {
    return (ms / 1000) * pxPerSec;
  }
  function pxToMs(px: number): number {
    // Allow negative here so a bar can be dragged before t=0 (preset
    // keyframes already start negative to animate "in" by t=0); onScrub
    // clamps to >=0 separately on its own callers.
    return (px / pxPerSec) * 1000;
  }

  function handleRulerClick(e: React.MouseEvent) {
    const rect = trackRef.current!.getBoundingClientRect();
    onScrub(Math.max(0, pxToMs(e.clientX - rect.left)));
  }

  function handleKeyframeMouseDown(e: React.MouseEvent, layerId: string, keyframeId: string) {
    e.stopPropagation();
    dragKeyframe.current = { layerId, keyframeId };
  }

  /** Begin a bar-body or bar-handle drag. `grabMs` is the cursor's scene-ms
   *  at mousedown — for body drags we remember the offset between cursor
   *  and the bar's start so the bar doesn't snap to the cursor. */
  function handleBarMouseDown(
    e: React.MouseEvent,
    layerRange: { start: number; end: number },
    mode: "body" | "start" | "end",
    layerId: string,
  ) {
    e.stopPropagation();
    const rect = trackRef.current!.getBoundingClientRect();
    const grabMs = pxToMs(e.clientX - rect.left);
    if (mode === "body") {
      barDrag.current = {
        mode: "body",
        layerId,
        grabOffsetMs: grabMs - layerRange.start,
        start: layerRange.start,
        end: layerRange.end,
      };
    } else if (mode === "start") {
      barDrag.current = { mode: "start", layerId, start: layerRange.start, end: layerRange.end };
    } else {
      barDrag.current = { mode: "end", layerId, start: layerRange.start, end: layerRange.end };
    }
    setBarPreview({ start: layerRange.start, end: layerRange.end });
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = trackRef.current!.getBoundingClientRect();
    const cursorMs = pxToMs(e.clientX - rect.left);

    if (dragKeyframe.current) {
      setDragPreviewMs(cursorMs);
      return;
    }
    const drag = barDrag.current;
    if (!drag) return;

    if (drag.mode === "body") {
      const newStart = cursorMs - drag.grabOffsetMs;
      const len = drag.end - drag.start;
      setBarPreview({ start: newStart, end: newStart + len });
    } else if (drag.mode === "start") {
      // Don't let the start handle cross the end handle.
      const newStart = Math.min(cursorMs, drag.end - (BAR_MIN_WIDTH_PX / pxPerSec) * 1000);
      setBarPreview({ start: newStart, end: drag.end });
    } else {
      const newEnd = Math.max(cursorMs, drag.start + (BAR_MIN_WIDTH_PX / pxPerSec) * 1000);
      setBarPreview({ start: drag.start, end: newEnd });
    }
  }

  function handleMouseUp() {
    if (dragKeyframe.current && dragPreviewMs !== null) {
      onMoveKeyframe(dragKeyframe.current.layerId, dragKeyframe.current.keyframeId, dragPreviewMs);
    }
    dragKeyframe.current = null;
    setDragPreviewMs(null);

    const drag = barDrag.current;
    const preview = barPreview;
    if (drag && preview) {
      if (drag.mode === "body") {
        const delta = preview.start - drag.start;
        if (delta !== 0 && onRetimeLayer) onRetimeLayer(drag.layerId, delta);
      } else if (drag.mode === "start") {
        if (preview.start !== drag.start && onTrimLayer) onTrimLayer(drag.layerId, preview.start, null);
      } else {
        if (preview.end !== drag.end && onTrimLayer) onTrimLayer(drag.layerId, null, preview.end);
      }
    }
    barDrag.current = null;
    setBarPreview(null);
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
            {activeAudioTrack && (
              <div 
                className="absolute top-0 bottom-0 pointer-events-none opacity-20 overflow-hidden z-0" 
                style={{ 
                  left: msToPx(activeAudioTrack.start_time_ms), 
                  width: msToPx(activeAudioTrack.duration_ms) 
                }}
              >
                <Waveform 
                  sourceUrl={activeAudioTrack.source_url} 
                  width={msToPx(activeAudioTrack.duration_ms)} 
                  height={scene.layers.length * ROW_HEIGHT || ROW_HEIGHT} 
                  className="w-full h-full" 
                />
                {activeAudioTrack.markers?.map(marker => (
                  <div 
                    key={marker.id}
                    className="absolute top-0 bottom-0 w-px bg-yellow-400 opacity-80"
                    style={{ left: msToPx(marker.time_ms) }}
                  >
                    <div className="absolute -top-1 -translate-x-1/2 text-[9px] text-yellow-400 font-medium bg-black/50 px-1 rounded-sm">
                      {marker.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {scene.layers.map((layer) => {
              const selected = selectedLayerIds.includes(layer.id);
              // LT-TIMELINE: per-layer scene-time visibility window. null
              // ends mean "use scene default" — materialized for rendering
              // only; the layer's own fields are untouched until a drag
              // commits a new value.
              const barStart = layer.visible_start_ms ?? 0;
              const barEnd = layer.visible_end_ms ?? scene.duration_ms;
              const dragging = barDrag.current?.layerId === layer.id && barPreview !== null;
              const renderStart = dragging ? barPreview!.start : barStart;
              const renderEnd = dragging ? barPreview!.end : barEnd;
              const barLeftPx = msToPx(renderStart);
              const barWidthPx = Math.max(
                HANDLE_WIDTH_PX * 2,
                msToPx(renderEnd) - msToPx(renderStart),
              );
              const draggable = !!(onRetimeLayer || onTrimLayer);
              return (
                <div
                  key={layer.id}
                  onClick={() => onSelectLayer(layer.id)}
                  className={`relative border-b border-border/50 cursor-pointer ${
                    selected ? "bg-accent-dim/30" : "hover:bg-surface-hover/50"
                  }`}
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[11px] text-text-muted truncate max-w-[140px] pointer-events-none z-10">
                    {layer.name}
                  </span>

                  {/* Per-layer time bar. Sits behind the keyframes (no z)
                      so diamonds remain visible/interactive on top. Body
                      drag moves both ends; left/right handles trim. */}
                  {draggable && (
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-4 rounded-sm ${
                        selected ? "bg-accent/40" : "bg-text-faint/25"
                      } group`}
                      style={{ left: barLeftPx, width: barWidthPx }}
                      onMouseDown={(e) =>
                        handleBarMouseDown(e, { start: barStart, end: barEnd }, "body", layer.id)
                      }
                    >
                      {/* Left (start) handle */}
                      <div
                        className="absolute top-0 bottom-0 left-0 w-1.5 bg-accent/70 rounded-l-sm cursor-ew-resize opacity-0 group-hover:opacity-100"
                        onMouseDown={(e) =>
                          handleBarMouseDown(e, { start: barStart, end: barEnd }, "start", layer.id)
                        }
                        title={`Start @ ${(renderStart / 1000).toFixed(2)}s`}
                      />
                      {/* Right (end) handle */}
                      <div
                        className="absolute top-0 bottom-0 right-0 w-1.5 bg-accent/70 rounded-r-sm cursor-ew-resize opacity-0 group-hover:opacity-100"
                        onMouseDown={(e) =>
                          handleBarMouseDown(e, { start: barStart, end: barEnd }, "end", layer.id)
                        }
                        title={`End @ ${(renderEnd / 1000).toFixed(2)}s`}
                      />
                    </div>
                  )}

                  {layer.keyframes.map((kf) => {
                    const kfDragging = dragKeyframe.current?.keyframeId === kf.id;
                    const ms = kfDragging && dragPreviewMs !== null ? dragPreviewMs : kf.time_ms;
                    // Dim keyframes that fall outside the layer's visible
                    // window — they're rendered inactive (the layer isn't
                    // drawn there) but remain editable.
                    const inRange = ms >= renderStart && ms < renderEnd;
                    return (
                      <div
                        key={kf.id}
                        title={`${kf.property} = ${kf.value} @ ${(ms / 1000).toFixed(2)}s (${kf.easing})`}
                        onMouseDown={(e) => handleKeyframeMouseDown(e, layer.id, kf.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onDeleteKeyframe(layer.id, kf.id);
                        }}
                        className={`absolute top-1/2 w-2.5 h-2.5 -mt-[5px] -ml-[5px] bg-accent rotate-45 border border-white/40 cursor-ew-resize z-10 ${
                          inRange ? "" : "opacity-30"
                        }`}
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
