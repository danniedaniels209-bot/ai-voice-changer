"""
Housekeeping.

- prune_stale_temp_dirs: startup sweep deleting temp/<job_id>/ folders left
  behind by old jobs (crashes, failed runs, delete_temp_on_success=False).
- Cloud sweeper: cloud sessions (Colab) run on a small ephemeral disk, so a
  background thread deletes each job's uploaded/intermediate files 90 minutes
  after their last activity, and finished exports 2 hours after they were
  written (AVC_UPLOAD_TTL_MINUTES / AVC_EXPORT_TTL_MINUTES override). Jobs
  still processing are never touched. Local runs are unaffected — download
  your results within the window when converting on a cloud session.
"""

from __future__ import annotations

import os
import shutil
import threading
import time

from app.core.config import Paths, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

UPLOAD_TTL_MINUTES = float(os.environ.get("AVC_UPLOAD_TTL_MINUTES", "90"))
EXPORT_TTL_MINUTES = float(os.environ.get("AVC_EXPORT_TTL_MINUTES", "120"))
_SWEEP_INTERVAL_SECONDS = 600  # check every 10 minutes


def prune_stale_temp_dirs() -> int:
    """
    Delete job temp folders whose newest file is older than
    settings.temp_retention_days. Returns the number of folders removed.
    """
    retention_days = get_settings().temp_retention_days
    cutoff = time.time() - retention_days * 86400
    removed = 0

    if not Paths.temp.exists():
        return 0

    for entry in Paths.temp.iterdir():
        if not entry.is_dir():
            continue
        try:
            newest = max(
                (p.stat().st_mtime for p in entry.rglob("*") if p.is_file()),
                default=entry.stat().st_mtime,
            )
            if newest < cutoff:
                shutil.rmtree(entry)
                removed += 1
        except OSError as exc:
            logger.warning("Could not prune temp folder %s: %s", entry, exc)

    if removed:
        logger.info(
            "Pruned %d stale temp job folder(s) older than %d day(s).",
            removed,
            retention_days,
        )
    return removed


def prune_expired_uploads(ttl_minutes: float = UPLOAD_TTL_MINUTES) -> int:
    """
    Delete job temp folders (uploaded video + intermediates) whose newest
    file is older than ttl_minutes. Jobs currently PENDING/PROCESSING are
    skipped no matter how old. Also clears stale chunked-upload part files.
    Returns the number of folders removed.
    """
    from app.schemas.job import JobStatus
    from app.utils import job_manager

    cutoff = time.time() - ttl_minutes * 60
    removed = 0

    if not Paths.temp.exists():
        return 0

    for entry in Paths.temp.iterdir():
        if not entry.is_dir():
            continue
        if entry.name == "chunked_uploads":
            for part in entry.glob("*.part"):
                try:
                    if part.stat().st_mtime < cutoff:
                        part.unlink()
                except OSError:
                    pass
            continue
        try:
            job = job_manager.get_job(entry.name)
            if job.status in (JobStatus.PENDING, JobStatus.PROCESSING):
                continue
        except Exception:
            pass  # unknown folder — age check below decides
        try:
            newest = max(
                (p.stat().st_mtime for p in entry.rglob("*") if p.is_file()),
                default=entry.stat().st_mtime,
            )
            if newest < cutoff:
                shutil.rmtree(entry)
                removed += 1
        except OSError as exc:
            logger.warning("Could not prune upload folder %s: %s", entry, exc)

    if removed:
        logger.info(
            "Auto-deleted %d upload folder(s) idle for over %.0f minutes.",
            removed,
            ttl_minutes,
        )
    return removed


def prune_expired_exports(ttl_minutes: float = EXPORT_TTL_MINUTES) -> int:
    """
    Delete finished exports (videos, subtitles, variants) older than
    ttl_minutes — cloud disks are ephemeral anyway, this just frees space
    sooner. Age is per file, from its last modification. Returns count.
    """
    cutoff = time.time() - ttl_minutes * 60
    removed = 0

    if not Paths.exports.exists():
        return 0

    for entry in Paths.exports.iterdir():
        try:
            if entry.is_file() and entry.stat().st_mtime < cutoff:
                entry.unlink()
                removed += 1
        except OSError as exc:
            logger.warning("Could not prune export %s: %s", entry, exc)

    if removed:
        logger.info(
            "Auto-deleted %d export(s) older than %.0f minutes.", removed, ttl_minutes
        )
    return removed


def start_upload_sweeper() -> None:
    """
    Start the background TTL sweeper — cloud sessions only (detected by the
    AVC_AUTH_TOKEN the cloud bootstrap sets). Local machines keep uploads
    until the normal multi-day retention sweep.
    """
    if not os.environ.get("AVC_AUTH_TOKEN"):
        return

    def _loop() -> None:
        while True:
            time.sleep(_SWEEP_INTERVAL_SECONDS)
            try:
                prune_expired_uploads()
                prune_expired_exports()
            except Exception as exc:  # noqa: BLE001 — sweeper must never die
                logger.warning("Upload sweeper error: %s", exc)

    threading.Thread(target=_loop, daemon=True, name="upload-sweeper").start()
    logger.info(
        "Cloud session: uploads auto-delete after %.0f min idle, exports after %.0f min.",
        UPLOAD_TTL_MINUTES,
        EXPORT_TTL_MINUTES,
    )
