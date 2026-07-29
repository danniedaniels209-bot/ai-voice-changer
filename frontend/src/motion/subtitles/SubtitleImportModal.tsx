/**
 * Subtitle import dialog: pick a .srt/.vtt file, pick a style preset ONCE,
 * see what will actually be generated, import.
 *
 * This component owns no editor state — it hands a finished MotionLayer[]
 * to `onInsertLayers`, which is MotionEditor's existing handler that
 * dispatches a single ADD_LAYERS. That is deliberate: ADD_LAYERS already
 * takes one undo snapshot for a whole batch, so a 60-caption import is ONE
 * Ctrl+Z, and no new reducer action was needed.
 *
 * The preview is not decorative. It shows the first few captions with their
 * real computed timings and their real wrapped line breaks (from the same
 * wrapTextToLines the renderers use), plus every parser warning and every
 * downgrade note, so the user sees what will land BEFORE it lands.
 */

import { useMemo, useRef, useState } from "react";
import { X, Captions, Upload, AlertTriangle } from "lucide-react";
import type { MotionLayer } from "../../types/motion";
import type { SubtitleCue } from "../../types/subtitle";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, getPreset } from "../../subtitle/presets";
import { parseSubtitles } from "./subtitleParse";
import { subtitleCuesToLayers } from "./subtitleLayers";

export interface SubtitleImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  sceneWidth: number;
  sceneHeight: number;
  sceneDurationMs: number;
  /** MotionEditor's existing handleInsertLayers — one ADD_LAYERS dispatch. */
  onInsertLayers: (layers: MotionLayer[]) => void;
}

function fmt(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function SubtitleImportModal({
  isOpen,
  onClose,
  sceneWidth,
  sceneHeight,
  sceneDurationMs,
  onInsertLayers,
}: SubtitleImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [offsetMs, setOffsetMs] = useState(0);
  const [includeBackground, setIncludeBackground] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);

  const style = getPreset(presetId);

  // Recomputed on every knob change, so the counts and the preview below are
  // always the layers the button would actually insert — never a stale
  // description of a previous setting.
  const result = useMemo(
    () =>
      subtitleCuesToLayers(cues, {
        style,
        sceneWidth,
        sceneHeight,
        sceneDurationMs,
        offsetMs,
        includeBackground,
      }),
    [cues, style, sceneWidth, sceneHeight, sceneDurationMs, offsetMs, includeBackground],
  );

  if (!isOpen) return null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setReadError(null);
    try {
      const text = await file.text();
      const parsed = parseSubtitles(text);
      setFileName(file.name);
      setCues(parsed.cues);
      setWarnings(parsed.warnings);
      if (parsed.cues.length === 0 && parsed.warnings.length === 0) {
        setReadError("No cues found in that file.");
      }
    } catch (err) {
      setReadError(String(err));
    }
  }

  function handleImport() {
    if (result.layers.length === 0) return;
    onInsertLayers(result.layers);
    onClose();
  }

  const captionCount = result.layers.filter((l) => l.type === "text").length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-semibold text-base text-text">
            <Captions size={18} className="text-accent" />
            <span>Import subtitles</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* ── File ── */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".srt,.vtt,text/plain"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                // Reset so re-picking the same file after an edit re-reads it.
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-border hover:border-accent hover:bg-surface-hover text-sm text-text-muted hover:text-text"
            >
              <Upload size={16} />
              {fileName ? `${fileName} — choose a different file` : "Choose a .srt or .vtt file"}
            </button>
            {readError && <p className="mt-2 text-xs text-red-400">{readError}</p>}
          </div>

          {/* ── Style preset: picked once, applied to every caption ── */}
          <div>
            <div className="text-xs font-medium text-text-muted mb-2">Caption style</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BUILTIN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  className={`px-3 py-2 rounded-lg border text-left ${
                    p.id === presetId
                      ? "border-accent bg-accent/10 text-text"
                      : "border-border hover:bg-surface-hover text-text-muted"
                  }`}
                >
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-[10px] opacity-70">
                    {p.word_mode === "word" ? "one word at a time" : "whole line"}
                    {p.background.shape === "box" ? " · band" : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Options ── */}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-text-muted">
              Time offset
              <input
                type="number"
                step={50}
                value={offsetMs}
                onChange={(e) => setOffsetMs(Number(e.target.value) || 0)}
                className="w-24 px-2 py-1 rounded-md bg-surface-hover border border-border text-text text-xs"
              />
              ms
            </label>
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={includeBackground}
                onChange={(e) => setIncludeBackground(e.target.checked)}
              />
              Background band (when the style has one)
            </label>
          </div>

          {/* ── Warnings and honest notes ── */}
          {(warnings.length > 0 || result.notes.length > 0) && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
              {[...warnings, ...result.notes].map((w, i) => (
                <div key={i} className="flex gap-2 text-xs text-amber-300/90">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Preview of what will actually be inserted ── */}
          {cues.length > 0 && (
            <div>
              <div className="text-xs font-medium text-text-muted mb-2">
                {captionCount} caption{captionCount === 1 ? "" : "s"} → {result.layers.length} layer
                {result.layers.length === 1 ? "" : "s"} (one undo step)
              </div>
              <div className="rounded-lg border border-border divide-y divide-border max-h-52 overflow-y-auto">
                {result.layers
                  .filter((l) => l.type === "text")
                  .slice(0, 12)
                  .map((l) => (
                    <div key={l.id} className="px-3 py-2 flex gap-3 text-xs">
                      <span className="font-mono text-text-faint shrink-0">
                        {fmt((l.visible_start_ms ?? 0) / 1000)} → {fmt((l.visible_end_ms ?? 0) / 1000)}
                      </span>
                      <span className="text-text whitespace-pre-wrap">{l.text?.text}</span>
                    </div>
                  ))}
                {captionCount > 12 && (
                  <div className="px-3 py-2 text-xs text-text-faint">…and {captionCount - 12} more</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={result.layers.length === 0}
            onClick={handleImport}
            className="px-4 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90 disabled:opacity-30"
          >
            Add {captionCount} caption{captionCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
