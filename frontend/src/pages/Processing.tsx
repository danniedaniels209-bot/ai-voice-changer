import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useJobProgress } from "../hooks/useJobProgress";
import {
  getJob,
  cancelConversion,
  getJobSegments,
  previewJobSegment,
  reexportJob,
} from "../api/jobs";
import { API_BASE_URL } from "../api/client";
import type { JobSegment } from "../types/api";
import { ProgressBar } from "../components/ProgressBar";
import { StageIndicator } from "../components/StageIndicator";
import { Button } from "../components/Button";
import type { Job } from "../types/api";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function Processing() {
  const { jobId } = useParams<{ jobId: string }>();
  const { job: wsJob, connected } = useJobProgress(jobId ?? null);
  const [fallbackJob, setFallbackJob] = useState<Job | null>(null);

  // Segment editor state
  const [segments, setSegments] = useState<JobSegment[] | null>(null);
  const [editorNote, setEditorNote] = useState<string>("");
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [previewingSeg, setPreviewingSeg] = useState<number | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const segAudioRef = useRef<HTMLAudioElement | null>(null);

  // Poll as a fallback in case the WebSocket connection drops.
  useEffect(() => {
    if (!jobId || connected) return;
    const interval = setInterval(() => {
      getJob(jobId)
        .then(setFallbackJob)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId, connected]);

  // Prefer the FRESHER snapshot: after a re-export, the WebSocket's last
  // (terminal) value would otherwise shadow the live polling updates.
  const job =
    wsJob && fallbackJob
      ? (fallbackJob.updated_at > wsJob.updated_at ? fallbackJob : wsJob)
      : (wsJob ?? fallbackJob);

  // Load the editable narration plan once the job completes (tts/script only).
  const completedAt = job?.status === "completed" ? job.output_path : null;
  useEffect(() => {
    if (!jobId || !completedAt) return;
    getJobSegments(jobId)
      .then((r) => {
        if (r.editable) {
          setSegments(r.segments);
          setEditorNote("");
        } else {
          setSegments(null);
          setEditorNote(r.reason);
        }
        setDirty(new Set());
      })
      .catch(() => setSegments(null));
    return () => segAudioRef.current?.pause();
  }, [jobId, completedAt]);

  function updateSegmentText(id: number, text: string) {
    setSegments((s) => (s ? s.map((x) => (x.id === id ? { ...x, text } : x)) : s));
    setDirty((d) => new Set(d).add(id));
  }

  function newTake(id: number) {
    setSegments((s) =>
      s ? s.map((x) => (x.id === id ? { ...x, seed: x.seed + 1 } : x)) : s,
    );
    setDirty((d) => new Set(d).add(id));
  }

  async function playSegPreview(seg: JobSegment) {
    if (!jobId) return;
    segAudioRef.current?.pause();
    setPreviewingSeg(seg.id);
    setEditorError(null);
    try {
      const url = await previewJobSegment(jobId, {
        id: seg.id,
        text: seg.text,
        seed: seg.seed,
      });
      const audio = new Audio(url);
      segAudioRef.current = audio;
      audio.onended = () => setPreviewingSeg(null);
      await audio.play();
    } catch (e) {
      setPreviewingSeg(null);
      setEditorError(e instanceof Error ? e.message : String(e));
    }
  }

  function seekVideo(seconds: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
    }
  }

  async function applyReexport() {
    if (!jobId || !segments) return;
    setEditorError(null);
    try {
      await reexportJob(jobId, segments);
      setSegments(null); // job flips to processing; editor reloads on completion
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!jobId) {
    return <p className="text-danger">No job specified.</p>;
  }
  if (!job) {
    return <p className="text-text-muted">Loading job status...</p>;
  }

  const isTerminal = TERMINAL_STATUSES.has(job.status);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-1">Processing</h2>
        <p className="text-text-muted text-sm">
          {job.original_filename ?? "Untitled"} — job {job.id}
        </p>
      </div>

      <section className="space-y-3">
        <ProgressBar percent={job.progress_percent} />
        <p className="text-sm text-text-muted">{job.progress_percent.toFixed(0)}% complete</p>
      </section>

      <section>
        <StageIndicator
          stage={job.stage}
          mode={job.mode}
          skippedSeparation={job.log.some((l) => l.message.includes("Skipping"))}
        />
      </section>

      {Object.keys(job.request_summary ?? {}).length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-text-muted mb-2">Job settings</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(job.request_summary).map(([key, value]) => (
              <span
                key={key}
                className="rounded-full border border-border bg-surface px-3 py-1 text-xs"
              >
                <span className="text-text-muted">{key}: </span>
                {value}
              </span>
            ))}
          </div>
        </section>
      )}

      {job.status === "failed" && (
        <section className="border border-danger/30 bg-danger/10 rounded-md p-4">
          <p className="font-medium text-danger">Conversion failed</p>
          <p className="text-sm text-text-muted mt-1">{job.error_message}</p>
        </section>
      )}

      {job.status === "cancelled" && (
        <section className="border border-warning/30 bg-warning/10 rounded-md p-4">
          <p className="font-medium text-warning">Conversion was cancelled</p>
        </section>
      )}

      {job.status === "completed" && job.output_path && (
        <section className="border border-success/30 bg-success/10 rounded-md p-4 space-y-3">
          <p className="font-medium text-success">Done!</p>
          <video
            ref={videoRef}
            controls
            src={`${API_BASE_URL}/jobs/${job.id}/result?v=${encodeURIComponent(job.updated_at)}`}
            className="w-full max-h-96 rounded-md bg-black"
          />
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              href={`${API_BASE_URL}/jobs/${job.id}/result`}
              download
              className="text-accent hover:underline"
            >
              ⬇ Download video
            </a>
            {job.extra_outputs.some((p) => p.endsWith("_vertical.mp4")) && (
              <a
                href={`${API_BASE_URL}/jobs/${job.id}/result?variant=vertical`}
                download
                className="text-accent hover:underline"
              >
                ⬇ Vertical (9:16) for Shorts
              </a>
            )}
            {job.subtitle_path && (
              <a
                href={`${API_BASE_URL}/jobs/${job.id}/result?variant=subtitles`}
                download
                className="text-accent hover:underline"
              >
                ⬇ Subtitles (.srt)
              </a>
            )}
          </div>
          <p className="text-xs text-text-muted break-all">{job.output_path}</p>
        </section>
      )}

      {job.status === "completed" && (segments !== null || editorNote) && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-text-muted">
            Edit voice segments
            {segments && dirty.size > 0 && (
              <span className="text-warning"> — {dirty.size} change(s) pending</span>
            )}
          </h3>
          {editorNote && <p className="text-xs text-text-muted">{editorNote}</p>}
          {editorError && <p className="text-sm text-danger">{editorError}</p>}
          {segments && (
            <>
              <p className="text-xs text-text-muted">
                Click a time to jump the video there. Edit text, hear it with ▶, or roll a
                new take with ↻ — then apply to re-export. Untouched lines reuse their
                existing audio, so this is fast.
              </p>
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {segments.map((seg) => (
                  <div
                    key={seg.id}
                    className={`flex items-center gap-2 rounded-md border p-2 text-sm ${
                      previewingSeg === seg.id
                        ? "border-accent bg-accent/10"
                        : dirty.has(seg.id)
                          ? "border-warning/60 bg-surface"
                          : "border-border bg-surface"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => seekVideo(seg.start)}
                      title="Jump video to this segment"
                      className="shrink-0 font-mono text-xs text-accent hover:underline"
                    >
                      {seg.start.toFixed(1)}s
                    </button>
                    <input
                      value={seg.text}
                      onChange={(e) => updateSegmentText(seg.id, e.target.value)}
                      className="flex-1 min-w-0 bg-transparent outline-none"
                    />
                    {seg.seed > 0 && (
                      <span className="shrink-0 text-[10px] text-text-muted">take {seg.seed + 1}</span>
                    )}
                    <button
                      type="button"
                      title="Hear this segment"
                      onClick={() => playSegPreview(seg)}
                      className="shrink-0 rounded border border-border px-2 py-0.5 text-xs hover:border-accent/50"
                    >
                      {previewingSeg === seg.id ? "…" : "▶"}
                    </button>
                    <button
                      type="button"
                      title="New take (different delivery of the same line)"
                      onClick={() => newTake(seg.id)}
                      className="shrink-0 rounded border border-border px-2 py-0.5 text-xs hover:border-accent/50"
                    >
                      ↻
                    </button>
                  </div>
                ))}
              </div>
              <Button onClick={applyReexport} disabled={dirty.size === 0}>
                Apply changes & re-export
              </Button>
            </>
          )}
        </section>
      )}

      {!isTerminal && (
        <Button
          variant="danger"
          onClick={() => jobId && cancelConversion(jobId).catch(() => {})}
        >
          Cancel
        </Button>
      )}

      <section>
        <h3 className="text-sm font-medium text-text-muted mb-2">Log</h3>
        <div className="bg-surface border border-border rounded-md p-3 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
          {job.log.map((entry, i) => (
            <div key={i} className="text-text-muted">
              <span className="text-text-muted/60">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>{" "}
              {entry.message}
            </div>
          ))}
        </div>
      </section>

      {isTerminal && (
        <Link to="/" className="text-accent text-sm hover:underline">
          ← Convert another video
        </Link>
      )}
    </div>
  );
}
