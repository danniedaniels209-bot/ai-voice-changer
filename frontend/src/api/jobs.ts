import { apiGet, apiPost, apiUpload, API_BASE_URL } from "./client";
import type { ConvertRequest, Job, JobSegment, JobSegmentsResponse } from "../types/api";

// Cloudflare quick tunnels cap a single request at ~100 MB, so anything
// bigger goes up in sequential <50 MB chunks the backend reassembles.
const CHUNK_THRESHOLD = 90 * 1024 * 1024;
const CHUNK_SIZE = 48 * 1024 * 1024;

export async function uploadVideo(
  video: File,
  onProgress?: (percent: number) => void,
): Promise<Job> {
  if (video.size <= CHUNK_THRESHOLD) {
    const formData = new FormData();
    formData.append("video", video);
    return apiUpload<Job>("/upload", formData, onProgress);
  }

  const uploadId = crypto.randomUUID();
  const totalChunks = Math.ceil(video.size / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const part = video.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const formData = new FormData();
    formData.append("upload_id", uploadId);
    formData.append("index", String(i));
    formData.append("chunk", part, video.name);
    await apiUpload<{ received: number }>("/upload/chunk", formData, (pct) => {
      if (onProgress) onProgress(((i + pct / 100) / totalChunks) * 100);
    });
  }
  return apiPost<Job>("/upload/finalize", {
    upload_id: uploadId,
    filename: video.name,
    total_chunks: totalChunks,
  });
}

export function getJob(jobId: string): Promise<Job> {
  return apiGet<Job>(`/jobs/${jobId}`);
}

export function listJobs(): Promise<Job[]> {
  return apiGet<Job[]>("/jobs");
}

export function startConversion(jobId: string, request: ConvertRequest): Promise<Job> {
  return apiPost<Job>(`/convert/${jobId}`, request);
}

export function cancelConversion(jobId: string): Promise<Job> {
  return apiPost<Job>(`/convert/${jobId}/cancel`);
}

export function getJobSegments(jobId: string): Promise<JobSegmentsResponse> {
  return apiGet<JobSegmentsResponse>(`/jobs/${jobId}/segments`);
}

export async function previewJobSegment(
  jobId: string,
  segment: { id: number; text: string; seed: number },
): Promise<string> {
  const token = localStorage.getItem("avc_remote_enabled") === "1"
    ? localStorage.getItem("avc_remote_token") : null;
  const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/segments/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-AVC-Token": token } : {}) },
    body: JSON.stringify(segment),
  });
  if (!res.ok) throw new Error((await res.json())?.error?.message ?? "Preview failed");
  return URL.createObjectURL(await res.blob());
}

export function reexportJob(jobId: string, segments: JobSegment[]): Promise<Job> {
  return apiPost<Job>(`/jobs/${jobId}/reexport`, { segments });
}
