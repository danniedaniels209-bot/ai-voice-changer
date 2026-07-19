import { apiGet, apiPost, apiUpload, API_BASE_URL } from "./client";
import type { ConvertRequest, Job, JobSegment, JobSegmentsResponse } from "../types/api";

export function uploadVideo(video: File, onProgress?: (percent: number) => void): Promise<Job> {
  const formData = new FormData();
  formData.append("video", video);
  return apiUpload<Job>("/upload", formData, onProgress);
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
