import { API_BASE_URL, apiGet, apiPost, apiPut, apiDelete, apiUpload } from "./client";
import type { MotionProject } from "../types/motion";

export interface MotionProjectSummary {
  id: string;
  name: string;
  updated_at: string;
  scene_count: number;
}

export function listMotionProjects(): Promise<MotionProjectSummary[]> {
  return apiGet<MotionProjectSummary[]>("/motion/projects");
}

export function createMotionProject(name: string): Promise<MotionProject> {
  return apiPost<MotionProject>("/motion/projects", { name });
}

export function getMotionProject(id: string): Promise<MotionProject> {
  return apiGet<MotionProject>(`/motion/projects/${id}`);
}

export function saveMotionProject(project: MotionProject): Promise<MotionProject> {
  return apiPut<MotionProject>(`/motion/projects/${project.id}`, project);
}

export function deleteMotionProject(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/motion/projects/${id}`);
}

export type MotionExportFormat = "mp4" | "mov" | "gif" | "png_sequence";

export interface MotionExportOptions {
  scene_id?: string;
  fps?: number;
  width?: number;
  height?: number;
  format?: MotionExportFormat;
  /** Render frames with no background. Only meaningful for gif and
   *  png_sequence — H.264 can't carry an alpha channel, so the mp4 path
   *  flattens to yuv420p regardless of what's requested here. */
  transparent?: boolean;
  /** Export every scene in the project, in order, as one continuous file.
   *  Deliberately an explicit flag rather than "omit scene_id" — omitting
   *  scene_id has always meant "the first scene", and changing that meaning
   *  would silently turn existing callers' single-scene exports into
   *  whole-project renders. */
  all_scenes?: boolean;
  /** Constant Rate Factor for the mp4 encoder — lower is higher quality and
   *  a bigger file. Default "18" is visually lossless for most content;
   *  omitted means the backend keeps that default. */
  video_crf?: string;
  /** Target bitrate (e.g. "12M"). When set it takes precedence over CRF —
   *  useful when a platform requires a specific bitrate. */
  video_bitrate?: string | null;
  base_url?: string;
}

/** Machine-readable lifecycle state. Distinct from `message`, which is the
 *  human-facing string — client logic must branch on this, never on the
 *  message text. */
export type MotionExportStatus =
  | "queued"
  | "rendering"
  | "encoding"
  | "done"
  | "failed"
  | "cancelled";

export interface MotionExportTaskStatus {
  task_id: string;
  project_id: string;
  status: MotionExportStatus;
  /** Human-readable progress text, safe to show but not to branch on. */
  message?: string;
  done: boolean;
  progress: number;
  export_path: string | null;
  download_path: string | null;
  error: string | null;
}

export function exportMotionProject(
  projectId: string,
  options?: MotionExportOptions
): Promise<{ task_id: string }> {
  return apiPost<{ task_id: string }>(`/motion/projects/${projectId}/export`, options || {});
}

export function getMotionExportStatus(taskId: string): Promise<MotionExportTaskStatus> {
  return apiGet<MotionExportTaskStatus>(`/motion/projects/export/${taskId}`);
}

export interface MotionAssetUploadResponse {
  asset_id: string;
  filename: string;
  source_url: string;
  content_type: string | null;
  size_bytes: number;
}

export function uploadMotionAsset(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<MotionAssetUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return apiUpload<MotionAssetUploadResponse>("/motion/assets/upload", form, onProgress);
}

export function resolveMotionAssetUrl(sourceUrl: string): string {
  if (!sourceUrl) return "";
  if (/^(blob:|data:|https?:\/\/)/i.test(sourceUrl)) return sourceUrl;
  if (sourceUrl.startsWith("/")) return `${API_BASE_URL}${sourceUrl}`;
  return sourceUrl;
}

/** Cancel a running export. Terminal tasks come back unchanged rather than
 *  erroring — cancelling something already finished is a no-op, not a
 *  failure. */
export function cancelMotionExport(taskId: string): Promise<MotionExportTaskStatus> {
  return apiDelete<MotionExportTaskStatus>(`/motion/exports/${taskId}`);
}

export interface MotionAsset {
  asset_id: string;
  filename: string;
  /** Relative path — resolve with resolveMotionAssetUrl before using it as
   *  a src, so it keeps working in remote-backend mode. */
  source_url: string;
  content_type: string;
  size_bytes: number;
  created: string;
}

export function listMotionAssets(): Promise<MotionAsset[]> {
  return apiGet<MotionAsset[]>("/motion/assets");
}

/** Delete an uploaded asset. The backend refuses with 409 if a project still
 *  references it, and the error names what's using it — surface that rather
 *  than a generic failure, since "can't delete" without a reason is the
 *  least helpful possible message. */
export function deleteMotionAsset(assetId: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/motion/assets/${assetId}`);
}

export interface TranscriptionTaskStatus {
  task_id: string;
  project_id: string;
  track_id: string;
  status: "queued" | "transcribing" | "done" | "failed" | "cancelled";
  done: boolean;
  progress: number;
  cues: import("../types/subtitle").SubtitleCue[];
  error: string | null;
}

export function startAudioTrackTranscription(
  projectId: string,
  trackId: string,
): Promise<{ task_id: string }> {
  return apiPost<{ task_id: string }>(`/motion/projects/${projectId}/tracks/${trackId}/transcribe`);
}

export function getTranscriptionStatus(taskId: string): Promise<TranscriptionTaskStatus> {
  return apiGet<TranscriptionTaskStatus>(`/motion/transcribe/${taskId}`);
}

export function cancelTranscriptionTask(taskId: string): Promise<TranscriptionTaskStatus> {
  return apiDelete<TranscriptionTaskStatus>(`/motion/transcribe/${taskId}`);
}
