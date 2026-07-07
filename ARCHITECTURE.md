# AI Video Voice Changer — Architecture

Local-only desktop application. No cloud, no Docker, no auth, no database.

## Top-level layout

```
ai-voice-changer/
  frontend/        React + Vite + TypeScript + Tailwind UI
  backend/          FastAPI server (all AI/processing logic)
  models/           User-imported RVC voice models (*.pth + *.index pairs)
  temp/             Per-job scratch space (deleted after successful export)
  exports/          Finished MP4 output
  ffmpeg/           Local ffmpeg.exe / ffprobe.exe binaries (path configurable in Settings)
  logs/             Rotating log files (backend + per-job pipeline logs)
```

## Backend layout (`backend/`)

```
backend/
  app/
    main.py                 FastAPI app factory, CORS, router mounting, startup checks
    core/
      config.py             Paths (models/temp/exports/ffmpeg/logs), env-driven settings
      logging.py            Logger setup (console + rotating file in logs/)
      hardware.py           CUDA/CPU detection (torch.cuda.is_available(), device selection)
      errors.py             Typed exceptions (FFmpegNotFound, ModelNotFound, InvalidVideo, ...)
    api/
      routes/
        upload.py           POST /upload -> saves video to temp/<job_id>/, validates format
        models.py            GET/POST/DELETE /models -> list/import/delete RVC models
        convert.py           POST /convert -> starts pipeline job; GET /jobs/{id} -> status/progress
        settings.py          GET/PUT /settings -> ffmpeg path, temp dir, device mode, export quality
      ws.py                  WebSocket /ws/jobs/{id} -> live progress push (stage, %, ETA, log lines)
    services/
      ffmpeg_service.py     Extract audio, mux final audio+video, probe metadata
      demucs_service.py     Speech/background separation (Demucs)
      rvc_service.py         Voice conversion (RVC inference: pitch, index ratio, similarity, sr)
      mixer_service.py       Mix converted voice + background stems (librosa/soundfile)
      pipeline.py             Orchestrates the 7-stage pipeline end-to-end, reports progress
    schemas/
      job.py                  Pydantic models: JobStatus, JobProgress, ConvertRequest
      model_info.py           Pydantic model: RVCModelInfo (name, path, has_index, size, sr)
      settings.py              Pydantic model: AppSettings
    utils/
      job_manager.py          In-memory job registry (thread-safe dict) + temp dir lifecycle
      file_manager.py         Safe filename handling, cleanup, disk-space checks
  requirements.txt
  pyproject.toml
```

## Frontend layout (`frontend/`)

```
frontend/
  src/
    pages/
      Home.tsx               Upload video, pick model, pick output folder, start button
      Processing.tsx         Progress bar, current stage, ETA, live log (via WebSocket)
      Settings.tsx            CPU/GPU toggle, ffmpeg path, temp folder, export quality
      Models.tsx              Import/delete/preview RVC models
    components/               Shared UI: FileDropzone, ProgressBar, StageIndicator, ModelCard, ...
    api/
      client.ts                Typed fetch wrapper hitting http://127.0.0.1:8000
      jobs.ts, models.ts, settings.ts   Per-resource API calls
    hooks/
      useJobProgress.ts        WebSocket hook subscribing to /ws/jobs/{id}
    types/                      Shared TS types mirrored from backend Pydantic schemas
    App.tsx, main.tsx, router
  index.html, vite.config.ts, tailwind.config.js, package.json
```

## Key architectural decisions

1. **Job-based async pipeline, not request/response.** Voice conversion on a
   1-hour video takes minutes. `POST /convert` returns a `job_id` immediately;
   the pipeline runs in a background thread/task. Frontend polls or subscribes
   via WebSocket for progress. No request ever blocks waiting for FFmpeg/Demucs/RVC.

2. **In-memory job registry instead of a database.** Per the requirements
   (no database), job state (`status`, `stage`, `progress`, `log[]`) lives in a
   thread-safe in-process dict keyed by `job_id`, mirrored to a small JSON file
   in `temp/<job_id>/job.json` so a crash mid-run leaves a diagnosable trace.

3. **Each pipeline stage is an isolated service function** that reads one file
   from disk and writes one file back to `temp/<job_id>/`. This keeps memory
   bounded (never loads a full video into RAM — FFmpeg streams), makes each
   stage independently testable, and means a failure at stage N leaves stages
   1..N-1's output on disk for debugging instead of losing everything.

4. **Hardware detection is centralized** in `core/hardware.py`, called once at
   startup and exposed via `/settings`. Every service (Demucs, RVC/PyTorch)
   asks this module for the device string (`"cuda"` or `"cpu"`) rather than
   each re-implementing detection — one source of truth, one place to override
   from Settings.

5. **Typed error taxonomy** (`core/errors.py`) maps each documented failure
   mode (missing ffmpeg, missing model, invalid video, corrupt audio, no CUDA,
   OOM, interrupted job) to a specific exception class, caught centrally in
   FastAPI exception handlers and turned into structured JSON errors the
   frontend can render — never a raw 500/stack trace, never a silent crash.

6. **models/ folder is the single source of truth for voice models.** The
   Models page just lists/validates `.pth` (+ optional matching `.index`)
   files already in that folder plus supports importing new ones — no model
   data duplicated into any database.

## Build order (one feature at a time, your approval gate between each)

1. Backend skeleton: FastAPI app, config, logging, hardware detection, health check endpoint.
2. Settings + Models endpoints (simplest, no pipeline yet) + Models/Settings frontend pages.
3. Upload endpoint + ffmpeg audio extraction service (first real pipeline stage).
4. Demucs separation service.
5. RVC conversion service.
6. Mixing + final mux-back-into-video service.
7. Job manager + `/convert` orchestration + WebSocket progress.
8. Frontend Home + Processing pages wired to the real API.
9. End-to-end test with a real video, error-handling pass, cleanup-on-success.
