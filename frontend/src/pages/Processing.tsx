import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useJobProgress } from "../hooks/useJobProgress";
import { getJob, cancelConversion } from "../api/jobs";
import { API_BASE_URL } from "../api/client";
import { ProgressBar } from "../components/ProgressBar";
import { StageIndicator } from "../components/StageIndicator";
import { Button } from "../components/Button";
import type { Job } from "../types/api";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function Processing() {
  const { jobId } = useParams<{ jobId: string }>();
  const { job: wsJob, connected } = useJobProgress(jobId ?? null);
  const [fallbackJob, setFallbackJob] = useState<Job | null>(null);

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

  const job = wsJob ?? fallbackJob;

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
            controls
            src={`${API_BASE_URL}/jobs/${job.id}/result`}
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
