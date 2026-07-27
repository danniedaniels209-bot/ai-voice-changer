import { useEffect, useRef, useState } from "react";
import { X, Film, Download, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  exportMotionProject,
  getMotionExportStatus,
  type MotionExportTaskStatus,
} from "../../api/motion";

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  sceneId?: string;
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
  { id: "720p", label: "720p HD (1280 × 720)", width: 1280, height: 720 },
  { id: "vertical", label: "Vertical Shorts/Reels (1080 × 1920)", width: 1080, height: 1920 },
  { id: "square", label: "Square Post (1080 × 1080)", width: 1080, height: 1080 },
];

const FPS_OPTIONS = [
  { value: 30, label: "30 FPS (Standard)" },
  { value: 24, label: "24 FPS (Film)" },
  { value: 60, label: "60 FPS (High Motion)" },
];

export function ExportDialog({ isOpen, onClose, projectId, sceneId }: ExportDialogProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>("1080p");
  const [fps, setFps] = useState<number>(30);

  const [status, setStatus] = useState<"idle" | "exporting" | "completed" | "error">("idle");
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  async function handleStartExport() {
    setStatus("exporting");
    setProgress(0);
    setStatusMessage("Initializing export task...");
    setErrorMessage(null);

    try {
      const res = await exportMotionProject(projectId, {
        scene_id: sceneId,
        fps,
        width: currentPreset.width,
        height: currentPreset.height,
      });

      const newTaskId = res.task_id;

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

          {/* Export Format Info */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/50 text-xs">
            <span className="text-text-muted">Export Format</span>
            <span className="font-medium text-text">MP4 (H.264 / AAC)</span>
          </div>

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
