"""
Startup housekeeping: delete stale temp/<job_id>/ folders left behind by
old jobs (crashes, failed runs, delete_temp_on_success=False). Without this,
temp/ grows without bound over time.
"""

from __future__ import annotations

import shutil
import time

from app.core.config import Paths, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


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
