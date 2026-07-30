import type { MotionProject } from "../types/motion";

const RECOVERY_PREFIX = "motion_recovery_";

export interface RecoverySnapshot {
  project: MotionProject;
  timestamp: string;
}

export function saveRecoverySnapshot(project: MotionProject): void {
  const snapshot: RecoverySnapshot = {
    project,
    timestamp: new Date().toISOString(),
  };
  try {
    localStorage.setItem(RECOVERY_PREFIX + project.id, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded or localStorage unavailable — silently ignore
  }
}

export function getRecoverySnapshot(projectId: string): RecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(RECOVERY_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw) as RecoverySnapshot;
  } catch {
    return null;
  }
}

export function clearRecoverySnapshot(projectId: string): void {
  try {
    localStorage.removeItem(RECOVERY_PREFIX + projectId);
  } catch {
    // Silently ignore
  }
}
