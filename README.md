# AI Video Voice Changer

A local web app that replaces the speaker's voice in a video, while preserving
background music and effects. Runs on your machine — no database, no accounts.

Two conversion modes:

- **AI narrator (TTS)** — transcribes the speech locally (Whisper) and
  re-synthesizes it with a Microsoft neural voice (edge-tts), timed to the
  original segments. This is the polished "AI ad" narrator sound. The
  synthesis step calls Microsoft's free service, so it needs internet.
- **Voice model (RVC)** — converts the speaker's timbre to a voice model from
  `models/`, keeping their original delivery and accent. Fully offline.
  Supports auto-pitch: detects the speaker's pitch and transposes toward a
  male or female speaking range automatically.
- **Expressive (OpenVoice)** — converts the speaker's timbre toward any of
  the built-in narrator voices while preserving the full delivery: emotion,
  emphasis, rhythm, pauses, and accent. Uses MyShell's OpenVoice V2 tone-color
  converter (MIT, vendored under `backend/openvoice/`, ~131 MB checkpoint);
  the target reference audio is generated once per voice from edge-tts.

**Pipeline:** upload video → extract audio (FFmpeg) → separate speech from
background (Demucs) → convert the voice (RVC) *or* transcribe + synthesize
(Whisper + edge-tts) → remix → mux back into the video → export to `exports/`.

## Requirements

- Windows (developed/tested there; other platforms untested)
- Python 3.11+ with the backend virtualenv at `backend/.venv`
- Node.js 20+ for the frontend
- FFmpeg — either drop `ffmpeg.exe` into the `ffmpeg/` folder, have it on
  PATH, or set the path in the app's Settings page
- (Optional) NVIDIA GPU with CUDA for much faster separation/conversion

## Setup

```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd ..\frontend
npm install
```

Optional: copy `backend/.env.example` to `backend/.env` to override startup
defaults (port, size limits, concurrency, temp retention).

## Running

Double-click **`start.bat`** in the project root — it opens two windows, one
for the backend (uvicorn on port 8000) and one for the frontend (Vite dev
server).

Or manually:

```powershell
# Backend (from backend/, with the venv active)
uvicorn app.main:app --reload --port 8000

# Frontend (from frontend/)
npm run dev
```

## Preserve Speaking Style (Experimental)

RVC mode has an optional **Voice Style** toggle. "Preserve Speaking Style"
keeps the original speaker's delivery and changes only the voice identity:

- **Rhythm, speech rate, pauses** — preserved inherently (RVC output is
  time-aligned with its input).
- **Intonation / pitch contour** — preserved: the source F0 curve is reused,
  shifted only by a constant transpose (rmvpe tracking is forced for
  fidelity).
- **Word emphasis / relative loudness** — restored by measuring the source's
  loudness envelope and re-imposing it on the converted audio
  (`prosody_service.transfer_loudness`).
- **Consonants and breaths** — kept via maximum `protect` (0.5).

**Known limitations of the current RVC engine:** voice-quality emotion cues
(whisper, vocal fry, breathiness shifts) survive only partially — RVC maps
timbre frame-by-frame and has no explicit emotion/style representation. The
trade-off is also real: preserving the source articulation makes the result
sound slightly less like the target voice.

**For stronger expressive conversion later,** the engine registry in
`prosody_service.ENGINE_PROSODY_CAPABILITIES` is designed so new engines can
be added alongside RVC/TTS. Best candidates: **Seed-VC** (zero-shot, strong
prosody retention), **DDDM-VC** or **FreeVC** (disentangled style/content),
or **KNN-VC** (simple, good articulation preservation). Each would slot in as
a new `mode` with its own service module, capability entry, and pipeline
branch — no changes needed to the job/progress/mixing infrastructure.

TTS mode cannot preserve delivery at all (it re-synthesizes speech from
plain text), so the toggle only applies to RVC mode; the UI says so.

## Context-aware technical recognition

A modular post-transcription layer (`app/services/context_recognition.py`,
toggle in Settings, on by default) that protects technical terminology —
AI models, products, companies, frameworks, APIs, people — without a
hardcoded dictionary:

- Whisper reports per-word confidence; unfamiliar technical terms score low
  even when transcribed correctly.
- Sentences are scored for technical context from indicator words ("model",
  "API", "GPU", "inference", "deploy", "prompt"...) and trigger phrases
  ("released by", "built with"...) — these describe the *context*, not the
  terms, so brand-new technology names are still recognized.
- **Document-level detection:** if the transcript as a whole is technical
  (≥30% technical sentences, or enough indicator hits overall), the entire
  video gets conservative handling — unfamiliar low-confidence words are
  preserved even in sentences that individually carry no indicators, which
  is exactly where new product names tend to appear.
- In technical context, low-confidence words are preserved verbatim (never
  substituted) and name-shaped/name-positioned words get proper-noun
  capitalization.
- A soft `initial_prompt` domain hint biases Whisper's decoding toward
  keeping technical tokens (a prompt, not a dictionary).
- Timestamps and word timings are never modified — subtitles stay in sync.

The component consumes and returns plain `SpeechSegment`s, independent of
the transcription engine, so a smarter recognizer can replace it behind the
same interface later.

## Natural continuity (Beta)

An optional processing layer (Home page toggle, **off by default** — existing
behavior is unchanged unless enabled) that makes converted output sound like
one continuous performance instead of independently processed clips.

Where continuity was being lost, and what each mechanism does about it:

| Problem | Mechanism | Where |
|---|---|---|
| Whisper's VAD cuts speech at every silence; each cut becomes an independent TTS utterance whose prosody starts from scratch | **Adaptive segmentation** — merges speech across brief pauses (<0.6s always; up to 1.2s mid-sentence) into sentence/paragraph chunks, capped adaptively by the Context Window setting (8–30s) | `continuity_service.merge_segments` |
| Independently synthesized chunks each come out at the engine's default loudness — audible level jumps | **Rolling context memory** — an exponential moving average of segment energy (decay set by Context Window) nudges each segment toward the established trend, bounded so real dynamics (shouts, whispers) survive | `continuity_service.RollingEnergyMemory` |
| Hard segment starts/ends create clicks and audible seams | **Crossfaded placement** — raised-cosine edge fades (10–90ms, scaled by Naturalness) blend every boundary | `continuity_service.apply_edge_fades` |
| Chatterbox generation is stochastic: each segment sounds like a slightly different "take" of the voice | **Voice Stability** — fixed random seed per segment + higher reference guidance (cfg_weight) + lower sampling temperature | `chatterbox_service.synthesize` |
| RVC/OpenVoice leave loudness step-changes between internally processed regions | **Final smoothing pass** — the voice track's RMS envelope is smoothed over ~0.6s and partially corrected toward it, strength set by Naturalness | `continuity_service.smooth_voice_track` |
| Envelope transfer in RVC preserve mode was all-or-nothing | **Prosody Preservation slider** — weights the loudness-envelope transfer continuously (0–100) | `prosody_service.transfer_loudness(weight=...)` |

All mechanisms are numpy-based (no extra model memory), CPU/GPU-agnostic,
and per-job stateless — memory decays across a single recording and never
leaks between jobs. Backwards compatible: requests without the `continuity`
field behave exactly as before.

### Master timeline — the non-negotiable invariant

The original audio is the **master timeline**: conversion may only change
the *sound* inside each segment, never *where* it belongs in time.
Reconstruction (`tts_service.synthesize_timeline`) enforces this in four
phases:

0. **Freeze** — before any processing, an immutable snapshot records every
   segment's sequence index, original start, original end, and text.
   Nothing may modify this snapshot; every later stage is checked against
   it. Reconstruction never depends on completion or worker order.
1. **Synthesize + fit to original duration** — each segment's ORIGINAL
   duration is the target. Longer audio is time-stretched to fit using an
   unbounded chained atempo (words are never dropped to make room; a
   trimming guard only exists for pathological >4x cases); shorter audio
   leaves natural silence exactly where the original had it. Every
   placement is anchored to absolute original timestamps, so cumulative
   drift is structurally impossible and later segments can never be
   shifted.
2. **Master-timeline validation** — before any audio is written: every
   master segment reconstructed exactly once (missing/duplicate detected by
   ID), order identical to the original, every placement starting at its
   original timestamp, nothing extending past its original end beyond the
   crossfade, no empty audio. Any failure aborts the export with a
   diagnostic naming the exact segment (index, time range, text snippet).
3. **Overlap-add placement** at original timestamps.

Priority: correctness over quality — a perfectly aligned result with
slightly faster speech beats an expressive one with misplaced audio.

**Every mode upholds the invariant:**

| Mode | How the master timeline is enforced |
|---|---|
| Re-voice (TTS) | Full 4-phase reconstruction above |
| Script narration | Same 4-phase reconstruction (script sentences become master segments) |
| RVC | Whole-file conversion is time-aligned by design; output is verified and conformed to the source duration (`mixer_service.conform_duration`), aborting on gross deviation |
| Expressive (OpenVoice) | Same whole-file verification + conform |
| Merge modes (chain) | The second stage's output is conformed to its input's duration, so chains cannot compound drift |
| Mixing | The final mix is conformed to the background bed, whose length equals the source video exactly |

Engine-aware chunk caps: Chatterbox truncates/skips words on long inputs,
so its continuity chunks are capped at 12s / 280 chars (the cloud engine
keeps the full adaptive cap).

Concurrency: each job's intermediates live in `temp/<job_id>/`; the shared
voice-reference cache is created atomically (unique temp name + rename),
and the shared Chatterbox/OpenVoice model instances serialize inference
behind locks — concurrent jobs can never corrupt each other's data.

## Voice models

RVC models live in `models/`, in either layout:

- `models/<name>/<anything>.pth` (+ optional `*.index`)
- `models/<name>.pth` (+ optional `models/<name>.index`)

Import them via the app's Models page, or drop the files in manually.

> **Security note:** `.pth` files are Python pickles. Only use models from
> sources you trust.

## Project layout

```
backend/app/api/       REST routes + WebSocket (live job progress)
backend/app/services/  Pipeline stages: demucs, rvc, mixer, ffmpeg
backend/app/utils/     Job registry, model manager, settings store
backend/tests/         Backend unit tests (pytest)
frontend/src/          React app: Home, Processing, Models, Settings
models/                RVC voice models
temp/                  Per-job scratch files (auto-pruned after 3 days)
exports/               Finished videos
```

See `ARCHITECTURE.md` for the full design.

## Tests

```powershell
cd backend
.venv\Scripts\activate
pytest
```
