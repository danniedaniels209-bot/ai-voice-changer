import { useEffect, useRef, useState } from "react";
import { WS_BASE_URL, WS_AUTH_SUFFIX } from "../api/client";
import { getJob } from "../api/jobs";
import type { Job } from "../types/api";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_RECONNECT_DELAY_MS = 10_000;
const POLL_INTERVAL_MS = 2_000;

function isTerminal(job: Job | null): boolean {
  return job !== null && TERMINAL_STATUSES.has(job.status);
}

/**
 * Subscribes to /ws/jobs/{jobId} for live progress. If the socket drops
 * mid-job (network blip, backend restart), it reconnects with exponential
 * backoff and, while disconnected, polls GET /jobs/{id} every 2s so the UI
 * never silently freezes. Both stop once the job reaches a terminal status.
 */
export function useJobProgress(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const [connected, setConnected] = useState(false);
  const jobRef = useRef<Job | null>(null);
  jobRef.current = job;

  useEffect(() => {
    if (!jobId) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer !== null || disposed || isTerminal(jobRef.current)) return;
      pollTimer = setInterval(async () => {
        try {
          const fresh = await getJob(jobId);
          if (disposed) return;
          setJob(fresh);
          if (TERMINAL_STATUSES.has(fresh.status)) stopPolling();
        } catch {
          // backend unreachable — keep trying until disposed
        }
      }, POLL_INTERVAL_MS);
    };

    const connect = () => {
      if (disposed || isTerminal(jobRef.current)) return;

      socket = new WebSocket(`${WS_BASE_URL}/ws/jobs/${jobId}${WS_AUTH_SUFFIX}`);

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        stopPolling();
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (!data.error) setJob(data as Job);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (disposed || isTerminal(jobRef.current)) return;
        startPolling();
        const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        // onclose fires after onerror; reconnection is handled there
      };
    };

    connect();

    return () => {
      disposed = true;
      stopPolling();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [jobId]);

  return { job, connected };
}
