import { apiGet, apiPost } from "./client";

export interface GenSettings {
  content_type: string;
  audience: string;
  length: string;
  tone: string;
}

export interface ScriptgenStatus {
  available: boolean;
  reason: string;
  model: string;
  actions: string[];
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
  reply: string;
  tool_calls: ChatToolCall[];
}

export function chatWithLlm(messages: ChatMessage[]): Promise<ChatResponse> {
  return apiPost<ChatResponse>("/scriptgen/chat", { messages });
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
