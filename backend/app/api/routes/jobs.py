"""
GET /jobs — list all jobs this session (running first, then newest first),
so the UI can find its way back to a conversion after navigating away.
GET /jobs/{id} — inspect one job's current state.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.errors import AppError
from app.schemas.job import Job, JobStatus
from app.utils import job_manager

router = APIRouter(prefix="/jobs", tags=["jobs"])

_ACTIVE = (JobStatus.PENDING, JobStatus.PROCESSING)


@router.get("", response_model=list[Job])
def list_jobs_endpoint() -> list[Job]:
    jobs = job_manager.list_jobs()
    active = sorted((j for j in jobs if j.status in _ACTIVE), key=lambda j: j.created_at, reverse=True)
    finished = sorted((j for j in jobs if j.status not in _ACTIVE), key=lambda j: j.created_at, reverse=True)
    return active + finished


@router.get("/{job_id}", response_model=Job)
def get_job_endpoint(job_id: str) -> Job:
    return job_manager.get_job(job_id)


class SegmentEdit(BaseModel):
    id: int
    text: str | None = None
    seed: int = 0


class ReexportRequest(BaseModel):
    segments: list[SegmentEdit] = []


class PreviewEditRequest(BaseModel):
    id: int
    text: str
    seed: int = 0


def _load_recipe(job_id: str) -> dict:
    import json

    from app.core.config import Paths

    recipe_path = Paths.job_temp_dir(job_id) / "edit_recipe.json"
    if not recipe_path.exists():
        raise AppError(
            "This job has no editing data. It was converted with the segment "
            "editor off, in a non-editable mode (RVC/OpenVoice), or its temp "
            "files were already cleaned."
        )
    return json.loads(recipe_path.read_text(encoding="utf-8"))


@router.get("/{job_id}/segments")
def get_job_segments(job_id: str) -> dict:
    """Segment editor: the editable narration plan of a completed job."""
    job = job_manager.get_job(job_id)
    try:
        recipe = _load_recipe(job_id)
    except AppError as exc:
        return {"editable": False, "reason": exc.message, "segments": []}
    # Editable whenever the recipe exists and nothing is currently running —
    # including after a FAILED re-export, so the user can fix and retry.
    editable = job.status in (JobStatus.COMPLETED, JobStatus.FAILED)
    return {
        "editable": editable,
        "reason": "" if editable else f"job is {job.status}",
        "engine": recipe.get("engine", "edge"),
        "voice": recipe.get("voice"),
        "segments": recipe.get("segments", []),
    }


@router.post("/{job_id}/segments/preview")
def preview_job_segment(job_id: str, request: PreviewEditRequest) -> FileResponse:
    """Render one (possibly edited) segment so the user can hear it before
    committing to a re-export. Cached — repeat listens are instant."""
    from app.core.config import Paths
    from app.core.hardware import get_hardware_info
    from app.services import tts_service
    from app.utils.settings_store import get_effective_device_mode

    recipe = _load_recipe(job_id)
    device = get_hardware_info(get_effective_device_mode()).resolved_device
    wav = tts_service.synthesize_single(
        Paths.job_temp_dir(job_id) / "tts_segments",
        request.text,
        recipe["voice"],
        engine=recipe.get("engine", "edge"),
        exaggeration=recipe.get("exaggeration", 0.5),
        stability=recipe.get("stability"),
        seed=request.seed,
        device=device,
    )
    return FileResponse(str(wav), media_type="audio/wav")


@router.post("/{job_id}/reexport", response_model=Job)
def reexport_job(job_id: str, request: ReexportRequest) -> Job:
    """Apply segment edits and re-export the video. Runs on the same bounded
    worker pool as conversions; untouched segments reuse cached audio."""
    from app.api.routes.convert import _executor
    from app.services.pipeline import run_reexport

    _load_recipe(job_id)  # clear error now rather than inside the thread
    claimed = job_manager.claim_for_processing(job_id, allow_completed=True)
    _executor.submit(run_reexport, job_id, [e.model_dump() for e in request.segments])
    return claimed


@router.get("/{job_id}/result")
def get_job_result(job_id: str, variant: str = "main") -> FileResponse:
    """
    Streams a finished job's output so the UI can play/download it.
    variant: "main" (default), "vertical" (9:16 export), or "subtitles".
    """
    job = job_manager.get_job(job_id)
    if job.status != JobStatus.COMPLETED or not job.output_path:
        raise AppError(
            f"Job {job_id} has no finished output (status: {job.status}).",
            details={"job_id": job_id, "status": job.status},
        )

    if variant == "vertical":
        vertical = next((p for p in job.extra_outputs if p.endswith("_vertical.mp4")), None)
        if not vertical:
            raise AppError("This job has no vertical export.", details={"job_id": job_id})
        path = Path(vertical)
    elif variant == "subtitles":
        if not job.subtitle_path:
            raise AppError("This job has no subtitle file.", details={"job_id": job_id})
        path = Path(job.subtitle_path)
    else:
        path = Path(job.output_path)

    if not path.exists():
        raise AppError(
            f"Output file no longer exists on disk: {path.name}", details={"job_id": job_id}
        )

    media_type = "text/plain" if path.suffix == ".srt" else "video/mp4"
    return FileResponse(str(path), media_type=media_type, filename=path.name)
