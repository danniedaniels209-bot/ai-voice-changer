import { useEffect, useState } from "react";
import { ModelCard } from "../components/ModelCard";
import { Button } from "../components/Button";
import { listModels, importModel, deleteModel } from "../api/models";
import { listCustomVoices, uploadCustomVoice, deleteCustomVoice } from "../api/voices";
import { ApiError } from "../api/client";
import type { CustomVoiceInfo, RVCModelInfo } from "../types/api";

export function Models() {
  const [models, setModels] = useState<RVCModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [importName, setImportName] = useState("");
  const [pthFile, setPthFile] = useState<File | null>(null);
  const [indexFile, setIndexFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [customVoices, setCustomVoices] = useState<CustomVoiceInfo[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [voiceSample, setVoiceSample] = useState<File | null>(null);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);

  function refresh() {
    listModels()
      .then(setModels)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    listCustomVoices().then(setCustomVoices).catch(() => {});
  }

  useEffect(refresh, []);

  async function handleVoiceUpload() {
    if (!voiceName || !voiceSample) return;
    setIsUploadingVoice(true);
    setError(null);
    try {
      await uploadCustomVoice(voiceName, voiceSample);
      setVoiceName("");
      setVoiceSample(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setIsUploadingVoice(false);
    }
  }

  async function handleVoiceDelete(name: string) {
    try {
      await deleteCustomVoice(name);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleImport() {
    if (!importName || !pthFile) return;
    setIsImporting(true);
    setError(null);
    try {
      await importModel(importName, pthFile, indexFile);
      setImportName("");
      setPthFile(null);
      setIndexFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleDelete(name: string) {
    try {
      await deleteModel(name);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-1">Voice models</h2>
        <p className="text-text-muted text-sm">
          RVC models live in the project's <code className="text-xs">models/</code> folder.
          Import a <code className="text-xs">.pth</code> file (and optional{" "}
          <code className="text-xs">.index</code>) below, or drop them into that folder directly.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-text-muted">Import a model</h3>
        <input
          type="text"
          placeholder="Model name"
          value={importName}
          onChange={(e) => setImportName(e.target.value)}
          className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <div className="text-text-muted mb-1">Weights (.pth) — required</div>
            <input
              type="file"
              accept=".pth"
              onChange={(e) => setPthFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </label>
          <label className="text-sm">
            <div className="text-text-muted mb-1">Index (.index) — optional</div>
            <input
              type="file"
              accept=".index"
              onChange={(e) => setIndexFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </label>
        </div>
        <Button onClick={handleImport} disabled={!importName || !pthFile || isImporting}>
          {isImporting ? "Importing..." : "Import model"}
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-text-muted">My Voices (cloning)</h3>
        <p className="text-text-muted text-xs">
          Upload a clear 10-60 second recording of a voice — yours, or one you have permission
          to use. It becomes available in the voice picker (local engines only): narrate scripts
          in that voice without recording anything.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Voice name (e.g. My voice)"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm"
          />
          <input
            type="file"
            accept=".wav,.mp3,.m4a,.ogg,.webm,.flac"
            onChange={(e) => setVoiceSample(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
        </div>
        <Button onClick={handleVoiceUpload} disabled={!voiceName || !voiceSample || isUploadingVoice}>
          {isUploadingVoice ? "Uploading..." : "Add voice"}
        </Button>
        {customVoices.length > 0 && (
          <ul className="space-y-1">
            {customVoices.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              >
                <span>
                  {v.name}
                  <span className="text-text-muted"> — {v.size_mb} MB</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleVoiceDelete(v.name)}
                  className="text-text-muted hover:text-danger shrink-0"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-text-muted">Installed models</h3>
        {models.length === 0 && <p className="text-sm text-text-muted">No models yet.</p>}
        {models.map((model) => (
          <ModelCard key={model.name} model={model} onDelete={handleDelete} />
        ))}
      </section>
    </div>
  );
}
