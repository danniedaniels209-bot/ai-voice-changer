import { apiGet, apiUpload, apiDelete, API_BASE_URL } from "./client";
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

/** Audition a voice on the user's own words, with the engine/expressiveness
 * the conversion will actually use. Returns a playable object URL. */
export async function tryVoice(body: {
  voice: string;
  text: string;
  engine: "edge" | "chatterbox";
  exaggeration: number;
}): Promise<string> {
  const token =
    localStorage.getItem("avc_remote_enabled") === "1"
      ? localStorage.getItem("avc_remote_token")
      : null;
  const res = await fetch(`${API_BASE_URL}/voices/try`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-AVC-Token": token } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => null))?.error?.message ?? "Preview failed");
  }
  return URL.createObjectURL(await res.blob());
}
