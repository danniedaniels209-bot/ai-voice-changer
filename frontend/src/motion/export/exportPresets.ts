/**
 * LT-EXPORTPRESETS: named combinations of the export settings ExportDialog
 * already tracks (resolution preset id / fps / format / quality id /
 * transparent) — nothing new to send to the backend, nothing added to the
 * project model. A preset is a convenience for filling in the SAME dialog
 * faster, not a property of the video, so it lives in localStorage next to
 * the app's other UI-only state (motion_audio_open, motion_left_sidebar_width,
 * ...) rather than in settings_store.py, which is a single global machine
 * config object (ffmpeg path, temp dir, device mode) with no notion of a
 * growable named list — the wrong shape for this.
 */

export interface ExportPresetValues {
  resolutionPresetId: string;
  fps: number;
  format: string;
  qualityId: string;
  transparent: boolean;
}

export interface ExportPreset extends ExportPresetValues {
  id: string;
  name: string;
}

/** A small, illustrative set — the brief's own "etc." doesn't ask for an
 *  exhaustive catalogue. Chat GIF is included deliberately alongside the
 *  three named platforms: it's the one built-in that changes FORMAT, not
 *  just resolution, so the preset system is shown covering both rather than
 *  only ever picking a frame size. */
export const BUILTIN_PRESETS: ExportPreset[] = [
  {
    id: "youtube-1080p",
    name: "YouTube 1080p",
    resolutionPresetId: "1080p",
    fps: 30,
    format: "mp4",
    qualityId: "high",
    transparent: false,
  },
  {
    id: "instagram-square",
    name: "Instagram Square",
    resolutionPresetId: "square",
    fps: 30,
    format: "mp4",
    qualityId: "balanced",
    transparent: false,
  },
  {
    id: "tiktok-vertical",
    name: "TikTok Vertical",
    resolutionPresetId: "vertical",
    fps: 30,
    format: "mp4",
    qualityId: "balanced",
    transparent: false,
  },
  {
    id: "chat-gif",
    name: "Chat GIF",
    resolutionPresetId: "720p",
    fps: 24,
    format: "gif",
    qualityId: "high",
    transparent: false,
  },
];

const STORAGE_KEY = "motion_export_presets";

function newPresetId(): string {
  return `custom-${crypto.randomUUID().slice(0, 8)}`;
}

/** Custom presets the user has saved. Empty array (not null/undefined) so
 *  every caller can `.map()` it without a null check — same convention as
 *  BUILTIN_PRESETS. Corrupt/missing localStorage data degrades to "no
 *  custom presets" rather than throwing during render. */
export function getCustomPresets(): ExportPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setCustomPresets(presets: ExportPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

/** Save the current dialog settings as a new custom preset. Trims the name
 *  and refuses an empty one rather than silently saving "Untitled" — the
 *  caller (a prompt()) already gives the user a chance to cancel; an empty
 *  string past that point is almost certainly an accidental confirm. */
export function saveCustomPreset(name: string, values: ExportPresetValues): ExportPreset | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const preset: ExportPreset = { id: newPresetId(), name: trimmed, ...values };
  setCustomPresets([...getCustomPresets(), preset]);
  return preset;
}

export function deleteCustomPreset(id: string): void {
  setCustomPresets(getCustomPresets().filter((p) => p.id !== id));
}
