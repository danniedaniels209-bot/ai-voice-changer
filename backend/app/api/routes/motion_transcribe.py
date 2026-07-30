"""
Auto-caption transcription route for Motion Studio projects.
Runs the existing transcription service on a project's audio track
and returns SubtitleCue[] objects ready for subtitleLayers.ts.
"""

from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from app.core.config import Paths
from app.core.errors import AppError, JobNotFoundError, TranscriptionCancelledError
from app.core.hardware import get_hardware_info
from app.core.logging import get_logger
from app.motion_studio import storage
from app.services import transcribe_service
from app.utils.settings_store import get_effective_device_mode

logger = get_logger(__name__)
router = APIRouter(prefix="/motion", tags=["motion"])

_transcribe_tasks: dict[str, dict] = {}
_transcribe_lock = threading.Lock()
_TERMINAL_STATUSES = {"done", "failed", "cancelled"}


def resolve_audio_track_path(source_url: str) -> Path:
    if not source_url:
        raise AppError("Audio track has no source file.")
    if source_url.startswith("/motion/assets/"):
        rel_path = source_url[len("/motion/assets/"):]
        file_path = Paths.motion_assets / rel_path
        if file_path.exists():
            return file_path
    elif source_url.startswith("/narration/"):
        parts = source_url.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "narration":
            studio_id = parts[1]
            wav = Paths.temp / "narration" / studio_id / "narration.wav"
            if wav.exists():
                return wav
    elif Path(source_url).exists():
        return Path(source_url)
    else:
        root_path = Paths.root / source_url.lstrip("/")
        if root_path.exists():
            return root_path

    raise AppError(f"Audio track source file was not found: '{source_url}'")


def _run_transcribe(task_id: str, project_id: str, track_id: str, audio_path: Path) -> None:
    def publish(**fields: Any) -> None:
        with _transcribe_lock:
            if task_id in _transcribe_tasks:
                _transcribe_tasks[task_id].update(fields)

    try:
        with _transcribe_lock:
            task = _transcribe_tasks.get(task_id)
            cancel_event = task["_cancel_event"] if task else threading.Event()
            if task and cancel_event.is_set():
                task.update(status="cancelled", done=True, progress=0.0, error="Transcription was cancelled.")
                return

        publish(status="transcribing", progress=0.0)

        device = get_hardware_info(get_effective_device_mode()).resolved_device
        segments = transcribe_service.transcribe(
            audio_path,
            device=device,
            progress_callback=lambda p: publish(progress=p),
            cancel_event=cancel_event,
        )

        cues = []
        for idx, seg in enumerate(segments, start=1):
            words = []
            if seg.words:
                for w in seg.words:
                    words.append({
                        "text": w.word,
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "confidence": round(w.probability, 3),
                    })
            cues.append({
                "id": f"cue-{idx}",
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text,
                "words": words,
            })

        publish(status="done", done=True, progress=100.0, cues=cues)
    except TranscriptionCancelledError as exc:
        publish(status="cancelled", done=True, error=str(exc))
    except Exception as exc:
        logger.exception("Auto-caption transcription failed for task %s", task_id)
        publish(status="failed", done=True, error=str(exc))


def _public_task(task: dict[str, Any]) -> dict:
    return {key: value for key, value in task.items() if not key.startswith("_")}


@router.post("/projects/{project_id}/tracks/{track_id}/transcribe")
def start_transcription(project_id: str, track_id: str) -> dict:
    project = storage.load_project(project_id)
    target_track = None
    for scene in project.scenes:
        for track in scene.audio_tracks:
            if track.id == track_id:
                target_track = track
                break
        if target_track:
            break

    if not target_track:
        raise AppError(f"Audio track '{track_id}' not found in project '{project_id}'.")

    audio_path = resolve_audio_track_path(target_track.source_url)
    task_id = uuid.uuid4().hex

    with _transcribe_lock:
        for stale in list(_transcribe_tasks)[:-19]:
            _transcribe_tasks.pop(stale, None)
        _transcribe_tasks[task_id] = {
            "task_id": task_id,
            "project_id": project_id,
            "track_id": track_id,
            "status": "queued",
            "done": False,
            "progress": 0.0,
            "cues": [],
            "error": None,
            "_cancel_event": threading.Event(),
        }

    threading.Thread(
        target=_run_transcribe,
        args=(task_id, project_id, track_id, audio_path),
        daemon=True,
        name=f"motion-transcribe-{task_id[:8]}",
    ).start()

    return {"task_id": task_id}


@router.get("/transcribe/{task_id}")
def get_transcription_status(task_id: str) -> dict:
    with _transcribe_lock:
        task = _transcribe_tasks.get(task_id)
    if task is None:
        raise JobNotFoundError(f"Transcription task '{task_id}' not found.")
    return _public_task(task)


@router.delete("/transcribe/{task_id}")
def cancel_transcription(task_id: str) -> dict:
    with _transcribe_lock:
        task = _transcribe_tasks.get(task_id)
        if task is None:
            raise JobNotFoundError(f"Transcription task '{task_id}' not found.")
        if task["status"] in _TERMINAL_STATUSES:
            return _public_task(task)
        task["_cancel_event"].set()
        task.update(
            status="cancelled",
            done=True,
            error="Transcription was cancelled.",
        )
        return _public_task(task)
