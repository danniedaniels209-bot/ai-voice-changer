import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { listVoices, listCustomVoices } from "../api/voices";
import {
  analyzeScript,
  narrationAudioUrl,
  narrationExportUrl,
  previewSegment,
  renderNarration,
  uploadScriptFile,
  type AnalyzeResult,
  type NarrationControls,
  type NarrationSegment,
} from "../api/narration";
import type { CustomVoiceInfo, VoiceInfo } from "../types/api";
import {
  assistAction,
  generateOutline,
  generateScript,
  scriptgenStatus,
  type GenSettings,
  type ScriptgenStatus,
} from "../api/scriptgen";

const MODES = [
  "professional", "educational", "youtube", "podcast", "documentary",
  "news", "storytelling", "cinematic", "conversational", "tutorial",
];

const KIND_BADGES: Record<string, string> = {
  heading: "bg-accent/20 text-accent",
  sentence: "bg-surface text-text-muted",
  list_item: "bg-success/15 text-success",
  quote: "bg-warning/15 text-warning",
  dialogue: "bg-warning/15 text-warning",
  code: "bg-danger/15 text-danger",
};

const DEFAULT_CONTROLS: NarrationControls = {
  speed: 0, pitch: 0, energy: 0, expression: 50,
  stability: 70, naturalness: 70, pause_scale: 100,
};

const CONTENT_TYPES = ["Tutorial", "Documentary", "YouTube", "Podcast", "News", "Technical", "Story", "Advertisement"];
const AUDIENCES = ["Beginners", "Intermediate", "Advanced", "Developers", "General Audience"];
const LENGTHS = ["30s", "1m", "3m", "5m", "10m", "15m"];
const TONES = ["Professional", "Friendly", "Exciting", "Educational", "Conversational", "Technical", "Cinematic"];
const ASSIST_ACTIONS = [
  "rewrite", "continue", "summarize", "expand", "simplify", "explain",
  "engaging", "technical", "grammar", "change_tone", "intro", "conclusion",
  "cta", "titles", "description", "chapters", "thumbnails", "keywords",
];
// Actions whose output is reference material, not script replacement text.
const SIDE_OUTPUT = new Set(["titles", "description", "chapters", "thumbnails", "keywords"]);

export function Studio() {
  const [script, setScript] = useState("");
  const [mode, setMode] = useState("professional");
  const [engine, setEngine] = useState<"edge" | "chatterbox">("edge");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [customVoices, setCustomVoices] = useState<CustomVoiceInfo[]>([]);
  const [narratorVoice, setNarratorVoice] = useState("en-US-GuyNeural");
  const [quoteVoice, setQuoteVoice] = useState<string>("");
  const [codePolicy, setCodePolicy] = useState("skip");
  const [controls, setControls] = useState<NarrationControls>(DEFAULT_CONTROLS);

  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{ duration: number } | null>(null);
  const [exportFormat, setExportFormat] = useState("mp3");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");

  const [genStatus, setGenStatus] = useState<ScriptgenStatus | null>(null);
  const [topic, setTopic] = useState("");
  const [genSettings, setGenSettings] = useState<GenSettings>({
    content_type: "YouTube", audience: "General Audience", length: "3m", tone: "Professional",
  });
  const [outlineText, setOutlineText] = useState("");
  const [assistOutput, setAssistOutput] = useState("");
  const [assistChoice, setAssistChoice] = useState("rewrite");
  const scriptRef = useRef<HTMLTextAreaElement | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seedsRef = useRef<Record<number, number>>({});

  useEffect(() => {
    scriptgenStatus().then(setGenStatus).catch(() => setGenStatus(null));
    listVoices().then(setVoices).catch(() => {});
    listCustomVoices().then(setCustomVoices).catch(() => {});
    return () => audioRef.current?.pause();
  }, []);

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estMinutes = (words / 150).toFixed(1);

  async function handleUpload(file: File) {
    setError(null);
    try {
      const { script: text } = await uploadScriptFile(file);
      setScript(text);
      setResult(null);
      setRendered(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOutline() {
    setBusy("Generating outline (AI)...");
    setError(null);
    try {
      const r = await generateOutline(topic, genSettings);
      setOutlineText(r.outline.join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerateScript() {
    setBusy("Writing the script (AI) — long scripts take a couple of minutes...");
    setError(null);
    try {
      const sections = outlineText.split("\n").map((l) => l.trim()).filter(Boolean);
      const r = await generateScript(topic, sections, genSettings);
      setScript(r.script);
      setResult(null);
      setRendered(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleAssist() {
    const ta = scriptRef.current;
    const hasSelection = ta !== null && ta.selectionStart !== ta.selectionEnd;
    const target = hasSelection && ta ? script.slice(ta.selectionStart, ta.selectionEnd) : script;
    if (!target.trim()) return;
    setBusy(`AI: ${assistChoice}...`);
    setError(null);
    try {
      const r = await assistAction(assistChoice, target, genSettings);
      if (SIDE_OUTPUT.has(assistChoice)) {
        setAssistOutput(r.result);
      } else if (assistChoice === "continue") {
        setScript((s) => s + "\n\n" + r.result);
        setResult(null);
      } else if (hasSelection && ta) {
        setScript(script.slice(0, ta.selectionStart) + r.result + script.slice(ta.selectionEnd));
        setResult(null);
      } else {
        setScript(r.result);
        setResult(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleAnalyze() {
    setBusy("Analyzing script...");
    setError(null);
    setRendered(null);
    try {
      const r = await analyzeScript({
        script,
        mode,
        narrator_voice: narratorVoice,
        quote_voice: quoteVoice || null,
        code_policy: codePolicy,
        controls,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function playSegment(seg: NarrationSegment, regenerate: boolean) {
    if (!result) return;
    audioRef.current?.pause();
    setPlayingId(seg.id);
    setError(null);
    if (regenerate) seedsRef.current[seg.id] = (seedsRef.current[seg.id] ?? 0) + 1;
    try {
      const url = await previewSegment({
        studio_id: result.studio_id,
        segment: seg,
        engine,
        stability: controls.stability,
        regenerate,
        seed: seedsRef.current[seg.id] ?? 0,
      });
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingId(null);
      await audio.play();
    } catch (e) {
      setPlayingId(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function updateSegment(id: number, patch: Partial<NarrationSegment>) {
    setResult((r) =>
      r
        ? {
            ...r,
            segments: r.segments.map((s) =>
              s.id === id ? { ...s, ...patch, speak_text: patch.text ?? s.speak_text } : s,
            ),
          }
        : r,
    );
  }

  async function handleRender() {
    if (!result) return;
    setBusy(engine === "chatterbox" ? "Generating narration (local engine — this takes a while on CPU)..." : "Generating narration...");
    setError(null);
    try {
      const r = await renderNarration({
        studio_id: result.studio_id,
        segments: result.segments,
        engine,
        stability: controls.stability,
        naturalness: controls.naturalness,
      });
      setRendered({ duration: r.duration });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function handleReplaceAll() {
    if (!find) return;
    setScript((s) => s.split(find).join(replace));
    setResult(null);
  }

  const slider = (
    label: string,
    key: keyof NarrationControls,
    min: number,
    max: number,
  ) => (
    <label className="text-sm">
      <div className="flex justify-between mb-1">
        <span>{label}</span>
        <span className="text-text-muted">{controls[key]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={controls[key]}
        onChange={(e) => setControls((c) => ({ ...c, [key]: Number(e.target.value) }))}
        className="w-full"
      />
    </label>
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-1">Narration Studio</h2>
        <p className="text-text-muted text-sm">
          Write or upload a script. The studio analyzes it — structure, questions, emphasis,
          technical terms, code — and directs the voice segment by segment. Preview and
          regenerate any section before exporting.
        </p>
      </div>

      <section className="border border-border rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Start from a topic <span className="text-text-muted font-normal">(AI Script Studio)</span>
          </h3>
          {genStatus && !genStatus.available && (
            <span className="text-xs text-warning">{genStatus.reason}</span>
          )}
        </div>
        <div className="grid grid-cols-5 gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic, question, or title..."
            disabled={!genStatus?.available}
            className="col-span-2 bg-surface border border-border rounded-md px-3 py-2 text-sm disabled:opacity-50"
          />
          <select
            value={genSettings.content_type}
            disabled={!genStatus?.available}
            onChange={(e) => setGenSettings((g) => ({ ...g, content_type: e.target.value }))}
            className="bg-surface border border-border rounded-md px-2 py-2 text-sm disabled:opacity-50"
          >
            {CONTENT_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            value={genSettings.audience}
            disabled={!genStatus?.available}
            onChange={(e) => setGenSettings((g) => ({ ...g, audience: e.target.value }))}
            className="bg-surface border border-border rounded-md px-2 py-2 text-sm disabled:opacity-50"
          >
            {AUDIENCES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            value={genSettings.length}
            disabled={!genStatus?.available}
            onChange={(e) => setGenSettings((g) => ({ ...g, length: e.target.value }))}
            className="bg-surface border border-border rounded-md px-2 py-2 text-sm disabled:opacity-50"
          >
            {LENGTHS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={genSettings.tone}
            disabled={!genStatus?.available}
            onChange={(e) => setGenSettings((g) => ({ ...g, tone: e.target.value }))}
            className="bg-surface border border-border rounded-md px-2 py-2 text-sm disabled:opacity-50"
          >
            {TONES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <Button onClick={handleOutline} disabled={!genStatus?.available || !topic.trim() || busy !== null}>
            Generate outline
          </Button>
          {outlineText !== "" && (
            <Button onClick={handleGenerateScript} disabled={busy !== null}>
              Generate script from outline
            </Button>
          )}
        </div>
        {outlineText !== "" && (
          <div>
            <div className="text-xs text-text-muted mb-1">
              Outline — edit freely (one section per line), then generate the script:
            </div>
            <textarea
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              rows={6}
              className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm resize-y"
            />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-muted">1. Script</h3>
          <label className="text-xs text-accent cursor-pointer hover:underline">
            Upload .txt / .md / .docx
            <input
              type="file"
              accept=".txt,.md,.markdown,.docx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            />
          </label>
        </div>
        {genStatus?.available && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">AI assistant:</span>
            <select
              value={assistChoice}
              onChange={(e) => setAssistChoice(e.target.value)}
              className="bg-surface border border-border rounded px-2 py-1"
            >
              {ASSIST_ACTIONS.map((a) => <option key={a} value={a}>{a.replace("_", " ")}</option>)}
            </select>
            <button
              type="button"
              onClick={handleAssist}
              disabled={busy !== null || !script.trim()}
              className="rounded border border-border px-2 py-1 hover:border-accent/50 disabled:opacity-50"
            >
              Apply
            </button>
            <span className="text-text-muted">applies to selected text, or the whole script if nothing is selected</span>
          </div>
        )}
        <textarea
          ref={scriptRef}
          value={script}
          onChange={(e) => {
            setScript(e.target.value);
            setResult(null);
          }}
          rows={10}
          placeholder={"# My Video\n\nWrite your script here. Markdown headings, lists, quotes and code blocks are all understood.\n\nQuestions sound inquisitive? Exciting parts sound ENERGETIC!"}
          className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm font-mono resize-y"
        />
        <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
          <span>{words} words</span>
          <span>~{estMinutes} min narration</span>
          <span className="flex items-center gap-1">
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="find"
              className="w-24 bg-surface border border-border rounded px-2 py-1"
            />
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="replace"
              className="w-24 bg-surface border border-border rounded px-2 py-1"
            />
            <button type="button" onClick={handleReplaceAll} className="text-accent hover:underline">
              Replace all
            </button>
          </span>
        </div>
        {assistOutput !== "" && (
          <div className="rounded-md border border-border bg-surface p-3">
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>AI output ({assistChoice})</span>
              <button type="button" className="hover:text-danger" onClick={() => setAssistOutput("")}>x</button>
            </div>
            <pre className="text-xs whitespace-pre-wrap">{assistOutput}</pre>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium text-text-muted">2. Direction</h3>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-sm">
            <div className="text-text-muted mb-1">Narration mode</div>
            <select value={mode} onChange={(e) => { setMode(e.target.value); setResult(null); }}
              className="w-full bg-surface border border-border rounded-md px-3 py-2">
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <div className="text-text-muted mb-1">Narrator voice</div>
            <select value={narratorVoice} onChange={(e) => { setNarratorVoice(e.target.value); setResult(null); }}
              className="w-full bg-surface border border-border rounded-md px-3 py-2">
              {customVoices.length > 0 && (
                <optgroup label="My voices (local engine)">
                  {customVoices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </optgroup>
              )}
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <div className="text-text-muted mb-1">Quote / dialogue voice (optional)</div>
            <select value={quoteVoice} onChange={(e) => { setQuoteVoice(e.target.value); setResult(null); }}
              className="w-full bg-surface border border-border rounded-md px-3 py-2">
              <option value="">Same as narrator</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <div className="text-text-muted mb-1">Engine</div>
            <select value={engine} onChange={(e) => setEngine(e.target.value as "edge" | "chatterbox")}
              className="w-full bg-surface border border-border rounded-md px-3 py-2">
              <option value="edge">Fast (cloud voices)</option>
              <option value="chatterbox">Human-like (local, slower)</option>
            </select>
          </label>
          <label className="text-sm">
            <div className="text-text-muted mb-1">Code blocks</div>
            <select value={codePolicy} onChange={(e) => { setCodePolicy(e.target.value); setResult(null); }}
              className="w-full bg-surface border border-border rounded-md px-3 py-2">
              <option value="skip">Skip code</option>
              <option value="summarize">Summarize code</option>
              <option value="read">Read code</option>
              <option value="spell">Spell code</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {slider("Speed", "speed", -50, 50)}
          {slider("Pitch", "pitch", -50, 50)}
          {slider("Energy", "energy", -50, 50)}
          {slider("Expression", "expression", 0, 100)}
          {slider("Stability", "stability", 0, 100)}
          {slider("Naturalness", "naturalness", 0, 100)}
          {slider("Pause length", "pause_scale", 50, 200)}
        </div>

        <Button onClick={handleAnalyze} disabled={!script.trim() || busy !== null}>
          {busy === "Analyzing script..." ? "Analyzing..." : result ? "Re-analyze" : "Analyze script"}
        </Button>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}
      {busy && busy !== "Analyzing script..." && <p className="text-sm text-text-muted">{busy}</p>}

      {result && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-muted">
              3. Narration plan — {result.stats.segments} segments, ~
              {Math.round(result.stats.estimated_duration_seconds / 60 * 10) / 10} min
              {result.stats.code_blocks > 0 && `, ${result.stats.code_blocks} code block(s)`}
            </h3>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {result.segments.map((seg) => (
              <div
                key={seg.id}
                className={`rounded-md border p-2 text-sm flex items-start gap-2 ${
                  playingId === seg.id ? "border-accent bg-accent/10" : "border-border bg-surface"
                } ${seg.skipped ? "opacity-50" : ""}`}
              >
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${KIND_BADGES[seg.kind] ?? ""}`}>
                  {seg.kind === "sentence" ? seg.meta.sentence_type : seg.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <input
                    value={seg.text}
                    onChange={(e) => updateSegment(seg.id, { text: e.target.value })}
                    className="w-full bg-transparent outline-none"
                  />
                  {(seg.meta.emphasis_words.length > 0 || seg.meta.tech_terms.length > 0) && (
                    <p className="text-[10px] text-text-muted truncate">
                      {seg.meta.emphasis_words.length > 0 && `emphasis: ${seg.meta.emphasis_words.join(", ")} `}
                      {seg.meta.tech_terms.length > 0 && `tech: ${seg.meta.tech_terms.slice(0, 4).join(", ")}`}
                    </p>
                  )}
                </div>
                {!seg.skipped && (
                  <div className="shrink-0 flex gap-1">
                    <button type="button" title="Preview this section"
                      onClick={() => playSegment(seg, false)}
                      className="rounded border border-border px-2 py-0.5 text-xs hover:border-accent/50">
                      {playingId === seg.id ? "…" : "▶"}
                    </button>
                    <button type="button" title="Regenerate this section (new take)"
                      onClick={() => playSegment(seg, true)}
                      className="rounded border border-border px-2 py-0.5 text-xs hover:border-accent/50">
                      ↻
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleRender} disabled={busy !== null}>
              {busy && busy !== "Analyzing script..." ? "Generating..." : "Generate full narration"}
            </Button>
            {rendered && (
              <>
                <audio controls src={narrationAudioUrl(result.studio_id)} className="h-9" />
                <span className="text-xs text-text-muted">{rendered.duration.toFixed(1)}s</span>
                <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}
                  className="bg-surface border border-border rounded-md px-2 py-1.5 text-sm">
                  {["mp3", "wav", "flac", "aac", "ogg"].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <a href={narrationExportUrl(result.studio_id, exportFormat)} download
                  className="text-accent text-sm hover:underline">
                  ⬇ Download audio
                </a>
                <a href={narrationExportUrl(result.studio_id, "wav", true)} download
                  className="text-accent text-sm hover:underline">
                  ⬇ Subtitles (.srt)
                </a>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
