import { useEffect, useRef, useState } from "react";
import {
  FolderUp,
  FileUp,
  Trash2,
  Download,
  Package,
  Save,
  Send,
  Square,
  Wrench,
} from "lucide-react";
import { Button } from "../components/Button";
import { ApiError } from "../api/client";
import {
  clearWorkspace,
  coderChat,
  coderStatus,
  deleteWorkspaceFile,
  readWorkspaceFile,
  stopCoderRun,
  uploadToWorkspace,
  workspaceDownloadUrl,
  workspaceZipUrl,
  writeWorkspaceFile,
  type CoderStatus,
  type CoderToolCall,
} from "../api/coder";
import { selectLlmModel } from "../api/scriptgen";

type Message = {
  role: "user" | "assistant";
  content: string;
  steps?: CoderToolCall[];
};

/** One line of the agent's activity — what it's doing, and what came back. */
function StepRow({ step }: { step: CoderToolCall }) {
  const [open, setOpen] = useState(false);
  const icon = step.running ? "◌" : step.ok === false ? "✕" : "✓";
  const tone = step.running
    ? "text-accent"
    : step.ok === false
      ? "text-danger"
      : "text-success";
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => step.output && setOpen((o) => !o)}
        className={`w-full text-left flex items-start gap-2 py-0.5 rounded hover:bg-surface-hover/50 transition-colors ${
          step.output ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className={`${tone} ${step.running ? "animate-pulse" : ""} shrink-0`}>
          {icon}
        </span>
        <span className="font-mono text-text-muted truncate flex-1">
          {step.note ?? step.tool}
        </span>
        {step.output && (
          <span className="text-text-faint shrink-0">{open ? "hide" : "output"}</span>
        )}
      </button>
      {open && step.output && (
        <pre className="mt-1 mb-2 ml-5 p-2 rounded bg-bg border border-border text-[11px] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
          {step.output}
        </pre>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  "Build a to-do web app with a Flask backend.",
  "Create a Python CLI that renames files in bulk.",
  "Explain what these files do.",
  "Find and fix any bugs, then run the tests.",
];

export function Coder() {
  const [status, setStatus] = useState<CoderStatus | null>(null);
  const [model, setModel] = useState("coder");
  const [files, setFiles] = useState<string[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ status: string; steps: CoderToolCall[] } | null>(
    null,
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    coderStatus()
      .then((s) => {
        setStatus(s);
        setFiles(s.files);
        if (s.active_model) setModel(s.active_model);
      })
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    // Give the browser a tick to paint the new bubble before scrolling.
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // A directory input needs the non-standard attribute set imperatively.
  useEffect(() => {
    if (dirRef.current) {
      dirRef.current.setAttribute("webkitdirectory", "");
      dirRef.current.setAttribute("directory", "");
    }
  }, []);

  async function handleUpload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setUploading(`Uploading ${list.length} file(s)…`);
    try {
      const res = await uploadToWorkspace(Array.from(list), (pct) =>
        setUploading(`Uploading ${list.length} file(s)… ${pct.toFixed(0)}%`),
      );
      setFiles(res.files);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setUploading(null);
    }
  }

  async function openFile(path: string) {
    setError(null);
    try {
      const text = await readWorkspaceFile(path);
      setOpenPath(path);
      setOpenContent(text);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveOpenFile() {
    if (!openPath) return;
    try {
      const res = await writeWorkspaceFile(openPath, openContent);
      setFiles(res.files);
      setDirty(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function removeFile(path: string) {
    try {
      const res = await deleteWorkspaceFile(path);
      setFiles(res.files);
      if (openPath === path) {
        setOpenPath(null);
        setOpenContent("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleClear() {
    if (!window.confirm("Remove every file from the coder workspace?")) return;
    try {
      await clearWorkspace();
      setFiles([]);
      setOpenPath(null);
      setOpenContent("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function send(text: string) {
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    setProgress({ status: "starting", steps: [] });
    setError(null);
    try {
      const res = await coderChat(
        next.map(({ role, content }) => ({ role, content })),
        (update) => {
          setProgress({ status: update.status, steps: update.tool_calls });
          setFiles(update.files);
        },
        setRunId,
      );
      setMessages([
        ...next,
        { role: "assistant", content: res.reply, steps: res.tool_calls },
      ]);
      setFiles(res.files);
      // The assistant may have rewritten the file currently on screen.
      if (openPath && res.tool_calls.some((t) => t.tool === "write_file")) {
        readWorkspaceFile(openPath)
          .then((t) => {
            setOpenContent(t);
            setDirty(false);
          })
          .catch(() => {});
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setMessages(messages);
      setInput(text);
    } finally {
      setBusy(false);
      setProgress(null);
      setRunId(null);
      setStopping(false);
    }
  }

  async function handleStop() {
    if (!runId) return;
    setStopping(true);
    try {
      await stopCoderRun(runId);
    } catch {
      // The run may have just finished on its own — nothing to report.
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text || busy || !available) return;
    setInput("");
    void send(text);
  }

  async function handleModelChange(key: string) {
    setModel(key);
    try {
      await selectLlmModel(key);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const available = status?.available ?? false;
  const models = status?.models ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold mb-1">Coder</h2>
          <p className="text-text-muted text-sm">
            Ask for a whole app or upload existing code. The AI creates folders and files,
            installs what's missing, runs commands and tests its work — then you download it all.
          </p>
        </div>
        {models.length > 0 && (
          <label className="text-sm shrink-0">
            <div className="text-text-muted mb-1 text-xs">Model</div>
            <select
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={busy}
              className="bg-surface border border-border rounded-md px-3 py-2"
            >
              {models.map((m) => (
                <option key={m.key} value={m.key} disabled={m.supported === false}>
                  {m.label}
                  {m.supported === false ? " (unavailable this session)" : ""}
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
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* ── Workspace files ── */}
        <aside className="rounded-lg border border-border bg-surface/50 p-3 space-y-3 self-start">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Workspace</span>
            <div className="flex items-center gap-2">
              {files.length > 0 && (
                <a
                  href={workspaceZipUrl()}
                  download
                  title="Download everything as a .zip"
                  className="text-text-muted hover:text-accent transition-colors"
                >
                  <Package size={14} />
                </a>
              )}
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  title="Clear the workspace"
                  className="text-text-muted hover:text-danger transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {files.length > 0 && (
            <a
              href={workspaceZipUrl()}
              download
              className="block text-center text-xs rounded-md border border-accent/40 text-accent hover:bg-accent/10 py-1.5 transition-colors"
            >
              ⬇ Download all ({files.length} files)
            </a>
          )}

          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={dirRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 !px-2 text-xs"
              onClick={() => fileRef.current?.click()}
            >
              <span className="flex items-center justify-center gap-1.5">
                <FileUp size={14} /> Files
              </span>
            </Button>
            <Button
              variant="secondary"
              className="flex-1 !px-2 text-xs"
              onClick={() => dirRef.current?.click()}
            >
              <span className="flex items-center justify-center gap-1.5">
                <FolderUp size={14} /> Folder
              </span>
            </Button>
          </div>

          {uploading && <p className="text-xs text-text-muted animate-pulse">{uploading}</p>}

          {files.length === 0 ? (
            <p className="text-xs text-text-muted">
              No files yet. Upload some, or just ask the AI to create them.
            </p>
          ) : (
            <ul className="space-y-0.5 max-h-[50vh] overflow-y-auto">
              {files.map((f) => (
                <li key={f} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openFile(f)}
                    className={`flex-1 text-left text-xs font-mono truncate rounded px-2 py-1 transition-colors ${
                      openPath === f
                        ? "bg-accent-dim text-text"
                        : "text-text-muted hover:text-text hover:bg-surface-hover"
                    }`}
                    title={f}
                  >
                    {f}
                  </button>
                  <a
                    href={workspaceDownloadUrl(f)}
                    download
                    title="Download"
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text transition-opacity"
                  >
                    <Download size={13} />
                  </a>
                  <button
                    type="button"
                    onClick={() => removeFile(f)}
                    title="Delete"
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-opacity"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Editor + chat ── */}
        <div className="space-y-4 min-w-0">
          {openPath && (
            <div className="rounded-lg border border-border bg-surface/50">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-mono truncate">{openPath}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {dirty && <span className="text-xs text-warning">unsaved</span>}
                  <button
                    type="button"
                    onClick={saveOpenFile}
                    disabled={!dirty}
                    className="text-text-muted hover:text-text disabled:opacity-40 transition-colors"
                    title="Save"
                  >
                    <Save size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenPath(null)}
                    className="text-text-muted hover:text-text transition-colors text-xs"
                  >
                    close
                  </button>
                </div>
              </div>
              <textarea
                value={openContent}
                onChange={(e) => {
                  setOpenContent(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                className="w-full h-64 bg-bg font-mono text-xs p-3 resize-y outline-none rounded-b-lg"
              />
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface min-h-[280px] max-h-[50vh] overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-text-muted text-sm">
                  Describe what you want built, or upload code to work on. The AI scaffolds the
                  project, installs dependencies, runs it, and fixes what breaks.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!available}
                      onClick={() => setInput(s)}
                      className="px-2.5 py-1 rounded-full border border-border bg-surface hover:border-accent/50 text-xs text-text-muted hover:text-text transition-colors disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user" ? "bg-accent text-white" : "bg-bg border border-border"
                  }`}
                >
                  {m.steps && m.steps.length > 0 && (
                    <div className="mb-2 pb-2 border-b border-border space-y-0.5">
                      <div className="text-xs text-text-muted flex items-center gap-1 mb-1">
                        <Wrench size={11} /> {m.steps.length} step
                        {m.steps.length === 1 ? "" : "s"}
                      </div>
                      {m.steps.map((s, si) => (
                        <StepRow key={si} step={s} />
                      ))}
                    </div>
                  )}
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="rounded-lg border border-accent/30 bg-bg p-3 space-y-1">
                <div className="text-sm text-accent animate-pulse flex items-center gap-1.5">
                  <Wrench size={13} />
                  {!progress?.status || progress.status === "thinking"
                    ? "Thinking…"
                    : `${progress.status}…`}
                </div>
                {progress?.steps.map((s, i) => (
                  <StepRow key={i} step={s} />
                ))}
                <div className="text-xs text-text-faint pt-1">
                  Runs in the background — long builds keep going.
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={3}
              placeholder={
                available
                  ? "Ask the AI to build, fix, explain or test your code…"
                  : "Needs a GPU session"
              }
              disabled={!available || busy}
              className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm resize-y disabled:opacity-40"
            />
            {busy ? (
              <Button variant="danger" onClick={handleStop} disabled={!runId || stopping}>
                <span className="flex items-center gap-1.5">
                  <Square size={13} /> {stopping ? "Stopping…" : "Stop"}
                </span>
              </Button>
            ) : (
              <Button onClick={handleSend} disabled={!available || !input.trim()}>
                <span className="flex items-center gap-1.5">
                  <Send size={14} /> Send
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
