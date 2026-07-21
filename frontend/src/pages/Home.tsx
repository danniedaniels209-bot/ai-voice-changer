import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { FileDropzone } from "../components/FileDropzone";
import { Button } from "../components/Button";
import { listModels } from "../api/models";
import { listVoices, listCustomVoices, listDubLanguages } from "../api/voices";
import { getSettings, updateSettings } from "../api/settings";
import { uploadVideo, startConversion } from "../api/jobs";
import { ApiError, API_BASE_URL } from "../api/client";
import {
  DEFAULT_CONTINUITY,
  DEFAULT_VOICE_PARAMS,
  type ContinuitySettings,
  type CustomVoiceInfo,
  type ConversionMode,
  type RVCModelInfo,
  type VoiceConversionParams,
  type DubLanguage,
  type NarrationEngine,
  type VoiceInfo,
  type VoiceStyle,
} from "../types/api";

interface RvcPreset {
  label: string;
  description: string;
  params: Partial<VoiceConversionParams>;
}

const RVC_PRESETS: RvcPreset[] = [
  {
    label: "Male voice (auto pitch)",
    description: "Detects the speaker's pitch and shifts into a male range automatically",
    params: { auto_pitch: true, auto_pitch_target: "male", pitch_semitones: 0, protect: 0.3, index_rate: 0.6 },
  },
  {
    label: "Female voice (auto pitch)",
    description: "Detects the speaker's pitch and shifts into a female range automatically",
    params: { auto_pitch: true, auto_pitch_target: "female", pitch_semitones: 0, protect: 0.3, index_rate: 0.6 },
  },
  {
    label: "Same pitch",
    description: "No pitch change — use when speaker and model are the same gender",
    params: { auto_pitch: false, pitch_semitones: 0, protect: 0.33, index_rate: 0.5 },
  },
];

const MODE_OPTIONS: { id: ConversionMode; title: string; blurb: string }[] = [
  {
    id: "script",
    title: "Narrate my script",
    blurb: "Type what should be said — an AI voice narrates it over your video. Needs internet.",
  },
  {
    id: "tts",
    title: "Re-voice the speech",
    blurb: "Replaces existing speech with a polished AI voice — the \"AI ad\" sound. Needs internet.",
  },
  {
    id: "openvoice",
    title: "Expressive (OpenVoice)",
    blurb: "Keeps your full delivery — emotion, rhythm, accent — and takes the AI voice's timbre.",
  },
  {
    id: "rvc",
    title: "Voice model (RVC)",
    blurb: "Keeps the original delivery, changes the voice's timbre to a model from your library.",
  },
];

function Disclosure({
  title,
  hint,
  badge,
  children,
}: {
  title: string;
  hint: string;
  badge?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border border-border rounded-lg bg-surface/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left rounded-lg hover:bg-surface-hover/40 transition-colors"
      >
        <span>
          <span className="font-medium text-sm flex items-center gap-2">
            {title}
            {!!badge && (
              <span className="rounded-full bg-accent-dim text-accent text-xs px-2 py-0.5">
                {badge} on
              </span>
            )}
          </span>
          <span className="text-xs text-text-muted">{hint}</span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-text-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-5 pb-5 space-y-4 animate-rise-fast">{children}</div>}
    </section>
  );
}

export function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ConversionMode>("script");

  const [models, setModels] = useState<RVCModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [customVoices, setCustomVoices] = useState<CustomVoiceInfo[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [script, setScript] = useState("");
  const [skipSeparation, setSkipSeparation] = useState(false);
  const [compressOutput, setCompressOutput] = useState(false);
  const [precisionAlignment, setPrecisionAlignment] = useState(false);
  const [dubLanguages, setDubLanguages] = useState<DubLanguage[]>([]);
  const [dubLanguage, setDubLanguage] = useState<string>("");
  const [dubVoice, setDubVoice] = useState<string>("");
  const [subtitleLanguage, setSubtitleLanguage] = useState<string>("");
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>("standard");
  const [params, setParams] = useState<VoiceConversionParams>(DEFAULT_VOICE_PARAMS);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const [continuity, setContinuity] = useState<ContinuitySettings>(DEFAULT_CONTINUITY);
  const [narrationEngine, setNarrationEngine] = useState<NarrationEngine>("edge");
  const [exaggeration, setExaggeration] = useState(0.5);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [chainMode, setChainMode] = useState<"rvc" | "openvoice">("rvc");
  const [chainModel, setChainModel] = useState<string>("");
  const [chainVoice, setChainVoice] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

  useEffect(() => {
    listModels()
      .then((list) => {
        setModels(list);
        if (list.length > 0) {
          setSelectedModel(list[0].name);
          setChainModel(list[0].name);
        }
      })
      .catch((err) => setModelsError(err instanceof ApiError ? err.message : String(err)));

    listVoices()
      .then((list) => {
        setVoices(list);
        const def = list.find((v) => v.is_default) ?? list[0];
        if (def) {
          setSelectedVoice(def.id);
          setChainVoice(def.id);
        }
      })
      .catch((err) => setVoicesError(err instanceof ApiError ? err.message : String(err)));

    listDubLanguages()
      .then((r) => setDubLanguages(r.languages))
      .catch(() => {});

    getSettings()
      .then((s) => {
        setNarrationEngine(s.default_narration_engine);
        setSubtitlesOn(s.generate_subtitles);
        if (s.custom_voices) {
          listCustomVoices().then(setCustomVoices).catch(() => {});
        }
      })
      .catch(() => {}); // fall back to the built-in default

    return () => previewAudioRef.current?.pause();
  }, []);

  const chainValid =
    !chainEnabled || (chainMode === "rvc" ? chainModel !== "" : chainVoice !== "");

  const canStart =
    files.length > 0 &&
    !isSubmitting &&
    (mode === "rvc" ? selectedModel !== "" : selectedVoice !== "") &&
    (mode !== "script" || script.trim() !== "") &&
    chainValid;

  function applyPreset(preset: RvcPreset) {
    setParams((p) => ({ ...p, ...preset.params }));
    setActivePreset(preset.label);
  }

  function togglePreview(voiceId: string) {
    const current = previewAudioRef.current;
    if (current) {
      current.pause();
      previewAudioRef.current = null;
    }
    if (previewingVoice === voiceId) {
      setPreviewingVoice(null);
      return;
    }
    const audio = new Audio(`${API_BASE_URL}/voices/${voiceId}/preview`);
    audio.onended = () => setPreviewingVoice(null);
    audio.onerror = () => setPreviewingVoice(null);
    previewAudioRef.current = audio;
    setPreviewingVoice(voiceId);
    audio.play().catch(() => setPreviewingVoice(null));
  }

  async function handleStart() {
    if (!canStart) return;
    setIsSubmitting(true);
    setError(null);
    const jobIds: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        const label = files.length > 1 ? `Uploading ${i + 1} of ${files.length}: ${file.name}` : `Uploading ${file.name}`;
        setSubmitProgress(`${label}...`);
        const job = await uploadVideo(file, (pct) =>
          setSubmitProgress(`${label} — ${pct.toFixed(0)}%`),
        );
        await startConversion(job.id, {
          mode,
          model_name: mode === "rvc" ? selectedModel : null,
          tts_voice:
            mode === "tts" && dubLanguage && dubVoice
              ? dubVoice
              : selectedVoice || "en-US-GuyNeural",
          script: mode === "script" ? script : null,
          continuity,
          dub_language: mode === "tts" && dubLanguage ? dubLanguage : null,
          subtitle_language:
            (mode === "tts" || mode === "script") && subtitleLanguage
              ? subtitleLanguage
              : null,
          precision_alignment: mode === "tts" ? precisionAlignment : false,
          narration_engine: narrationEngine,
          exaggeration,
          chain: chainEnabled
            ? {
                mode: chainMode,
                model_name: chainMode === "rvc" ? chainModel : null,
                tts_voice: chainVoice || "en-US-GuyNeural",
              }
            : null,
          voice_style: mode === "rvc" ? voiceStyle : "standard",
          params,
          skip_separation: mode === "script" ? true : skipSeparation,
          compress_output: compressOutput,
        });
        jobIds.push(job.id);
      }
      navigate(jobIds.length === 1 ? `/processing/${jobIds[0]}` : "/processing");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setIsSubmitting(false);
      setSubmitProgress(null);
      if (jobIds.length > 0) {
        // Some conversions already started — surface them.
        navigate("/processing");
      }
    }
  }

  const showVoicePicker = mode === "tts" || mode === "script" || mode === "openvoice";
  const advancedCount = [
    mode === "tts" && precisionAlignment,
    continuity.enabled,
    chainEnabled,
    mode !== "script" && skipSeparation,
  ].filter(Boolean).length;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold mb-1">Create a voiced video</h2>
          <p className="text-text-muted text-sm">
            Upload one or more videos, choose how the voice should work, and convert. Background
            music and effects are preserved.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" onClick={() => navigate("/chat")}>
            Use Qwen (AI Chat)
          </Button>
          <Button variant="secondary" onClick={() => navigate("/studio")}>
            Script Studio
          </Button>
        </div>
      </div>

      <section>
        <h3 className="text-sm font-medium text-text-muted mb-2">1. Video(s)</h3>
        <FileDropzone files={files} onFilesSelected={setFiles} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setCompressOutput(false)}
            className={`rounded-md border px-4 py-3 text-left text-sm transition-colors ${
              !compressOutput
                ? "border-accent bg-accent/10"
                : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <span className="font-medium block">Original quality</span>
            <span className="text-text-muted text-xs">
              Video untouched, bit-exact — same size as your upload.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setCompressOutput(true)}
            className={`rounded-md border px-4 py-3 text-left text-sm transition-colors ${
              compressOutput
                ? "border-accent bg-accent/10"
                : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <span className="font-medium block">Smaller file</span>
            <span className="text-text-muted text-xs">
              Shrinks 200 MB+ CapCut-style exports several-fold. Visually
              identical — no quality you can see is lost.
            </span>
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-text-muted mb-2">Subtitles</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSubtitlesOn(true);
              updateSettings({ generate_subtitles: true }).catch(() => {});
            }}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              subtitlesOn
                ? "border-accent bg-accent/10 text-text"
                : "border-border bg-surface text-text-muted hover:border-accent/50"
            }`}
          >
            Add subtitles (.srt)
          </button>
          <button
            type="button"
            onClick={() => {
              setSubtitlesOn(false);
              updateSettings({ generate_subtitles: false }).catch(() => {});
            }}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              !subtitlesOn
                ? "border-accent bg-accent/10 text-text"
                : "border-border bg-surface text-text-muted hover:border-accent/50"
            }`}
          >
            No subtitles
          </button>
          {subtitlesOn && (mode === "tts" || mode === "script") && dubLanguages.length > 0 && (
            <select
              value={subtitleLanguage}
              onChange={(e) => setSubtitleLanguage(e.target.value)}
              title="Also export a translated subtitle file (needs GPU session)"
              className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm"
            >
              <option value="">+ English only</option>
              {dubLanguages.map((l) => (
                <option key={l.code} value={l.code}>+ {l.name} copy</option>
              ))}
            </select>
          )}
        </div>
        <p className="text-xs text-text-muted mt-2">
          Subtitles export as a separate .srt file next to the video — upload it to YouTube
          or turn on burned captions in Settings.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-text-muted mb-2">2. Voice</h3>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              className={`rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                mode === option.id
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface hover:border-accent/50"
              }`}
            >
              <span className="font-medium block">{option.title}</span>
              <span className="text-text-muted text-xs">{option.blurb}</span>
            </button>
          ))}
        </div>

        {mode === "script" && (
          <div className="mb-4">
            <label className="block text-sm mb-1 text-text-muted">Narration script</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={5}
              placeholder="Type what the narrator should say over your video. Sentences are spread across the video's length automatically."
              className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm resize-y"
            />
          </div>
        )}

        {showVoicePicker && (
          <>
            {voicesError && <p className="text-sm text-danger">Could not load voices: {voicesError}</p>}
            {!voicesError && (
              <div className="flex gap-2 items-start">
                <select
                  value={selectedVoice}
                  onChange={(e) => {
                    setSelectedVoice(e.target.value);
                    // Custom voices are cloned locally - the cloud engine can't use them.
                    if (e.target.value.startsWith("custom:")) setNarrationEngine("chatterbox");
                  }}
                  className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm"
                >
                  {customVoices.length > 0 && (
                    <optgroup label="My voices (cloned, local engine)">
                      {customVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {[...new Set(voices.map((v) => v.accent))].map((accent) => (
                    <optgroup key={accent} label={accent}>
                      {voices
                        .filter((v) => v.accent === accent)
                        .map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => selectedVoice && togglePreview(selectedVoice)}
                  className="shrink-0 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:border-accent/50"
                  title="Hear a sample of this voice"
                >
                  {previewingVoice === selectedVoice ? "■ Stop" : "▶ Preview"}
                </button>
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNarrationEngine("edge")}
                className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  narrationEngine === "edge"
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-accent/50"
                }`}
              >
                <span className="font-medium block text-sm">Fast (cloud)</span>
                Microsoft neural voices — quick, needs internet.
              </button>
              <button
                type="button"
                onClick={() => setNarrationEngine("chatterbox")}
                className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  narrationEngine === "chatterbox"
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-accent/50"
                }`}
              >
                <span className="font-medium block text-sm">Human-like (local)</span>
                Chatterbox — clones the chosen voice, emotion dial, slower on CPU.
              </button>
            </div>
            {narrationEngine === "chatterbox" && (
              <label className="block text-sm mt-3">
                <div className="flex justify-between mb-1">
                  <span>Expressiveness</span>
                  <span className="text-text-muted">
                    {exaggeration <= 0.2 ? "calm" : exaggeration >= 0.8 ? "dramatic" : "natural"} (
                    {exaggeration.toFixed(2)})
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={exaggeration}
                  onChange={(e) => setExaggeration(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            )}
            {mode === "tts" && dubLanguages.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <div className="text-text-muted mb-1">Dub into another language (needs GPU session)</div>
                  <select
                    value={dubLanguage}
                    onChange={(e) => {
                      const code = e.target.value;
                      setDubLanguage(code);
                      const lang = dubLanguages.find((l) => l.code === code);
                      setDubVoice(lang?.voices[0]?.id ?? "");
                    }}
                    className="w-full bg-surface border border-border rounded-md px-3 py-2"
                  >
                    <option value="">No - keep English</option>
                    {dubLanguages.map((l) => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))}
                  </select>
                </label>
                {dubLanguage && (
                  <label className="text-sm">
                    <div className="text-text-muted mb-1">Dubbing voice</div>
                    <select
                      value={dubVoice}
                      onChange={(e) => setDubVoice(e.target.value)}
                      className="w-full bg-surface border border-border rounded-md px-3 py-2"
                    >
                      {(dubLanguages.find((l) => l.code === dubLanguage)?.voices ?? []).map((v) => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {mode === "tts" && (
              <p className="text-xs text-text-muted mt-2">
                Note: this mode re-synthesizes the speech from text, so the original speaker's
                delivery is replaced by the AI voice's own style. To keep the original delivery,
                use Voice model (RVC) with "Preserve Speaking Style".
              </p>
            )}
          </>
        )}

        {mode === "rvc" && (
          <>
            {modelsError && <p className="text-sm text-danger">Could not load models: {modelsError}</p>}
            {!modelsError && models.length === 0 && (
              <p className="text-sm text-text-muted">
                No voice models found. Import one on the Models page first.
              </p>
            )}
            {models.length > 0 && (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm"
              >
                {models.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} {model.has_index ? "" : "(no index file)"}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </section>

      {mode === "rvc" && (
        <section>
          <h3 className="text-sm font-medium text-text-muted mb-3">3. Voice style</h3>
          <div className="space-y-2 mb-6">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="voice-style"
                checked={voiceStyle === "standard"}
                onChange={() => setVoiceStyle("standard")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium block">Standard Voice Conversion</span>
                <span className="text-text-muted text-xs">
                  Best voice similarity — the result sounds as close to the target voice as possible.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="voice-style"
                checked={voiceStyle === "preserve_prosody"}
                onChange={() => setVoiceStyle("preserve_prosody")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium block">Preserve Speaking Style (Experimental)</span>
                <span className="text-text-muted text-xs">
                  Keeps the original emphasis, intonation, rhythm, pauses, and loudness dynamics —
                  only the voice identity changes. Slightly less similar to the target voice.
                </span>
              </span>
            </label>
          </div>

          <h3 className="text-sm font-medium text-text-muted mb-3">4. Voice settings</h3>

          <div className="flex flex-wrap gap-2 mb-4">
            {RVC_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                title={preset.description}
                onClick={() => applyPreset(preset)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  activePreset === preset.label
                    ? "border-accent bg-accent/10 text-text"
                    : "border-border bg-surface text-text-muted hover:border-accent/50"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className={`text-sm ${params.auto_pitch ? "opacity-50" : ""}`}>
              <div className="flex justify-between mb-1">
                <span>Pitch adjustment</span>
                <span className="text-text-muted">
                  {params.auto_pitch ? "auto" : `${params.pitch_semitones} semitones`}
                </span>
              </div>
              <input
                type="range"
                min={-24}
                max={24}
                value={params.pitch_semitones}
                disabled={params.auto_pitch}
                onChange={(e) => {
                  setParams((p) => ({ ...p, pitch_semitones: Number(e.target.value) }));
                  setActivePreset(null);
                }}
                className="w-full"
              />
            </label>

            <label className="text-sm">
              <div className="flex justify-between mb-1">
                <span>Index ratio</span>
                <span className="text-text-muted">{params.index_rate.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={params.index_rate}
                onChange={(e) => {
                  setParams((p) => ({ ...p, index_rate: Number(e.target.value) }));
                  setActivePreset(null);
                }}
                className="w-full"
              />
            </label>

            <label className="text-sm">
              <div className="flex justify-between mb-1">
                <span>Voice protection</span>
                <span className="text-text-muted">{params.protect.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={params.protect}
                onChange={(e) => {
                  setParams((p) => ({ ...p, protect: Number(e.target.value) }));
                  setActivePreset(null);
                }}
                className="w-full"
              />
            </label>

            <label className="text-sm">
              <div className="mb-1">Pitch extraction method</div>
              <select
                value={params.f0_method}
                onChange={(e) =>
                  setParams((p) => ({ ...p, f0_method: e.target.value as VoiceConversionParams["f0_method"] }))
                }
                className="w-full bg-surface border border-border rounded-md px-3 py-2"
              >
                <option value="rmvpe">RMVPE (best quality)</option>
                <option value="harvest">Harvest</option>
                <option value="crepe">Crepe</option>
                <option value="pm">PM (fastest)</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 mt-4 text-sm">
            <input
              type="checkbox"
              checked={params.auto_pitch}
              onChange={(e) => {
                setParams((p) => ({ ...p, auto_pitch: e.target.checked }));
                setActivePreset(null);
              }}
            />
            <span>
              Auto pitch — detect the speaker's pitch and shift toward a{" "}
              <select
                value={params.auto_pitch_target}
                disabled={!params.auto_pitch}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    auto_pitch_target: e.target.value as "male" | "female",
                  }))
                }
                className="bg-surface border border-border rounded px-1 py-0.5 text-sm"
              >
                <option value="male">male</option>
                <option value="female">female</option>
              </select>{" "}
              speaking range
            </span>
          </label>
        </section>
      )}

      <Disclosure
        title="Advanced options"
        hint="Continuity, merge modes, precision placement — the defaults are right for most videos"
        badge={advancedCount}
      >
        {mode === "tts" && (
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={precisionAlignment}
              onChange={(e) => setPrecisionAlignment(e.target.checked)}
            />
            <span>
              <span className="font-medium block">Precision word placement (Beta)</span>
              <span className="text-text-muted text-xs">
                Anchors each phrase exactly where the original words were spoken — best
                lip-sync accuracy, slightly less flowing delivery. Off = smoother flow.
              </span>
            </span>
          </label>
        )}

        <div className="border-t border-border pt-4 space-y-3">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={continuity.enabled}
            onChange={(e) => setContinuity((c) => ({ ...c, enabled: e.target.checked }))}
          />
          <span>
            <span className="font-medium block">Natural continuity (Beta)</span>
            <span className="text-text-muted text-xs">
              Makes the result sound like one continuous performance: merges speech across brief
              pauses, keeps the voice's energy and identity consistent between segments, and
              smooths boundaries so you can't hear where processing happened.
            </span>
          </span>
        </label>

        {continuity.enabled && (
          <div className="space-y-4 pl-6">
            <label className="block text-sm">
              <div className="flex justify-between mb-1">
                <span>Context window</span>
                <span className="text-text-muted">
                  {continuity.context_window <= 0.33
                    ? "short"
                    : continuity.context_window >= 0.67
                      ? "long"
                      : "medium"}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={continuity.context_window}
                onChange={(e) =>
                  setContinuity((c) => ({ ...c, context_window: Number(e.target.value) }))
                }
                className="w-full"
              />
              <p className="text-xs text-text-muted">
                How much previous speech is considered — longer windows build bigger phrases and
                remember the delivery trend further back.
              </p>
            </label>

            <div className="grid grid-cols-3 gap-4">
              <label className="text-sm">
                <div className="flex justify-between mb-1">
                  <span>Voice stability</span>
                  <span className="text-text-muted">{continuity.voice_stability}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={continuity.voice_stability}
                  onChange={(e) =>
                    setContinuity((c) => ({ ...c, voice_stability: Number(e.target.value) }))
                  }
                  className="w-full"
                />
              </label>
              <label className="text-sm">
                <div className="flex justify-between mb-1">
                  <span>Prosody</span>
                  <span className="text-text-muted">{continuity.prosody_preservation}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={continuity.prosody_preservation}
                  onChange={(e) =>
                    setContinuity((c) => ({ ...c, prosody_preservation: Number(e.target.value) }))
                  }
                  className="w-full"
                />
              </label>
              <label className="text-sm">
                <div className="flex justify-between mb-1">
                  <span>Naturalness</span>
                  <span className="text-text-muted">{continuity.naturalness}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={continuity.naturalness}
                  onChange={(e) =>
                    setContinuity((c) => ({ ...c, naturalness: Number(e.target.value) }))
                  }
                  className="w-full"
                />
              </label>
            </div>

            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={continuity.adaptive_segmentation}
                  onChange={(e) =>
                    setContinuity((c) => ({ ...c, adaptive_segmentation: e.target.checked }))
                  }
                />
                <span>Adaptive segmentation</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={continuity.rolling_memory}
                  onChange={(e) =>
                    setContinuity((c) => ({ ...c, rolling_memory: e.target.checked }))
                  }
                />
                <span>Rolling context memory</span>
              </label>
            </div>
          </div>
        )}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={chainEnabled}
            onChange={(e) => setChainEnabled(e.target.checked)}
          />
          <span>
            <span className="font-medium block">Merge modes — add a second conversion</span>
            <span className="text-text-muted text-xs">
              The voice produced above gets converted once more. Example: narrate a script with
              Guy, then convert that narration with your RVC model — the narration takes the
              model's voice.
            </span>
          </span>
        </label>

        {chainEnabled && (
          <div className="grid grid-cols-2 gap-3 pl-6">
            <label className="text-sm">
              <div className="text-text-muted mb-1">Then convert with</div>
              <select
                value={chainMode}
                onChange={(e) => setChainMode(e.target.value as "rvc" | "openvoice")}
                className="w-full bg-surface border border-border rounded-md px-3 py-2"
              >
                <option value="rvc">RVC voice model</option>
                <option value="openvoice">Expressive (OpenVoice)</option>
              </select>
            </label>

            {chainMode === "rvc" ? (
              <label className="text-sm">
                <div className="text-text-muted mb-1">Voice model</div>
                <select
                  value={chainModel}
                  onChange={(e) => setChainModel(e.target.value)}
                  className="w-full bg-surface border border-border rounded-md px-3 py-2"
                >
                  {models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-sm">
                <div className="text-text-muted mb-1">Target voice</div>
                <select
                  value={chainVoice}
                  onChange={(e) => setChainVoice(e.target.value)}
                  className="w-full bg-surface border border-border rounded-md px-3 py-2"
                >
                  {voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        </div>

        {mode !== "script" && (
          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skipSeparation}
                onChange={(e) => setSkipSeparation(e.target.checked)}
              />
              <span>Skip background separation (video has no background music)</span>
            </label>
          </div>
        )}
      </Disclosure>

      {error && <p className="text-sm text-danger">{error}</p>}
      {submitProgress && <p className="text-sm text-text-muted">{submitProgress}</p>}

      <div className="space-y-2">
        <Button onClick={handleStart} disabled={!canStart} className="w-full py-3 text-base">
          {isSubmitting
            ? "Starting..."
            : files.length > 1
              ? `Start ${files.length} conversions`
              : "Start conversion"}
        </Button>
        {!canStart && !isSubmitting && (
          <p className="text-xs text-text-muted text-center">
            {files.length === 0
              ? "Add a video above to get started."
              : mode === "script"
                ? "Write the narration script to continue."
                : "Pick a voice to continue."}
          </p>
        )}
      </div>
    </div>
  );
}
