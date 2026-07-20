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
}

export interface ScriptgenStatus {
  available: boolean;
  reason: string;
  model: string;
  active_model?: string;
  models?: LlmModelInfo[];
  actions: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function scriptgenStatus(): Promise<ScriptgenStatus> {
  return apiGet<ScriptgenStatus>("/scriptgen/status");
}

export function selectLlmModel(model: string): Promise<{ active_model: string }> {
  return apiPost<{ active_model: string }>("/scriptgen/model", { model });
}

export function chatWithLlm(messages: ChatMessage[]): Promise<{ reply: string }> {
  return apiPost<{ reply: string }>("/scriptgen/chat", { messages });
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
