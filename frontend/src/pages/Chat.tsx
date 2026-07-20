import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import {
  chatWithLlm,
  scriptgenStatus,
  selectLlmModel,
  type ChatMessage,
  type ScriptgenStatus,
} from "../api/scriptgen";
import { ApiError } from "../api/client";

// Starter prompts for the assistant actions — clicking a chip drops the
// instruction into the input so the user just pastes their text after it.
const ACTION_PROMPTS: Record<string, { label: string; prompt: string }> = {
  rewrite: { label: "Rewrite", prompt: "Rewrite this, keeping the meaning but improving flow:\n\n" },
  continue: { label: "Continue", prompt: "Continue writing naturally from where this ends:\n\n" },
  summarize: { label: "Summarize", prompt: "Summarize this into a shorter passage:\n\n" },
  expand: { label: "Expand", prompt: "Expand this with more detail and examples:\n\n" },
  simplify: { label: "Simplify", prompt: "Simplify this so beginners understand it:\n\n" },
  explain: { label: "Explain", prompt: "Explain the concepts in this more clearly:\n\n" },
  engaging: { label: "Make engaging", prompt: "Make this more engaging and energetic for viewers:\n\n" },
  technical: { label: "More technical", prompt: "Rewrite this with more technical depth:\n\n" },
  grammar: { label: "Fix grammar", prompt: "Fix the grammar and awkward phrasing in this:\n\n" },
  change_tone: { label: "Change tone", prompt: "Rewrite this in a friendly tone:\n\n" },
  intro: { label: "Write intro", prompt: "Write a strong introduction for a script about:\n\n" },
  conclusion: { label: "Write conclusion", prompt: "Write a strong conclusion for this script:\n\n" },
  cta: { label: "Call to action", prompt: "Write a short call-to-action for this content:\n\n" },
  titles: { label: "Video titles", prompt: "Suggest 8 compelling video titles for this script:\n\n" },
  description: { label: "Description", prompt: "Write a YouTube description for this script:\n\n" },
  chapters: { label: "Chapters", prompt: "Create YouTube chapter titles for this script:\n\n" },
  thumbnails: { label: "Thumbnails", prompt: "Suggest 5 thumbnail concepts for this script:\n\n" },
  keywords: { label: "Keywords", prompt: "List 15 SEO keywords/tags for this script:\n\n" },
};

export function Chat() {
  const [status, setStatus] = useState<ScriptgenStatus | null>(null);
  const [model, setModel] = useState("qwen");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scriptgenStatus()
      .then((s) => {
        setStatus(s);
        if (s.active_model) setModel(s.active_model);
      })
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function handleModelChange(key: string) {
    setModel(key);
    setError(null);
    try {
      await selectLlmModel(key);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      // Send only the recent turns — the model's context is finite.
      const { reply } = await chatWithLlm(next.slice(-20));
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setMessages(messages); // roll back the optimistic user turn
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  function insertAction(key: string) {
    const action = ACTION_PROMPTS[key];
    if (!action) return;
    setInput(action.prompt);
    inputRef.current?.focus();
  }

  const available = status?.available ?? false;
  const models = status?.models ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold mb-1">AI Chat</h2>
          <p className="text-text-muted text-sm">
            Chat with the local model — brainstorm, rewrite, or generate anything for your videos.
          </p>
        </div>
        {models.length > 0 && (
          <label className="text-sm shrink-0">
            <div className="text-text-muted mb-1">Model</div>
            <select
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={busy}
              className="bg-surface border border-border rounded-md px-3 py-2"
            >
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} — {m.download}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {status && !available && (
        <div className="rounded-md border border-warning/30 bg-warning/10 text-warning text-sm px-4 py-3">
          {status.reason}
        </div>
      )}
      {status === null && (
        <div className="rounded-md border border-border bg-surface text-text-muted text-sm px-4 py-3">
          Backend not reachable — start the app first.
        </div>
      )}

      <div className="rounded-md border border-border bg-surface min-h-[320px] max-h-[55vh] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-text-muted text-sm">
            No messages yet. Pick an action below or just start typing.
            {model === "gpt-oss" && " First GPT-OSS message downloads ~13 GB — Qwen is faster on a T4."}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-accent text-white" : "bg-bg border border-border"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-text-muted text-sm animate-pulse">Thinking...</div>}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(status?.actions ?? Object.keys(ACTION_PROMPTS)).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => insertAction(key)}
            disabled={!available}
            className="px-2.5 py-1 rounded-full border border-border bg-surface hover:border-accent/50 text-xs text-text-muted hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {ACTION_PROMPTS[key]?.label ?? key}
          </button>
        ))}
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={3}
          placeholder={available ? "Type a message... (Enter to send, Shift+Enter for a new line)" : "Needs a GPU session"}
          disabled={!available || busy}
          className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm resize-y disabled:opacity-40"
        />
        <Button onClick={handleSend} disabled={!available || busy || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
