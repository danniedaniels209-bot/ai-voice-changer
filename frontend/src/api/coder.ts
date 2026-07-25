import { apiGet, apiPost, apiDelete, apiUpload, API_BASE_URL } from "./client";
import type { LlmModelInfo } from "./scriptgen";

export interface CoderStatus {
  available: boolean;
  reason: string;
  model: string;
  active_model?: string;
  models?: LlmModelInfo[];
  files: string[];
}

export interface CoderToolCall {
  tool: string;
  target?: string;
  note?: string;
  args: Record<string, unknown>;
  running?: boolean;
  ok: boolean | null;
  output?: string;
}

export interface CoderChatResponse {
  task_id: string;
  status: string;
  done: boolean;
  reply: string;
  tool_calls: CoderToolCall[];
  files: string[];
  error: string | null;
}

export function coderStatus(): Promise<CoderStatus> {
  return apiGet<CoderStatus>("/coder/status");
}

/**
 * Start an agent run and poll until it finishes. The work happens in a
 * background task on the server, so a build can take as long as it needs
 * without any HTTP/tunnel timeout — `onProgress` reports each step live.
 */
export async function coderChat(
  messages: { role: "user" | "assistant"; content: string }[],
  onProgress?: (update: CoderChatResponse) => void,
  onStart?: (taskId: string) => void,
): Promise<CoderChatResponse> {
  const { task_id } = await apiPost<{ task_id: string }>("/coder/chat", { messages });
  onStart?.(task_id);
  for (;;) {
    await new Promise((r) => setTimeout(r, 800));
    const state = await apiGet<CoderChatResponse>(`/coder/chat/${task_id}`);
    onProgress?.(state);
    if (state.done) {
      if (state.error) throw new Error(state.error);
      return state;
    }
  }
}

/** Ask a running agent to stop after its current step. */
export function stopCoderRun(taskId: string): Promise<{ stopping: boolean }> {
  return apiPost<{ stopping: boolean }>(`/coder/chat/${taskId}/stop`);
}

export function uploadToWorkspace(
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<{ saved: string[]; files: string[] }> {
  const form = new FormData();
  for (const f of files) {
    // webkitRelativePath preserves folder structure when a directory is picked.
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    form.append("files", f, rel && rel.length > 0 ? rel : f.name);
  }
  return apiUpload<{ saved: string[]; files: string[] }>("/coder/upload", form, onProgress);
}

export function readWorkspaceFile(path: string): Promise<string> {
  const token =
    localStorage.getItem("avc_remote_enabled") === "1"
      ? localStorage.getItem("avc_remote_token")
      : null;
  const headers: Record<string, string> = token ? { "X-AVC-Token": token } : {};
  return fetch(`${API_BASE_URL}/coder/file?path=${encodeURIComponent(path)}`, {
    headers,
  }).then((r) => {
    if (!r.ok) throw new Error("Could not read that file.");
    return r.text();
  });
}

export function writeWorkspaceFile(path: string, content: string): Promise<{ files: string[] }> {
  return apiPost<{ files: string[] }>("/coder/file", { path, content });
}

export function deleteWorkspaceFile(path: string): Promise<{ files: string[] }> {
  return apiDelete<{ files: string[] }>(`/coder/file?path=${encodeURIComponent(path)}`);
}

export function clearWorkspace(): Promise<{ files: string[] }> {
  return apiDelete<{ files: string[] }>("/coder/workspace");
}

export function workspaceDownloadUrl(path: string): string {
  return `${API_BASE_URL}/coder/download?path=${encodeURIComponent(path)}`;
}

/** Everything the assistant built, as one zip. */
export function workspaceZipUrl(): string {
  return `${API_BASE_URL}/coder/download-all`;
}
