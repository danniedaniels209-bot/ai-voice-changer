import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listJobs } from "../api/jobs";
import { ApiError } from "../api/client";
import { ProgressBar } from "../components/ProgressBar";
import type { Job, JobStatus } from "../types/api";

const STATUS_STYLES: Record<JobStatus, string> = {
  pending: "bg-surface border border-border text-text-muted",
  processing: "bg-accent/15 text-accent",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-surface border border-border text-text-muted",
};

const POLL_INTERVAL_MS = 2_000;

export function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    async function refresh() {
      try {
        const list = await listJobs();
        if (!disposed) {
          setJobs(list);
          setError(null);
        }
      } catch (err) {
        if (!disposed) setError(err instanceof ApiError ? err.message : String(err));
      }
    }

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Jobs</h2>
        <p className="text-text-muted text-sm">
          Every conversion from this session. Click a job to open its progress page.
        </p>
      </div>

      {error && <p className="text-sm text-danger">Could not load jobs: {error}</p>}

      {jobs !== null && jobs.length === 0 && (
        <p className="text-sm text-text-muted">
          No jobs yet. Start a conversion from the <Link to="/" className="text-accent underline">Home page</Link>.
        </p>
      )}

      <ul className="space-y-3">
        {(jobs ?? []).map((job) => (
          <li key={job.id}>
            <Link
              to={`/processing/${job.id}`}
              className="block rounded-md border border-border bg-surface hover:border-accent/50 transition-colors p-4"
            >
              <div className="flex items-center justify-between gap-4 mb-2">
                <span className="text-sm font-medium truncate">
                  {job.original_filename ?? job.id}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[job.status]}`}
                >
                  {job.status}
                </span>
              </div>

              {job.status === "processing" && (
                <div className="space-y-1">
                  <ProgressBar percent={job.progress_percent} />
                  <p className="text-xs text-text-muted">
                    {job.progress_percent.toFixed(0)}% — {job.stage.replaceAll("_", " ")}
                  </p>
                </div>
              )}

              {job.status === "failed" && job.error_message && (
                <p className="text-xs text-danger truncate">{job.error_message}</p>
              )}

              {job.status === "completed" && job.output_path && (
                <p className="text-xs text-text-muted truncate">Exported: {job.output_path}</p>
              )}

              <p className="text-xs text-text-muted mt-2">
                Started {new Date(job.created_at).toLocaleString()}
                {job.request_summary?.Mode ? ` · ${job.request_summary.Mode}` : ""}
                {job.request_summary?.Engine ? ` · ${job.request_summary.Engine}` : ""}
                {job.request_summary?.Voice ?? job.model_name
                  ? ` · ${job.request_summary?.Voice ?? job.model_name}`
                  : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
