import { apiGet, apiPost } from "./client";

export interface GenSettings {
  content_type: string;
  audience: string;
  length: string;
  tone: string;
}

export interface LlmModelInfo {
  key: string;
  label: string;
  download: string;
  /** False when this session's transformers can't load the architecture. */
  supported?: boolean;
  reason?: string;
}

export interface ScriptgenStatus {
  available: boolean;
  reason: string;
  model: string;
  active_model?: string;
  models?: LlmModelInfo[];
  actions: string[];
}

/** Ask a running chat turn to stop after its current step. */
export function stopChatRun(taskId: string): Promise<{ stopping: boolean }> {
  return apiPost<{ stopping: boolean }>(`/scriptgen/chat/${taskId}/stop`);
}

export function selectLlmModel(model: string): Promise<{ active_model: string }> {
  return apiPost<{ active_model: string }>("/scriptgen/model", { model });
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function scriptgenStatus(): Promise<ScriptgenStatus> {
  return apiGet<ScriptgenStatus>("/scriptgen/status");
}

export interface ChatToolCall {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ChatResponse {
  task_id: string;
  status: string;
  done: boolean;
  reply: string;
  /** The reply so far, updated live as the model generates it. */
  partial_reply: string;
  tool_calls: ChatToolCall[];
  error: string | null;
}

/**
 * Start a chat turn and poll until it's done. The model runs in a background
 * task server-side, so a long answer is never truncated by an HTTP or tunnel
 * timeout — `onProgress` reports thinking/tool steps as they happen.
 */
export async function chatWithLlm(
  messages: ChatMessage[],
  onProgress?: (update: ChatResponse) => void,
  onStart?: (taskId: string) => void,
): Promise<ChatResponse> {
  const { task_id } = await apiPost<{ task_id: string }>("/scriptgen/chat", { messages });
  onStart?.(task_id);
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const state = await apiGet<ChatResponse>(`/scriptgen/chat/${task_id}`);
    onProgress?.(state);
    if (state.done) {
      if (state.error) throw new Error(state.error);
      return state;
    }
  }
}

export function generateOutline(topic: string, settings: GenSettings): Promise<{ outline: string[] }> {
  return apiPost<{ outline: string[] }>("/scriptgen/outline", { topic, settings });
}

export function generateScript(
  topic: string,
  outline: string[],
  settings: GenSettings,
): Promise<{ script: string }> {
  return apiPost<{ script: string }>("/scriptgen/script", { topic, outline, settings });
}

export function assistAction(
  action: string,
  text: string,
  settings: GenSettings,
  tone?: string,
): Promise<{ result: string }> {
  return apiPost<{ result: string }>("/scriptgen/assist", { action, text, settings, tone });
}
