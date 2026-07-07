import { apiGet, apiPost, apiUpload, API_BASE_URL } from "./client";

export interface NarrationSegment {
  id: number;
  kind: string;
  text: string;
  speak_text: string;
  voice: string;
  rate_pct: number;
  pitch_hz: number;
  energy_pct: number;
  exaggeration: number;
  pause_after: number;
  skipped: boolean;
  meta: {
    sentence_type: string;
    emphasis_words: string[];
    tech_terms: string[];
  };
}

export interface NarrationStats {
  words: number;
  segments: number;
  code_blocks: number;
  questions: number;
  estimated_duration_seconds: number;
  reading_time_seconds: number;
}

export interface AnalyzeResult {
  studio_id: string;
  stats: NarrationStats;
  segments: NarrationSegment[];
  modes: string[];
}

export interface NarrationControls {
  speed: number;
  pitch: number;
  energy: number;
  expression: number;
  stability: number;
  naturalness: number;
  pause_scale: number;
}

export function analyzeScript(body: {
  script: string;
  mode: string;
  narrator_voice: string;
  quote_voice: string | null;
  code_policy: string;
  controls: NarrationControls;
}): Promise<AnalyzeResult> {
  return apiPost<AnalyzeResult>("/narration/analyze", body);
}

export function uploadScriptFile(file: File): Promise<{ script: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return apiUpload<{ script: string }>("/narration/upload-script", fd);
}

export async function previewSegment(body: {
  studio_id: string;
  segment: NarrationSegment;
  engine: string;
  stability: number;
  regenerate: boolean;
  seed: number;
}): Promise<string> {
  // Returns an object URL for immediate playback.
  const token = localStorage.getItem("avc_remote_enabled") === "1"
    ? localStorage.getItem("avc_remote_token") : null;
  const res = await fetch(`${API_BASE_URL}/narration/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-AVC-Token": token } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json())?.error?.message ?? "Preview failed");
  return URL.createObjectURL(await res.blob());
}

export interface RenderResult {
  studio_id: string;
  duration: number;
  timestamps: { id: number; text: string; start: number; end: number }[];
}

export function renderNarration(body: {
  studio_id: string;
  segments: NarrationSegment[];
  engine: string;
  stability: number;
  naturalness: number;
}): Promise<RenderResult> {
  return apiPost<RenderResult>("/narration/render", body);
}

export function narrationAudioUrl(studioId: string): string {
  return `${API_BASE_URL}/narration/${studioId}/audio`;
}

export function narrationExportUrl(studioId: string, format: string, subtitles = false): string {
  return `${API_BASE_URL}/narration/${studioId}/export?format=${format}&subtitles=${subtitles}`;
}

export function ping(): Promise<unknown> {
  return apiGet("/health");
}
