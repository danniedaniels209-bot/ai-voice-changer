"""
GET /jobs — list all jobs this session (running first, then newest first),
so the UI can find its way back to a conversion after navigating away.
GET /jobs/{id} — inspect one job's current state.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

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
