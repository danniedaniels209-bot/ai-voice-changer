import { apiGet, apiUpload, apiDelete } from "./client";
import type { CustomVoiceInfo, DubLanguage, VoiceInfo } from "../types/api";

export function listVoices(): Promise<VoiceInfo[]> {
  return apiGet<VoiceInfo[]>("/voices");
}

export function listCustomVoices(): Promise<CustomVoiceInfo[]> {
  return apiGet<CustomVoiceInfo[]>("/voices/custom");
}

export function uploadCustomVoice(name: string, sample: File): Promise<CustomVoiceInfo> {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("sample", sample);
  return apiUpload<CustomVoiceInfo>("/voices/custom", formData);
}

export function deleteCustomVoice(name: string): Promise<{ deleted: string }> {
  return apiDelete<{ deleted: string }>(`/voices/custom/${encodeURIComponent(name)}`);
}

export function listDubLanguages(): Promise<{ languages: DubLanguage[] }> {
  return apiGet<{ languages: DubLanguage[] }>("/voices/dub");
}
