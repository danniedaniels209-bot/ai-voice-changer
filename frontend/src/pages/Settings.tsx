import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "../api/settings";
import { getHealth } from "../api/health";
import { ApiError } from "../api/client";
import type { AppSettings, HealthResponse } from "../types/api";

export function Settings() {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  // Cloud GPU backend: stored on THIS device (localStorage), not in the
  // backend's settings — it decides WHICH backend the app talks to.
  const [remoteEnabled, setRemoteEnabled] = useState(
    localStorage.getItem("avc_remote_enabled") === "1",
  );
  const [remoteUrl, setRemoteUrl] = useState(localStorage.getItem("avc_remote_url") ?? "");
  const [remoteToken, setRemoteToken] = useState(localStorage.getItem("avc_remote_token") ?? "");

  function saveRemote(enabled: boolean, url: string, token: string) {
    localStorage.setItem("avc_remote_enabled", enabled ? "1" : "0");
    localStorage.setItem("avc_remote_url", url.trim());
    localStorage.setItem("avc_remote_token", token.trim());
    setRemoteEnabled(enabled);
    setRemoteUrl(url);
    setRemoteToken(token);
    window.location.reload(); // the API client reads these at startup
  }
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    getSettings().then(setSettingsState).catch((err) => setError(String(err)));
    getHealth().then(setHealth).catch(() => {});
  }, []);

  async function save(patch: Partial<AppSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettingsState(next);
    setSaveState("saving");
    setError(null);
    try {
      const saved = await updateSettings(patch);
      setSettingsState(saved);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaveState("idle");
    }
  }

  if (!settings) {
    return <p className="text-text-muted">Loading settings...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-1">Settings</h2>
        <p className="text-text-muted text-sm">
          Changes save automatically.{" "}
          {saveState === "saving" && <span className="text-text-muted">Saving...</span>}
          {saveState === "saved" && <span className="text-success">Saved</span>}
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {health && (
        <section className="border border-border rounded-md p-4 text-sm space-y-1">
          <p>
            <span className="text-text-muted">FFmpeg: </span>
            {health.ffmpeg_found ? (
              <span className="text-success">found ({health.ffmpeg_path})</span>
            ) : (
              <span className="text-danger">not found</span>
            )}
          </p>
          <p>
            <span className="text-text-muted">Device: </span>
            <span>{health.hardware.resolved_device.toUpperCase()}</span>
            {health.hardware.device_name && ` — ${health.hardware.device_name}`}
          </p>
        </section>
      )}

      <section className="space-y-4">
        <label className="block text-sm">
          <div className="text-text-muted mb-1">Processing device</div>
          <select
            value={settings.device_mode}
            onChange={(e) => save({ device_mode: e.target.value as AppSettings["device_mode"] })}
            className="w-full bg-surface border border-border rounded-md px-3 py-2"
          >
            <option value="auto">Auto (use GPU if available)</option>
            <option value="cuda">Force GPU (CUDA)</option>
            <option value="cpu">Force CPU</option>
          </select>
          <p className="text-xs text-text-muted mt-1">
            Note: switching CPU/GPU mode takes effect on the next app restart for voice
            conversion specifically.
          </p>
        </label>

        <label className="block text-sm">
          <div className="text-text-muted mb-1">Export quality</div>
          <select
            value={settings.export_quality}
            onChange={(e) =>
              save({ export_quality: e.target.value as AppSettings["export_quality"] })
            }
            className="w-full bg-surface border border-border rounded-md px-3 py-2"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="lossless">Lossless</option>
          </select>
        </label>

        <label className="block text-sm">
          <div className="text-text-muted mb-1">Custom FFmpeg path (optional)</div>
          <input
            type="text"
            defaultValue={settings.ffmpeg_path ?? ""}
            placeholder="Leave blank to auto-detect"
            onBlur={(e) => save({ ffmpeg_path: e.target.value || null })}
            className="w-full bg-surface border border-border rounded-md px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <div className="text-text-muted mb-1">Temp folder override (optional)</div>
          <input
            type="text"
            defaultValue={settings.temp_dir ?? ""}
            placeholder="Leave blank to use temp/"
            onBlur={(e) => save({ temp_dir: e.target.value || null })}
            className="w-full bg-surface border border-border rounded-md px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <div className="text-text-muted mb-1">Export folder override (optional)</div>
          <input
            type="text"
            defaultValue={settings.export_dir ?? ""}
            placeholder="Leave blank to use exports/"
            onBlur={(e) => save({ export_dir: e.target.value || null })}
            className="w-full bg-surface border border-border rounded-md px-3 py-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.delete_temp_on_success}
            onChange={(e) => save({ delete_temp_on_success: e.target.checked })}
          />
          <span>Delete temporary files after a successful export</span>
        </label>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">Output features</h3>
          <p className="text-text-muted text-xs">
            Applied to every conversion. Toggle off anything you don't want.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.generate_subtitles}
            onChange={(e) => save({ generate_subtitles: e.target.checked })}
          />
          <span>
            <span className="block">Generate subtitles (.srt)</span>
            <span className="text-text-muted text-xs">
              Saves a subtitle file next to the export — upload it to YouTube for captions. AI
              narrator and script modes only.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.burn_captions}
            onChange={(e) => save({ burn_captions: e.target.checked })}
          />
          <span>
            <span className="block">Burn captions into the video</span>
            <span className="text-text-muted text-xs">
              Draws the captions onto the image (like Shorts/TikTok text). Requires "Generate
              subtitles" and re-encodes the video, so export takes longer.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.vertical_export}
            onChange={(e) => save({ vertical_export: e.target.checked })}
          />
          <span>
            <span className="block">Also export vertical (9:16) variant</span>
            <span className="text-text-muted text-xs">
              Center-crops a second copy sized for Shorts/Reels/TikTok (1080x1920).
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.music_ducking}
            onChange={(e) => save({ music_ducking: e.target.checked })}
          />
          <span>
            <span className="block">Music ducking</span>
            <span className="text-text-muted text-xs">
              Automatically lowers background music while the voice is speaking.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.loudness_normalization}
            onChange={(e) => save({ loudness_normalization: e.target.checked })}
          />
          <span>
            <span className="block">Loudness normalization (-14 LUFS)</span>
            <span className="text-text-muted text-xs">
              Matches YouTube's loudness standard so your videos aren't quieter or louder than
              everyone else's.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.segment_editor}
            onChange={(e) => save({ segment_editor: e.target.checked })}
          />
          <span>
            <span className="block">Segment editor</span>
            <span className="text-text-muted text-xs">
              Keep a finished conversion's narration editable: fix a sentence, get a new take,
              and re-export in seconds. Uses some temp disk space until the retention sweep.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.animated_captions}
            onChange={(e) => save({ animated_captions: e.target.checked })}
          />
          <span>
            <span className="block">Animated word-by-word captions</span>
            <span className="text-text-muted text-xs">
              When burning captions, each word pops on screen as it's spoken (Shorts/TikTok
              style) instead of static lines. Requires "Burn captions" to be on.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.custom_voices}
            onChange={(e) => save({ custom_voices: e.target.checked })}
          />
          <span>
            <span className="block">My Voices (voice cloning)</span>
            <span className="text-text-muted text-xs">
              Clone a voice from a short audio sample (Models page) and use it for narration.
              Works with the local engines only. Only clone voices you have permission to use.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.rename_duplicates}
            onChange={(e) => save({ rename_duplicates: e.target.checked })}
          />
          <span>
            <span className="block">Automatically rename duplicate files</span>
            <span className="text-text-muted text-xs">
              Exports never overwrite each other: "video (1).mp4", "video (2).mp4"... Also saves
              under a new name if the destination file is open in another app. Off = overwrite.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.verify_exports}
            onChange={(e) => save({ verify_exports: e.target.checked })}
          />
          <span>
            <span className="block">Verify exported files before saving</span>
            <span className="text-text-muted text-xs">
              Each export is checked (openable, has audio, valid duration) and only then moved
              into the exports folder — a failed conversion can never leave a corrupted file.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.context_recognition}
            onChange={(e) => save({ context_recognition: e.target.checked })}
          />
          <span>
            <span className="block">Context-aware technical recognition</span>
            <span className="text-text-muted text-xs">
              Protects AI model names, products, and other technical terms from being
              "corrected" into ordinary English, and fixes name capitalization. No dictionary —
              a semantic classifier detects technology content, and word-frequency statistics
              spot terminology (works automatically for future model/product names).
            </span>
          </span>
        </label>

        <div className="border border-border rounded-md p-4 space-y-3">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={remoteEnabled}
              onChange={(e) => saveRemote(e.target.checked, remoteUrl, remoteToken)}
            />
            <span>
              <span className="font-medium block">Cloud GPU backend (Beta)</span>
              <span className="text-text-muted text-xs">
                Run conversions on a free cloud GPU (Colab/Kaggle) instead of this computer —
                20-40x faster. Start a session using the notebook in the deploy/ folder, then
                paste its URL and token here. Off = everything runs locally as usual.
              </span>
            </span>
          </label>

          {(
            <div className="grid grid-cols-2 gap-3 pl-6">
              <label className="text-sm">
                <div className="text-text-muted mb-1">Backend URL (from the notebook)</div>
                <input
                  type="text"
                  value={remoteUrl}
                  placeholder="https://something.trycloudflare.com"
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  onBlur={() => saveRemote(remoteEnabled, remoteUrl, remoteToken)}
                  className="w-full bg-surface border border-border rounded-md px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <div className="text-text-muted mb-1">Access token (from the notebook)</div>
                <input
                  type="password"
                  value={remoteToken}
                  placeholder="paste token"
                  onChange={(e) => setRemoteToken(e.target.value)}
                  onBlur={() => saveRemote(remoteEnabled, remoteUrl, remoteToken)}
                  className="w-full bg-surface border border-border rounded-md px-3 py-2"
                />
              </label>
            </div>
          )}
          {remoteEnabled && (
            <p className="text-xs text-warning pl-6">
              Cloud mode is ON — conversions run remotely and your videos upload to the cloud
              session. Untick to return to this computer.
            </p>
          )}
        </div>

        <label className="block text-sm">
          <div className="text-text-muted mb-1">Default narration engine</div>
          <select
            value={settings.default_narration_engine}
            onChange={(e) =>
              save({
                default_narration_engine: e.target
                  .value as AppSettings["default_narration_engine"],
              })
            }
            className="w-full bg-surface border border-border rounded-md px-3 py-2"
          >
            <option value="edge">Fast (cloud) — Microsoft voices, needs internet</option>
            <option value="chatterbox">Human-like (local) — Chatterbox, slower on CPU</option>
          </select>
          <p className="text-xs text-text-muted mt-1">
            Pre-selected on the Home page for narration modes. You can still switch per
            conversion.
          </p>
        </label>
      </section>
    </div>
  );
}
