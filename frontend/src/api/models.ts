import { apiDelete, apiGet, apiUpload } from "./client";
import type { RVCModelInfo } from "../types/api";

export function listModels(): Promise<RVCModelInfo[]> {
  return apiGet<RVCModelInfo[]>("/models");
}

export function getModel(name: string): Promise<RVCModelInfo> {
  return apiGet<RVCModelInfo>(`/models/${encodeURIComponent(name)}`);
}

export function importModel(
  name: string,
  pthFile: File,
  indexFile: File | null,
): Promise<RVCModelInfo> {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("pth_file", pthFile);
  if (indexFile) {
    formData.append("index_file", indexFile);
  }
  return apiUpload<RVCModelInfo>("/models/import", formData);
}

export function deleteModel(name: string): Promise<{ status: string; name: string }> {
  return apiDelete(`/models/${encodeURIComponent(name)}`);
}
