"""
In-memory job registry (per the "no database" requirement), mirrored to a
job.json file inside each job's temp folder so a crash mid-run still leaves
a diagnosable record on disk. Thread-safe: the pipeline runs in a background
thread while HTTP handlers read/update job state concurrently.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import Paths
from app.core.errors import JobNotFoundError
from app.core.logging import get_logger
from app.schemas.job import Job, JobStatus, LogEntry, PipelineStage

logger = get_logger(__name__)

_jobs: dict[str, Job] = {}
_lock = threading.RLock()

# In-memory history cap: beyond this many finished jobs, the oldest are
# evicted so a long-running server doesn't accumulate job logs forever.
# (job.json on disk still records evicted jobs.)
_MAX_FINISHED_JOBS = 50

_TERMINAL_STATUSES = (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)


def _prune_finished() -> None:
    """Must be called with _lock held."""
    finished = [j for j in _jobs.values() if j.status in _TERMINAL_STATUSES]
    if len(finished) <= _MAX_FINISHED_JOBS:
        return
    finished.sort(key=lambda j: j.updated_at)
    for job in finished[: len(finished) - _MAX_FINISHED_JOBS]:
        del _jobs[job.id]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_json_path(job_id: str) -> Path:
    return Paths.job_temp_dir(job_id) / "job.json"


def _persist(job: Job) -> None:
    try:
        _job_json_path(job.id).write_text(
            json.dumps(job.to_public_dict(), indent=2), encoding="utf-8"
        )
    except OSError as exc:
        logger.warning("Failed to persist job.json for %s: %s", job.id, exc)


def create_job(original_filename: str | None = None) -> Job:
    job_id = uuid.uuid4().hex[:12]
    now = _now()
    job = Job(
        id=job_id,
        status=JobStatus.PENDING,
        stage=PipelineStage.UPLOADED,
        created_at=now,
        updated_at=now,
        original_filename=original_filename,
    )
    with _lock:
        _prune_finished()
        _jobs[job_id] = job
        _persist(job)
    logger.info("Created job %s (file=%s)", job_id, original_filename)
    return job


def list_jobs() -> list[Job]:
    with _lock:
        return list(_jobs.values())


def get_job(job_id: str) -> Job:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(f"No job found with id '{job_id}'")
        return job


def update_job(job_id: str, **fields) -> Job:
    with _lock:
        job = get_job(job_id)
        updated = job.model_copy(update={**fields, "updated_at": _now()})
        _jobs[job_id] = updated
        _persist(updated)
        return updated


def append_log(job_id: str, message: str) -> Job:
    with _lock:
        job = get_job(job_id)
        entry = LogEntry(timestamp=_now(), message=message)
        updated = job.model_copy(update={"log": [*job.log, entry], "updated_at": _now()})
        _jobs[job_id] = updated
        _persist(updated)
        logger.info("[job %s] %s", job_id, message)
        return updated


def claim_for_processing(job_id: str) -> Job:
    """
    Atomically transition a job to PROCESSING. Raises AppError if it is
    already processing or finished, so two concurrent /convert calls can't
    both start a pipeline for the same job — the check and the status write
    happen under one lock acquisition.
    """
    from app.core.errors import AppError

    with _lock:
        job = get_job(job_id)
        if job.status == JobStatus.PROCESSING:
            raise AppError(f"Job {job_id} is already processing.", details={"job_id": job_id})
        if job.status in (JobStatus.COMPLETED, JobStatus.CANCELLED):
            raise AppError(
                f"Job {job_id} is already {job.status} and cannot be restarted.",
                details={"job_id": job_id, "status": job.status},
            )
        return update_job(job_id, status=JobStatus.PROCESSING, cancel_requested=False)


def mark_failed(job_id: str, error_code: str, error_message: str) -> Job:
    return update_job(
        job_id,
        status=JobStatus.FAILED,
        error_code=error_code,
        error_message=error_message,
    )


def request_cancel(job_id: str) -> Job:
    """
    Best-effort cooperative cancellation: sets a flag the pipeline checks
    between stages. It won't interrupt a stage already in flight (e.g. a
    running FFmpeg/Demucs subprocess), only stop the job from starting its
    next stage.
    """
    return update_job(job_id, cancel_requested=True)


def is_cancel_requested(job_id: str) -> bool:
    with _lock:
        return get_job(job_id).cancel_requested
