import { apiGet, apiPost, apiPut, apiDelete } from "./client";
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

export interface MotionExportOptions {
  scene_id?: string;
  fps?: number;
  width?: number;
  height?: number;
  base_url?: string;
}

export interface MotionExportTaskStatus {
  task_id: string;
  project_id: string;
  status: string;
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

