/**
 * Keyframe timeline: a time ruler + playhead + one row per layer showing
 * all of that layer's keyframes (merged across properties into one row —
 * per-property sub-tracks are a later refinement, not needed to prove the
 * animation engine end-to-end). Dragging a keyframe diamond updates a
 * local preview and commits once on mouse-up, same reasoning as the
 * canvas's move/resize drags: one commit per gesture, not one per pixel.
 */

import { useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, ZoomIn, ZoomOut, ChevronDown, Link, Link2Off, Activity } from "lucide-react";
import type { MotionScene, AudioTrack, SceneMarker, Keyframe } from "../types/motion";
import { Waveform } from "./audio/WaveformCanvas";
import { findSnap } from "./timeline/snapping";
import { scrubAudioAt } from "./audio/scrubAudio";
import { DRAG_MIME as ASSET_DRAG_MIME } from "./assets/AssetDock";
import { GraphEditor } from "./charts/GraphEditor";

interface TimelineProps {
  /** Optional — collapse the timeline to a header bar. Optional so the
   *  component still works anywhere it isn't collapsible. */
  onCollapse?: () => void;
  scene: MotionScene;
  activeAudioTrack?: AudioTrack;
  playheadMs: number;
  selectedLayerIds: string[];
  isPlaying: boolean;
  onScrub: (ms: number) => void;
  onSelectLayer: (id: string) => void;
  onMoveKeyframe: (layerId: string, keyframeId: string, timeMs: number) => void;
  onUpdateKeyframe?: (layerId: string, keyframeId: string, patch: Partial<Keyframe>) => void;
  onDeleteKeyframe: (layerId: string, keyframeId: string) => void;
  onTogglePlay: () => void;
  /** LT-RIPPLE — when true, delete/end-trim ripple everything after. */
  rippleMode?: boolean;
  onToggleRipple?: () => void;
  // LT-KEYFRAMEUI — select a keyframe to edit its easing in the Inspector.
  // Called on click (not drag) so the Inspector can show the easing dropdown.
  onSelectKeyframe?: (layerId: string, keyframeId: string) => void;
  // LT-TIMELINE — drag the bar body / drag a trim handle. Optional so this
  // file compiles even if the host hasn't wired the reducer yet (the bars
  // simply won't be draggable until those props are passed).
  onRetimeLayer?: (layerId: string, deltaMs: number) => void;
  onTrimLayer?: (layerId: string, startMs: number | null, endMs: number | null) => void;
  onAddSceneMarker?: (timeMs: number) => void;
  /** Drop an imported asset onto the timeline at `timeMs`. The dock hands
   *  over the raw JSON payload; the editor decides what layer/track it
   *  becomes, since only it knows about the reducer. */
  onDropAsset?: (payloadJson: string, timeMs: number) => void;
  onUpdateSceneMarker?: (markerId: string, patch: Partial<SceneMarker>) => void;
  onDeleteSceneMarker?: (markerId: string) => void;
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
  onUpdateKeyframe,
  onTogglePlay,
  onRetimeLayer,
  onTrimLayer,
  rippleMode,
  onToggleRipple,
  onSelectKeyframe,
  onAddSceneMarker,
  onDropAsset,
  onUpdateSceneMarker,
  onDeleteSceneMarker,
  onCollapse,
}: TimelineProps) {
  const [pxPerSec, setPxPerSec] = useState(80);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragKeyframe = useRef<{ layerId: string; keyframeId: string } | null>(null);
  const [dragPreviewMs, setDragPreviewMs] = useState<number | null>(null);
  const dragMarker = useRef<string | null>(null);
  const [dragMarkerPreviewMs, setDragMarkerPreviewMs] = useState<number | null>(null);
  const barDrag = useRef<BarDrag | null>(null);
  const [barPreview, setBarPreview] = useState<{ start: number; end: number } | null>(null);
  const [snapLineMs, setSnapLineMs] = useState<number | null>(null);
  /** Preview position while an asset is dragged over the timeline. */
  const [dropTargetMs, setDropTargetMs] = useState<number | null>(null);
  const [graphMode, setGraphMode] = useState(false);

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
    // Same reasoning as the disabled transport: scrubbing an empty scene
    // moves a playhead across nothing. Gating only the buttons would leave
    // the ruler as a way around them.
    if (isEmpty) return;
    const rect = trackRef.current!.getBoundingClientRect();
    const ms = Math.max(0, pxToMs(e.clientX - rect.left));
    onScrub(ms);
    // LT-AUDIOSCRUB — play a short grain of the active track at the new
    // position so the playhead can be placed by ear. scrubAudioAt is
    // internally rate-limited and stops its previous grain, so calling it
    // on every scrub event is safe and needs no throttling here.
    //
    // Offset is into the TRACK, not the scene: a track placed at
    // start_time_ms=2000 is at its own 0s when the playhead reads 2000.
    if (activeAudioTrack?.source_url) {
      const trackMs = ms - (activeAudioTrack.start_time_ms ?? 0);
      if (trackMs >= 0) scrubAudioAt(activeAudioTrack.source_url, trackMs / 1000);
    }
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
    const snapTargets = e.altKey ? [] : buildSnapTargets();

    if (dragKeyframe.current) {
      const snapped = findSnap(cursorMs, snapTargets, pxPerSec);
      setDragPreviewMs(snapped ?? cursorMs);
      setSnapLineMs(snapped);
      return;
    }
    if (dragMarker.current) {
      const snapped = findSnap(cursorMs, snapTargets, pxPerSec);
      setDragMarkerPreviewMs(snapped ?? cursorMs);
      setSnapLineMs(snapped);
      return;
    }
    const drag = barDrag.current;
    if (!drag) return;

    if (drag.mode === "body") {
      const rawStart = cursorMs - drag.grabOffsetMs;
      const len = drag.end - drag.start;
      const snapped = findSnap(rawStart, snapTargets, pxPerSec);
      const newStart = snapped ?? rawStart;
      setBarPreview({ start: newStart, end: newStart + len });
      setSnapLineMs(snapped);
    } else if (drag.mode === "start") {
      const raw = Math.min(cursorMs, drag.end - (BAR_MIN_WIDTH_PX / pxPerSec) * 1000);
      const snapped = findSnap(raw, snapTargets, pxPerSec);
      const newStart = snapped ?? raw;
      setBarPreview({ start: newStart, end: drag.end });
      setSnapLineMs(snapped);
    } else {
      const raw = Math.max(cursorMs, drag.start + (BAR_MIN_WIDTH_PX / pxPerSec) * 1000);
      const snapped = findSnap(raw, snapTargets, pxPerSec);
      const newEnd = snapped ?? raw;
      setBarPreview({ start: drag.start, end: newEnd });
      setSnapLineMs(snapped);
    }
  }

  function handleMouseUp() {
    if (dragKeyframe.current && dragPreviewMs !== null) {
      onMoveKeyframe(dragKeyframe.current.layerId, dragKeyframe.current.keyframeId, dragPreviewMs);
    }
    dragKeyframe.current = null;
    setDragPreviewMs(null);

    if (dragMarker.current && dragMarkerPreviewMs !== null && onUpdateSceneMarker) {
      onUpdateSceneMarker(dragMarker.current, { time_ms: Math.round(dragMarkerPreviewMs) });
    }
    dragMarker.current = null;
    setDragMarkerPreviewMs(null);

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
    setSnapLineMs(null);
  }

  const durationSec = scene.duration_ms / 1000;
  const width = Math.max(600, msToPx(scene.duration_ms) + 40);
  const secondMarks = Array.from({ length: Math.ceil(durationSec) + 1 }, (_, i) => i);

  // An empty scene has nothing to play. Offering a working transport there
  // means the playhead sweeps five seconds of blank canvas, which reads as
  // the app playing something that doesn't exist. Audio counts as content —
  // a voiceover-only scene is legitimate and should be playable.
  const isEmpty = scene.layers.length === 0 && scene.audio_tracks.length === 0;

  const buildSnapTargets = useCallback((): number[] => {
    const targets: number[] = [0, scene.duration_ms, playheadMs];
    for (const l of scene.layers) {
      targets.push(l.visible_start_ms ?? 0);
      targets.push(l.visible_end_ms ?? scene.duration_ms);
    }
    if (scene.markers) {
      for (const m of scene.markers) targets.push(m.time_ms);
    }
    if (activeAudioTrack?.markers) {
      for (const m of activeAudioTrack.markers) targets.push(m.time_ms);
    }
    return targets;
  }, [scene, playheadMs, activeAudioTrack]);

  return (
    <div className="flex flex-col h-full">
      <div className="h-9 shrink-0 border-b border-border flex items-center gap-1 px-2">
        <button
          type="button"
          title={isEmpty ? "Nothing to play yet — add a layer first" : "Previous frame"}
          disabled={isEmpty}
          onClick={() => onScrub(Math.max(0, playheadMs - FRAME_MS))}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text
                     disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          title={isEmpty ? "Nothing to play yet — add a layer first" : isPlaying ? "Pause" : "Play"}
          disabled={isEmpty}
          onClick={onTogglePlay}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text
                     disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          title={isEmpty ? "Nothing to play yet — add a layer first" : "Next frame"}
          disabled={isEmpty}
          onClick={() => onScrub(Math.min(scene.duration_ms, playheadMs + FRAME_MS))}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text
                     disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <SkipForward size={14} />
        </button>
        {isEmpty ? (
          <span className="text-xs text-text-faint px-2">
            Add a layer to start building — the timeline activates then.
          </span>
        ) : (
          <span className="text-xs text-text-faint tabular-nums px-2">
            {(playheadMs / 1000).toFixed(2)}s / {(scene.duration_ms / 1000).toFixed(2)}s
          </span>
        )}
        <div className="flex-1" />
        {onToggleRipple && (
          <button
            type="button"
            title={rippleMode ? "Ripple on: delete/trim shifts everything after" : "Ripple off: delete/trim leaves a hole"}
            onClick={onToggleRipple}
            className={`p-1 rounded hover:bg-surface-hover ${rippleMode ? "text-accent" : "text-text-faint"}`}
          >
            {rippleMode ? <Link size={14} /> : <Link2Off size={14} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => setGraphMode(m => !m)}
          title={graphMode ? "Exit Graph Editor" : "Graph Editor (View Animation Curves)"}
          className={`p-1 rounded hover:bg-surface-hover ${graphMode ? "text-accent" : "text-text-muted hover:text-text"}`}
        >
          <Activity size={14} />
        </button>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse timeline"
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text"
          >
            <ChevronDown size={14} />
          </button>
        )}
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

      <div
        className={`flex-1 overflow-auto ${dropTargetMs !== null ? "bg-accent-dim/10" : ""}`}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        // Asset drop (LT-MEDIADOCK). Only reacts to the dock's private MIME
        // type, so dragging a layer bar around the timeline — or a file from
        // the desktop — doesn't get mistaken for an asset drop.
        onDragOver={(e) => {
          if (!onDropAsset || !e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const rect = trackRef.current?.getBoundingClientRect();
          if (rect) setDropTargetMs(Math.max(0, pxToMs(e.clientX - rect.left)));
        }}
        onDragLeave={() => setDropTargetMs(null)}
        onDrop={(e) => {
          if (!onDropAsset || !e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
          e.preventDefault();
          const rect = trackRef.current?.getBoundingClientRect();
          const ms = rect ? Math.max(0, pxToMs(e.clientX - rect.left)) : 0;
          setDropTargetMs(null);
          onDropAsset(e.dataTransfer.getData(ASSET_DRAG_MIME), ms);
        }}
      >
        <div style={{ width, position: "relative" }}>
          {/* Where the clip will land. Dropping media with no indicator means
              guessing, then undoing — the whole point of dropping at a
              position is seeing the position first. */}
          {dropTargetMs !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-30"
              style={{ left: msToPx(dropTargetMs) }}
            >
              <div className="absolute -top-0.5 -left-1 w-2.5 h-2.5 rounded-full bg-accent" />
            </div>
          )}
          {/* Ruler */}
          <div
            ref={trackRef}
            className="relative border-b border-border cursor-pointer select-none"
            style={{ height: RULER_HEIGHT }}
            onClick={handleRulerClick}
            onDoubleClick={(e) => {
              const rect = trackRef.current!.getBoundingClientRect();
              if (onAddSceneMarker) onAddSceneMarker(Math.max(0, pxToMs(e.clientX - rect.left)));
            }}
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
              <div className="absolute top-0 -left-1.5 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-accent" />
            </div>

            {(scene.markers || []).map((m) => {
              const dragging = dragMarker.current === m.id;
              const time = dragging && dragMarkerPreviewMs !== null ? dragMarkerPreviewMs : m.time_ms;
              return (
                <div
                  key={m.id}
                  className="absolute top-0 bottom-0 flex flex-col items-center group/marker z-20"
                  style={{ left: msToPx(time), transform: "translateX(-50%)" }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    dragMarker.current = m.id;
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const newName = prompt("Rename marker (empty to delete):", m.label);
                    if (newName) {
                      if (onUpdateSceneMarker) onUpdateSceneMarker(m.id, { label: newName });
                    } else if (newName === "") {
                      if (onDeleteSceneMarker) onDeleteSceneMarker(m.id);
                    }
                  }}
                  title={m.label}
                >
                  <div 
                    className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent cursor-ew-resize opacity-80 hover:opacity-100" 
                    style={{ borderTopColor: m.color || "#3B82F6" }} 
                  />
                  <div className="text-[10px] whitespace-nowrap bg-background/90 px-1 border border-border rounded text-text font-medium mt-0.5 opacity-0 group-hover/marker:opacity-100 pointer-events-none">
                    {m.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Layer rows */}
          <div className="relative">
            {/* Snap guide line — shown while the user drags near a snap target */}
            {snapLineMs !== null && (
              <div
                className="absolute top-0 w-px bg-yellow-400/80 pointer-events-none z-20"
                style={{ left: msToPx(snapLineMs), height: scene.layers.length * ROW_HEIGHT || ROW_HEIGHT }}
              />
            )}
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
            
            
            {graphMode ? (
              selectedLayerIds.length > 0 ? (
                <GraphEditor
                  layer={scene.layers.find(l => l.id === selectedLayerIds[0])!}
                  pxPerSec={pxPerSec}
                  durationMs={scene.duration_ms}
                  onUpdateKeyframe={onUpdateKeyframe || (() => {})}
                  onSelectKeyframe={onSelectKeyframe}
                />
              ) : (
                <div className="text-xs text-text-faint text-center py-6">
                  Select a layer to view its animation curves.
                </div>
              )
            ) : (
              scene.layers.map((layer) => {
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
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectKeyframe?.(layer.id, kf.id);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            onDeleteKeyframe(layer.id, kf.id);
                          }}
                          className={`absolute top-1/2 w-2.5 h-2.5 -mt-[5px] -ml-[5px] bg-accent rotate-45 border border-white/40 cursor-ew-resize z-10 ${
                            inRange ? "" : "opacity-30"
                          }`}
                          style={{ left: msToPx(ms) }}
                        >
                          {/* LT-KEYFRAMEUI — small easing indicator dot. Color-coded by
                              easing family so a user scanning the track can tell linear
                              from bounce/elastic/spring at a glance. */}
                          <div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                            style={{ transform: "rotate(-45deg)" }}
                          >
                            <span
                              className={`w-1 h-1 rounded-full ${
                                kf.easing === "linear" ? "bg-white/60" :
                                kf.easing.startsWith("ease") ? "bg-blue-400" :
                                kf.easing === "bounce" ? "bg-yellow-400" :
                                kf.easing === "elastic" ? "bg-pink-400" :
                                kf.easing === "spring" ? "bg-green-400" :
                                kf.easing === "overshoot" ? "bg-orange-400" :
                                "bg-white/40"
                              }`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
            {!graphMode && scene.layers.length === 0 && (
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
