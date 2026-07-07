import { apiGet, apiPost, apiUpload } from "./client";
import type { ConvertRequest, Job } from "../types/api";

export function uploadVideo(video: File): Promise<Job> {
  const formData = new FormData();
  formData.append("video", video);
  return apiUpload<Job>("/upload", formData);
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
