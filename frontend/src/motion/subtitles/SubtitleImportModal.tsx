/**
 * Subtitle import dialog: pick a .srt/.vtt file OR auto-generate captions
 * from a voiceover audio track via Whisper STT, pick a style preset ONCE,
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

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Captions, Upload, AlertTriangle, Sparkles, Loader2, Mic } from "lucide-react";
import type { AudioTrack, MotionLayer } from "../../types/motion";
import type { SubtitleCue } from "../../types/subtitle";
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, getPreset } from "../../subtitle/presets";
import { parseSubtitles } from "./subtitleParse";
import { subtitleCuesToLayers } from "./subtitleLayers";
import {
  cancelTranscriptionTask,
  getTranscriptionStatus,
  startAudioTrackTranscription,
} from "../../api/motion";

export interface SubtitleImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  audioTracks?: AudioTrack[];
  sceneWidth: number;
  sceneHeight: number;
  sceneDurationMs: number;
  /** MotionEditor's existing handleInsertLayers — one ADD_LAYERS dispatch. */
  onInsertLayers: (layers: MotionLayer[]) => void;
}

const OVERLAY_CLASS =
  "fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4";

function fmt(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function SubtitleImportModal({
  isOpen,
  onClose,
  projectId,
  audioTracks = [],
  sceneWidth,
  sceneHeight,
  sceneDurationMs,
  onInsertLayers,
}: SubtitleImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "auto">("file");
  const [fileName, setFileName] = useState<string | null>(null);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [offsetMs, setOffsetMs] = useState(0);
  const [includeBackground, setIncludeBackground] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);

  // Auto-caption state
  const voiceoverTracks = useMemo(
    () => audioTracks.filter((t) => t.kind === "voiceover" || !t.kind),
    [audioTracks],
  );
  const availableTracks = audioTracks.length > 0 ? audioTracks : [];
  const [selectedTrackId, setSelectedTrackId] = useState<string>("");

  useEffect(() => {
    if (audioTracks.length > 0 && !selectedTrackId) {
      const preferred = voiceoverTracks[0] || audioTracks[0];
      setSelectedTrackId(preferred.id);
    }
  }, [audioTracks, voiceoverTracks, selectedTrackId]);

  const [transcribing, setTranscribing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  // LT-CAPTIONEDIT: inline editing of cue text before import
  const [editingCueIndex, setEditingCueIndex] = useState<number | null>(null);

  const style = getPreset(presetId);

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

  // Polling loop for background transcription task
  useEffect(() => {
    if (!taskId || !transcribing) return;

    const interval = setInterval(async () => {
      try {
        const st = await getTranscriptionStatus(taskId);
        setTranscribeProgress(st.progress);
        if (st.done) {
          clearInterval(interval);
          setTranscribing(false);
          setTaskId(null);
          if (st.status === "done") {
            setCues(st.cues || []);
            const trackObj = audioTracks.find((t) => t.id === st.track_id);
            setFileName(`Auto-captions (${trackObj?.name || "Voiceover"})`);
            setWarnings([]);
            setTranscribeError(null);
          } else if (st.status === "failed") {
            setTranscribeError(st.error || "Transcription failed.");
          } else if (st.status === "cancelled") {
            setTranscribeError("Transcription was cancelled.");
          }
        }
      } catch (err) {
        clearInterval(interval);
        setTranscribing(false);
        setTaskId(null);
        setTranscribeError(String(err));
      }
    }, 500);

    return () => clearInterval(interval);
  }, [taskId, transcribing, audioTracks]);

  const lowConfidenceWords = useMemo(() => {
    const list: Array<{ word: string; confidence: number }> = [];
    for (const cue of cues) {
      if (cue.words) {
        for (const w of cue.words) {
          if (w.confidence !== undefined && w.confidence < 0.7) {
            list.push({ word: w.text, confidence: w.confidence });
          }
        }
      }
    }
    return list;
  }, [cues]);

  const confidenceWarnings = useMemo(() => {
    if (lowConfidenceWords.length === 0) return [];
    const names = lowConfidenceWords
      .slice(0, 5)
      .map((w) => `"${w.word}" (${Math.round(w.confidence * 100)}%)`)
      .join(", ");
    const extra = lowConfidenceWords.length > 5 ? ` and ${lowConfidenceWords.length - 5} more` : "";
    return [
      `${lowConfidenceWords.length} word(s) have low transcription confidence (<70%): ${names}${extra}. Please review these in the generated captions.`,
    ];
  }, [lowConfidenceWords]);

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

  async function handleStartAutoCaption() {
    if (!projectId || !selectedTrackId) {
      setTranscribeError("Missing project ID or audio track selection.");
      return;
    }
    setTranscribeError(null);
    setTranscribeProgress(0);
    setTranscribing(true);
    try {
      const res = await startAudioTrackTranscription(projectId, selectedTrackId);
      setTaskId(res.task_id);
    } catch (err) {
      setTranscribing(false);
      setTranscribeError(String(err));
    }
  }

  async function handleCancelTranscribe() {
    if (taskId) {
      try {
        await cancelTranscriptionTask(taskId);
      } catch {
        // ignore cancellation error
      }
    }
    setTranscribing(false);
    setTaskId(null);
    setTranscribeError("Transcription cancelled.");
  }

  function handleImport() {
    if (result.layers.length === 0) return;
    onInsertLayers(result.layers);
    onClose();
  }

  /** LT-CAPTIONEDIT: update a cue's text inline before importing. */
  function handleCueTextEdit(index: number, newText: string) {
    const trimmed = newText.trim();
    if (!trimmed || trimmed === cues[index].text) return;
    setCues((prev) =>
      prev.map((c, i) => (i === index ? { ...c, text: trimmed } : c)),
    );
  }

  const captionCount = result.layers.filter((l) => l.type === "text").length;

  return (
    <div className={OVERLAY_CLASS} onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-semibold text-base text-text">
            <Captions size={18} className="text-accent" />
            <span>Subtitles & Captions</span>
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
          {/* Mode Switcher */}
          <div className="flex border-b border-border gap-6 pb-2">
            <button
              type="button"
              onClick={() => setMode("file")}
              className={`flex items-center gap-2 text-xs font-medium pb-1.5 border-b-2 transition-colors ${
                mode === "file"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              <Upload size={14} />
              Import .SRT / .VTT
            </button>
            <button
              type="button"
              onClick={() => setMode("auto")}
              className={`flex items-center gap-2 text-xs font-medium pb-1.5 border-b-2 transition-colors ${
                mode === "auto"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              <Sparkles size={14} />
              Auto-Caption Voiceover
            </button>
          </div>

          {/* ── Source selection ── */}
          {mode === "file" ? (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".srt,.vtt,text/plain"
                className="hidden"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
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
          ) : (
            <div className="space-y-3">
              {availableTracks.length === 0 ? (
                <div className="p-4 rounded-lg border border-border bg-surface-hover text-xs text-text-muted flex items-center gap-2">
                  <Mic size={16} className="text-accent shrink-0" />
                  <span>No audio tracks found in this scene. Add a voiceover track first to use auto-captioning.</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-text-muted">Select Audio Track</label>
                    <select
                      value={selectedTrackId}
                      onChange={(e) => setSelectedTrackId(e.target.value)}
                      disabled={transcribing}
                      className="px-3 py-2 rounded-lg bg-surface-hover border border-border text-text text-xs focus:outline-none focus:border-accent"
                    >
                      {availableTracks.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.name} {track.kind ? `(${track.kind})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {transcribing ? (
                    <div className="p-4 rounded-lg border border-accent/30 bg-accent/5 space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium text-text">
                        <div className="flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-accent" />
                          <span>Transcribing speech with Whisper STT...</span>
                        </div>
                        <span>{Math.round(transcribeProgress)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-surface-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all duration-300"
                          style={{ width: `${Math.max(5, transcribeProgress)}%` }}
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleCancelTranscribe}
                          className="text-xs text-red-400 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartAutoCaption}
                      disabled={!selectedTrackId || !projectId}
                      className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg font-medium text-xs bg-accent text-white hover:opacity-90 disabled:opacity-40"
                    >
                      <Sparkles size={14} />
                      Generate Captions from Voiceover
                    </button>
                  )}

                  {transcribeError && <p className="text-xs text-red-400">{transcribeError}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── Style preset ── */}
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
          {(warnings.length > 0 || result.notes.length > 0 || confidenceWarnings.length > 0) && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
              {[...warnings, ...confidenceWarnings, ...result.notes].map((w, i) => (
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
                {cues.length > 0 && (
                  <span className="ml-2 text-text-faint font-normal">· click text to edit</span>
                )}
              </div>
              <div className="rounded-lg border border-border divide-y divide-border max-h-52 overflow-y-auto">
                {cues.slice(0, 30).map((cue, idx) => {
                  const hasLowConf =
                    cue.words &&
                    cue.words.some((w) => w.confidence !== undefined && w.confidence < 0.7);
                  const isEditing = editingCueIndex === idx;
                  return (
                    <div key={cue.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                      <div className="flex gap-3 items-center flex-1 min-w-0">
                        <span className="font-mono text-text-faint shrink-0">
                          {fmt(cue.start)} → {fmt(cue.end)}
                        </span>
                        {isEditing ? (
                          <input
                            autoFocus
                            defaultValue={cue.text}
                            onBlur={(e) => {
                              handleCueTextEdit(idx, e.target.value);
                              setEditingCueIndex(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") {
                                (e.target as HTMLInputElement).value = cue.text;
                                setEditingCueIndex(null);
                              }
                            }}
                            className="flex-1 min-w-0 px-1.5 py-0.5 rounded bg-surface-hover border border-accent text-text text-xs focus:outline-none"
                          />
                        ) : (
                          <span
                            className="text-text whitespace-pre-wrap cursor-pointer hover:bg-surface-hover hover:rounded px-1 -mx-1 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCueIndex(idx);
                            }}
                            title="Click to edit"
                          >
                            {cue.text}
                          </span>
                        )}
                      </div>
                      {hasLowConf && (
                        <span
                          title="Contains word(s) with low STT confidence (<70%)"
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 shrink-0"
                        >
                          Check text
                        </span>
                      )}
                    </div>
                  );
                })}
                {cues.length > 30 && (
                  <div className="px-3 py-2 text-xs text-text-faint">…and {cues.length - 30} more</div>
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
