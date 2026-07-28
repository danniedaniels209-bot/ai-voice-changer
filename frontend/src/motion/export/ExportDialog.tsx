import { useEffect, useRef, useState } from "react";
import { X, Film, Download, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  exportMotionProject,
  getMotionExportStatus,
  cancelMotionExport,
  type MotionExportTaskStatus,
  type MotionExportFormat,
} from "../../api/motion";

import type { MotionProject } from "../../types/motion";

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: MotionProject;
  activeSceneId: string;
}

interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  badge?: string;
}

const PRESETS: ResolutionPreset[] = [
  { id: "1080p", label: "1080p Full HD (1920 × 1080)", width: 1920, height: 1080, badge: "Default" },
  { id: "1440p", label: "1440p QHD (2560 × 1440)", width: 2560, height: 1440 },
  { id: "4k", label: "4K UHD (3840 × 2160)", width: 3840, height: 2160, badge: "Slow" },
  { id: "720p", label: "720p HD (1280 × 720)", width: 1280, height: 720 },
  { id: "vertical", label: "Vertical Shorts/Reels (1080 × 1920)", width: 1080, height: 1920 },
  { id: "square", label: "Square Post (1080 × 1080)", width: 1080, height: 1080 },
];

interface FormatOption {
  id: MotionExportFormat;
  label: string;
  hint: string;
  /** Whether this container can actually carry an alpha channel. */
  supportsAlpha: boolean;
}

const FORMATS: FormatOption[] = [
  { id: "mp4", label: "MP4 video", hint: "Best for sharing and upload", supportsAlpha: false },
  {
    id: "mov",
    label: "MOV (ProRes)",
    hint: "For editing software. Large files, and the only format here that carries real transparency in video.",
    supportsAlpha: true,
  },
  { id: "gif", label: "Animated GIF", hint: "Looping, no audio, large files", supportsAlpha: true },
  {
    id: "png_sequence",
    label: "PNG sequence (.zip)",
    hint: "One image per frame, for compositing elsewhere",
    supportsAlpha: true,
  },
];

/** Quality tiers rather than raw CRF numbers — "18" means nothing to most
 *  people, and lower-is-better is counter-intuitive. The default maps to the
 *  backend's existing CRF 18 so an unchanged dialog produces a byte-identical
 *  export to before this control existed. */
const QUALITY_OPTIONS = [
  { id: "high", label: "High (visually lossless)", crf: "18", badge: "Default" },
  { id: "balanced", label: "Balanced (smaller file)", crf: "23" },
  { id: "small", label: "Small (noticeable compression)", crf: "28" },
];

const FPS_OPTIONS = [
  { value: 30, label: "30 FPS (Standard)" },
  { value: 24, label: "24 FPS (Film)" },
  { value: 60, label: "60 FPS (High Motion)" },
];

export function ExportDialog({ isOpen, onClose, project, activeSceneId }: ExportDialogProps) {
  const sceneCount = project.scenes.length;
  const [selectedPresetId, setSelectedPresetId] = useState<string>("1080p");
  const [fps, setFps] = useState<number>(30);
  const [format, setFormat] = useState<MotionExportFormat>("mp4");
  const [transparent, setTransparent] = useState<boolean>(false);
  const [allScenes, setAllScenes] = useState<boolean>(false);
  const [qualityId, setQualityId] = useState<string>("high");

  const [status, setStatus] = useState<"idle" | "exporting" | "completed" | "error">("idle");
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The running task's id, so it can be cancelled. Null when nothing is
  // in flight.
  const [taskId, setTaskId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  // Reset state when opening/closing dialog
  useEffect(() => {
    if (!isOpen) {
      clearPolling();
      setStatus("idle");
      setProgress(0);
      setStatusMessage("");
      setDownloadPath(null);
      setErrorMessage(null);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => clearPolling();
  }, []);

  if (!isOpen) return null;

  const currentPreset = PRESETS.find((p) => p.id === selectedPresetId) || PRESETS[0];
  const currentFormat = FORMATS.find((f) => f.id === format) || FORMATS[0];
  const currentQuality = QUALITY_OPTIONS.find((q) => q.id === qualityId) || QUALITY_OPTIONS[0];

  async function handleStartExport() {
    setStatus("exporting");
    setProgress(0);
    setStatusMessage("Initializing export task...");
    setErrorMessage(null);

    try {
      const res = await exportMotionProject(project.id, {
        scene_id: activeSceneId,
        fps,
        width: currentPreset.width,
        height: currentPreset.height,
        format,
        all_scenes: allScenes,
        video_crf: currentQuality.crf,
        // Never send transparent:true for a container that can't carry alpha
        // — the backend would render background-less frames and then flatten
        // them to yuv420p, giving black where the user expected transparency.
        transparent: currentFormat.supportsAlpha ? transparent : false,
      });

      const newTaskId = res.task_id;
      setTaskId(newTaskId);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const taskStatus: MotionExportTaskStatus = await getMotionExportStatus(newTaskId);
          const currentProgress = Math.round((taskStatus.progress || 0) * 100);
          setProgress(currentProgress);
          if (taskStatus.status) {
            setStatusMessage(taskStatus.status);
          }

          if (taskStatus.done) {
            clearPolling();
            setTaskId(null);
            setCancelling(false);
            // A cancelled task carries an `error` string, but it isn't a
            // failure — the user asked for it. Branch on the machine status,
            // not on the presence of error text.
            if (taskStatus.status === "cancelled") {
              setStatus("idle");
              setProgress(0);
              setStatusMessage("Export cancelled.");
              return;
            }
            if (taskStatus.error) {
              setStatus("error");
              setErrorMessage(taskStatus.error);
            } else {
              setStatus("completed");
              setDownloadPath(taskStatus.download_path);
            }
          }
        } catch (err) {
          clearPolling();
          setStatus("error");
          setErrorMessage(String(err));
        }
      }, 1000);
    } catch (err) {
      setStatus("error");
      setErrorMessage(String(err));
    }
  }

  async function handleCancelExport() {
    if (!taskId) return;
    setCancelling(true);
    try {
      await cancelMotionExport(taskId);
      // Don't tear down state here — the poll above sees status "cancelled"
      // and resets consistently, so cancelling via the UI and the task
      // ending on its own take the exact same path.
    } catch (err) {
      setCancelling(false);
      setErrorMessage(String(err));
    }
  }

  function handleDownload() {
    if (!downloadPath) return;
    window.open(downloadPath, "_blank");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-base">
            <Film size={18} className="text-accent" />
            <span>Export Motion Project</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === "exporting"}
            className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text disabled:opacity-30"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-sm">
          {/* Scope. Hidden on single-scene projects, where "whole project"
              and "this scene" are the same thing and the choice is just
              noise. */}
          {sceneCount > 1 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-text-muted">Scope</label>
              <select
                value={allScenes ? "all" : "one"}
                onChange={(e) => setAllScenes(e.target.value === "all")}
                disabled={status === "exporting"}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="one">This scene only</option>
                <option value="all">Whole project ({sceneCount} scenes)</option>
              </select>
              <p className="text-[11px] text-text-faint">
                {allScenes
                  ? "All scenes render back-to-back into one continuous file."
                  : "Only the scene you're currently editing."}
              </p>
            </div>
          )}

          {/* Format */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-muted">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as MotionExportFormat)}
              disabled={status === "exporting"}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
            >
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-text-faint">{currentFormat.hint}</p>
          </div>

          {/* Transparency — only offered for containers that can carry alpha.
              Showing it for MP4 would be a lie: H.264 has no alpha channel, so
              the frames get flattened to yuv420p and the user gets black
              instead of transparency. */}
          {currentFormat.supportsAlpha ? (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
                disabled={status === "exporting"}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="block text-xs text-text">Transparent background</span>
                <span className="block text-[11px] text-text-faint">
                  Omits the scene background so the export can be composited over other footage.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-[11px] text-text-faint">
              MP4 can&apos;t store transparency — choose GIF or PNG sequence if you need it.
            </p>
          )}

          {/* Resolution Preset */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-muted">Resolution Preset</label>
            <select
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              disabled={status === "exporting"}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} {p.badge ? `(${p.badge})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Quality — only meaningful for the encoded video formats. GIF
              quality is driven by its palette, and a PNG sequence is
              lossless, so offering a CRF there would be meaningless. */}
          {(format === "mp4" || format === "mov") && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-text-muted">Quality</label>
              <select
                value={qualityId}
                onChange={(e) => setQualityId(e.target.value)}
                disabled={status === "exporting"}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label} {q.badge ? `(${q.badge})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Framerate Selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-muted">Frame Rate</label>
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              disabled={status === "exporting"}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
            >
              {FPS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Pre-flight Summary */}
          {(() => {
            const totalDurationMs = allScenes 
              ? project.scenes.reduce((acc, s) => acc + s.duration_ms, 0)
              : (project.scenes.find(s => s.id === activeSceneId)?.duration_ms || 0);
            
            const durationSec = totalDurationMs / 1000;
            const frameCount = Math.ceil(durationSec * fps);
            
            const hasAudio = allScenes 
              ? project.scenes.some(s => s.audio_tracks.some(t => !t.muted))
              : (project.scenes.find(s => s.id === activeSceneId)?.audio_tracks.some(t => !t.muted) || false);
            
            const slowFactors = [];
            if (currentPreset.width >= 3840) slowFactors.push("4K");
            if (fps >= 60) slowFactors.push("60fps");
            if (allScenes && sceneCount > 1) slowFactors.push("whole project");
            
            const isSlow = slowFactors.length > 0 || durationSec > 30;

            return (
              <div className="flex flex-col gap-2 p-3 rounded-lg bg-background border border-border/50 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Resolution</span>
                  <span className="font-medium text-text">{currentPreset.width} × {currentPreset.height}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Duration</span>
                  <span className="font-medium text-text">{durationSec.toFixed(2)}s ({frameCount} frames)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Audio</span>
                  <span className="font-medium text-text">{hasAudio ? "Included" : "Silent (no active tracks)"}</span>
                </div>
                
                {isSlow && (
                  <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      This export will be slow to render. ({slowFactors.join(" + ")}{slowFactors.length > 0 && durationSec > 30 ? " + " : ""}{durationSec > 30 ? "long duration" : ""}).
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Progress / Status Display */}
          {status === "exporting" && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin text-accent" />
                  {statusMessage || "Processing..."}
                </span>
                <span className="font-semibold text-accent">{progress}%</span>
              </div>
              <div className="w-full bg-background rounded-full h-2 overflow-hidden border border-border/40">
                <div
                  className="bg-accent h-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(3, progress)}%` }}
                />
              </div>
              {/* A 4K whole-project export can run for over ten minutes.
                  Without this the only way to stop one is to kill the app,
                  and the frames it has already written stay on disk. */}
              <button
                type="button"
                onClick={handleCancelExport}
                disabled={!taskId || cancelling}
                className="w-full text-xs text-text-muted hover:text-danger disabled:opacity-40 py-1"
              >
                {cancelling ? "Cancelling…" : "Cancel export"}
              </button>
            </div>
          )}

          {/* Completed State */}
          {status === "completed" && (
            <div className="p-3 rounded-lg bg-success/10 border border-success/30 flex items-center gap-3">
              <CheckCircle2 size={20} className="text-success shrink-0" />
              <div className="flex-1 text-xs">
                <p className="font-medium text-success">Export Ready!</p>
                <p className="text-text-muted mt-0.5">Your video has been rendered successfully.</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {status === "error" && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 flex items-start gap-2.5 text-xs text-danger">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Export Failed</p>
                <p className="mt-0.5 opacity-90">{errorMessage || "An error occurred during export."}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2 bg-background/50">
          {status === "completed" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md text-xs font-medium border border-border hover:bg-surface-hover"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-success text-white hover:opacity-90 shadow-sm"
              >
                <Download size={14} />
                Download MP4
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={status === "exporting"}
                className="px-4 py-2 rounded-md text-xs font-medium border border-border hover:bg-surface-hover disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartExport}
                disabled={status === "exporting"}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50 shadow-sm"
              >
                {status === "exporting" ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Rendering...
                  </>
                ) : (
                  <>
                    <Film size={14} />
                    Start Export
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
