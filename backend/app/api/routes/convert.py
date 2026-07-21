"""
POST /convert — starts the remaining pipeline stages (Demucs separation,
RVC conversion, mixing, final mux) for an already-uploaded job, running them
on a bounded worker pool so the request returns immediately. Progress is
tracked via GET /jobs/{id} and streamed over the WebSocket in api/ws.py.

The pool is capped at settings.max_concurrent_jobs (default 1): Demucs and
RVC each saturate the GPU / all CPU cores on their own, so running pipelines
in parallel mostly just causes out-of-memory failures. Extra jobs queue and
start as slots free up.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.errors import AppError
from app.schemas.convert import ConvertRequest
from app.schemas.job import Job
from app.services.pipeline import run_pipeline
from app.utils import job_manager, model_manager

router = APIRouter(tags=["convert"])

_executor = ThreadPoolExecutor(
    max_workers=get_settings().max_concurrent_jobs,
    thread_name_prefix="pipeline",
)


@router.post("/convert/{job_id}", response_model=Job)
def start_conversion(job_id: str, request: ConvertRequest) -> Job:
    job = job_manager.get_job(job_id)

    if not job.video_path:
        raise AppError(
            "This job hasn't finished uploading yet.",
            details={"job_id": job_id, "status": job.status, "stage": job.stage},
        )
    if request.mode != "script" and not job.audio_path:
        raise AppError(
            "This video has no audio track, so there is no speech to convert. "
            "Use 'Narrate my script' mode instead.",
            details={"job_id": job_id},
        )

    if request.mode == "rvc":
        if not request.model_name:
            raise AppError(
                "mode='rvc' requires model_name (a voice model in models/).",
                details={"field": "model_name"},
            )
        model_manager.get_model(request.model_name)  # raises ModelNotFoundError if missing
    else:
        from app.services import tts_service
        from app.utils import custom_voices

        if custom_voices.is_custom_voice(request.tts_voice):
            custom_voices.voice_path(request.tts_voice)  # raises if missing
            # Cloud voices can't clone — custom voices need a local engine.
            if request.mode in ("tts", "script") and request.narration_engine != "chatterbox":
                raise AppError(
                    "Custom voices are cloned locally — select the "
                    "'Human-like (local)' engine to use them.",
                    details={"field": "narration_engine"},
                )
        elif request.dub_language and request.mode == "tts":
            from app.services.translation_service import LANGUAGES

            if request.dub_language not in LANGUAGES:
                raise AppError(
                    f"Unsupported dubbing language '{request.dub_language}'.",
                    details={"field": "dub_language"},
                )
            if not tts_service.is_dub_voice(request.tts_voice, request.dub_language):
                raise AppError(
                    f"Voice '{request.tts_voice}' does not speak "
                    f"{LANGUAGES[request.dub_language]} - pick one from GET /voices/dub.",
                    details={"field": "tts_voice"},
                )
        elif not tts_service.is_known_voice(request.tts_voice):
            raise AppError(
                f"Unknown TTS voice '{request.tts_voice}'. See GET /voices for options.",
                details={"field": "tts_voice"},
            )
        if request.mode == "script" and not (request.script and request.script.strip()):
            raise AppError(
                "mode='script' requires the narration text in 'script'.",
                details={"field": "script"},
            )

    if request.chain is not None:
        if request.chain.mode == "rvc":
            if not request.chain.model_name:
                raise AppError(
                    "Merge modes with RVC requires chain.model_name.",
                    details={"field": "chain.model_name"},
                )
            model_manager.get_model(request.chain.model_name)
        else:
            from app.services import tts_service

            if not tts_service.is_known_voice(request.chain.tts_voice):
                raise AppError(
                    f"Unknown chain target voice '{request.chain.tts_voice}'.",
                    details={"field": "chain.tts_voice"},
                )

    # Snapshot of what the user selected, for the job pages.
    mode_labels = {
        "script": "Narrate my script",
        "tts": "Re-voice the speech",
        "openvoice": "Expressive (OpenVoice)",
        "rvc": "Voice model (RVC)",
    }
    summary: dict[str, str] = {"Mode": mode_labels.get(request.mode, request.mode)}
    if request.mode == "rvc":
        summary["Voice model"] = request.model_name or "-"
        summary["Voice style"] = (
            "Preserve Speaking Style" if request.voice_style == "preserve_prosody" else "Standard"
        )
        if request.params.auto_pitch:
            summary["Auto pitch"] = f"on ({request.params.auto_pitch_target})"
    else:
        summary["Voice"] = request.tts_voice
    if request.mode in ("tts", "script"):
        summary["Engine"] = (
            "Human-like (local Chatterbox)" if request.narration_engine == "chatterbox" else "Fast (cloud)"
        )
        if request.narration_engine == "chatterbox":
            summary["Expressiveness"] = f"{request.exaggeration:.2f}"
    if request.precision_alignment and request.mode == "tts":
        summary["Word placement"] = "precision"
    if request.dub_language and request.mode == "tts":
        from app.services.translation_service import LANGUAGES as _L

        summary["Dubbed into"] = _L.get(request.dub_language, request.dub_language)
    if request.continuity and request.continuity.enabled:
        summary["Natural continuity"] = (
            f"on (stability {request.continuity.voice_stability}, "
            f"naturalness {request.continuity.naturalness})"
        )
    if request.chain is not None:
        summary["Merge modes"] = (
            f"then RVC '{request.chain.model_name}'"
            if request.chain.mode == "rvc"
            else f"then OpenVoice '{request.chain.tts_voice}'"
        )
    if request.skip_separation and request.mode != "script":
        summary["Background separation"] = "skipped"
    if request.compress_output:
        summary["File size"] = "compressed (re-encoded)"
    if request.subtitle_language and request.mode in ("tts", "script"):
        from app.services.translation_service import LANGUAGES as _SL

        if request.subtitle_language not in _SL:
            raise AppError(
                f"Unsupported subtitle language '{request.subtitle_language}'.",
                details={"field": "subtitle_language"},
            )
        summary["Extra subtitles"] = _SL[request.subtitle_language]

    # Atomic check-and-set: prevents two concurrent /convert calls from both
    # starting a pipeline for the same job.
    claimed = job_manager.claim_for_processing(job_id)
    claimed = job_manager.update_job(job_id, request_summary=summary)

    _executor.submit(
        run_pipeline,
        job_id,
        request.model_name,
        request.params,
        request.skip_separation,
        request.mode,
        request.tts_voice,
        request.voice_style,
        request.script,
        request.chain,
        request.narration_engine,
        request.exaggeration,
        request.continuity,
        request.precision_alignment,
        request.dub_language,
        request.compress_output,
        request.subtitle_language if request.mode in ("tts", "script") else None,
    )
    return claimed


@router.post("/convert/{job_id}/cancel", response_model=Job)
def cancel_conversion(job_id: str) -> Job:
    return job_manager.request_cancel(job_id)
