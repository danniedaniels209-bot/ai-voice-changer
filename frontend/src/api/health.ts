import { apiGet } from "./client";
import type { HealthResponse } from "../types/api";

export function getHealth(): Promise<HealthResponse> {
  return apiGet<HealthResponse>("/health");
}
