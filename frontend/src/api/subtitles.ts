import { apiGet } from "./client";
import type { SubtitleStyle } from "../types/subtitle";

export function listSubtitlePresets(): Promise<SubtitleStyle[]> {
  return apiGet<SubtitleStyle[]>("/subtitles/presets");
}
