import { apiGet, apiPut } from "./client";
import type { AppSettings, AppSettingsUpdate } from "../types/api";

export function getSettings(): Promise<AppSettings> {
  return apiGet<AppSettings>("/settings");
}

export function updateSettings(patch: AppSettingsUpdate): Promise<AppSettings> {
  return apiPut<AppSettings>("/settings", patch);
}
