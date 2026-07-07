"""
Safe export publishing: no output file is ever written in place.

Flow: the pipeline renders to a temporary file inside the job's own temp
directory, the result is verified (openable, has audio, valid duration),
and only then is it moved into the exports folder with an atomic rename.
A crash or failure mid-export can therefore never leave a corrupted or
partially written file in exports/ — and previous successful exports are
never touched by a failing job.

Duplicate names and files locked by other applications (a video player,
an editor) are handled here too, instead of crashing the job.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from app.core.errors import AppError, InvalidVideoError
from app.core.logging import get_logger

logger = get_logger(__name__)


def resolve_output_path(export_dir: Path, base_name: str, rename_duplicates: bool) -> Path:
    """
    Picks the destination path. With rename_duplicates (default), existing
    files are never overwritten: name.mp4 -> name (1).mp4 -> name (2).mp4.
    With it off, the existing file is replaced (user's explicit choice).
    """
    export_dir.mkdir(parents=True, exist_ok=True)
    candidate = export_dir / f"{base_name}.mp4"
    if not rename_duplicates or not candidate.exists():
        return candidate
    n = 1
    while True:
        candidate = export_dir / f"{base_name} ({n}).mp4"
        if not candidate.exists():
            return candidate
        n += 1


def verify_export(video_path: Path, expect_audio: bool = True) -> None:
    """
    Verifies an exported file before it is published: it exists, is
    non-empty, can be opened/probed as a video, has an audio stream, and
    reports a sane duration. Raises InvalidVideoError otherwise.
    """
    from app.services.ffmpeg_service import probe_video

    if not video_path.exists() or video_path.stat().st_size == 0:
        raise InvalidVideoError(f"Export verification failed: '{video_path.name}' is missing or empty.")

    metadata = probe_video(video_path)  # raises if the file can't be opened
    if expect_audio and not metadata.has_audio:
        raise InvalidVideoError(
            f"Export verification failed: '{video_path.name}' has no audio stream."
        )
    if not metadata.duration_seconds or metadata.duration_seconds <= 0:
        raise InvalidVideoError(
            f"Export verification failed: '{video_path.name}' reports an invalid duration."
        )
    logger.info(
        "Export verified: %s (%.1fs, audio=%s)",
        video_path.name,
        metadata.duration_seconds,
        metadata.has_audio,
    )


def _next_free_variant(path: Path) -> Path:
    """name.mp4 -> name (1).mp4, respecting an existing ' (n)' suffix."""
    stem = re.sub(r" \(\d+\)$", "", path.stem)
    n = 1
    while True:
        candidate = path.with_name(f"{stem} ({n}){path.suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def publish(tmp_path: Path, final_path: Path, rename_on_lock: bool = True) -> Path:
    """
    Atomically moves a verified temporary export into place. If the
    destination is locked by another application (Windows: a player or
    editor holding the file open), we don't crash: with rename_on_lock the
    export is published under the next free '(n)' name instead; otherwise
    a clear, actionable error is raised.
    """
    final_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        try:
            os.replace(tmp_path, final_path)  # atomic on the same volume
        except OSError as exc:
            if getattr(exc, "winerror", None) == 17 or exc.errno == 18:
                # temp and exports live on different drives: copy to a .part
                # file ON the destination volume, then atomically rename —
                # a crash mid-copy can only ever leave a .part file behind,
                # never a corrupted final export.
                import shutil

                part = final_path.with_suffix(final_path.suffix + ".part")
                shutil.copyfile(str(tmp_path), str(part))
                os.replace(part, final_path)
                tmp_path.unlink(missing_ok=True)
            else:
                raise
        return final_path
    except PermissionError:
        if rename_on_lock:
            fallback = _next_free_variant(final_path)
            logger.warning(
                "'%s' is in use by another application — publishing as '%s' instead.",
                final_path.name,
                fallback.name,
            )
            os.replace(tmp_path, fallback)
            return fallback
        raise AppError(
            f"Cannot save '{final_path.name}': the file is open in another "
            "application. Close it (e.g. a video player) and run the "
            "conversion again, or enable automatic renaming in Settings.",
            details={"path": str(final_path)},
        ) from None
