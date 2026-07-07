"""
Persistence for user-editable settings: a single JSON file, guarded by a
lock so concurrent requests never interleave a write. This is intentionally
simple (no database, no migrations) — matches the "no database" requirement
while still surviving app restarts.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from app.core.config import Paths, get_settings
from app.core.errors import InvalidSettingsError
from app.core.logging import get_logger
from app.schemas.settings import AppSettings, AppSettingsUpdate

logger = get_logger(__name__)

_lock = threading.Lock()


def load_settings() -> AppSettings:
    with _lock:
        if not Paths.settings_file.exists():
            return AppSettings()
        try:
            raw = json.loads(Paths.settings_file.read_text(encoding="utf-8"))
            return AppSettings.model_validate(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "Settings file at %s is corrupt (%s) — falling back to defaults.",
                Paths.settings_file,
                exc,
            )
            return AppSettings()


def save_settings(settings: AppSettings) -> None:
    with _lock:
        Paths.settings_file.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = Paths.settings_file.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps(settings.model_dump(), indent=2), encoding="utf-8"
        )
        tmp_path.replace(Paths.settings_file)  # atomic on Windows (same volume)


def update_settings(patch: AppSettingsUpdate) -> AppSettings:
    current = load_settings()
    updated = current.model_copy(update=patch.model_dump(exclude_unset=True))
    _validate(updated)
    save_settings(updated)
    return updated


def _validate(settings: AppSettings) -> None:
    from pathlib import Path

    if settings.ffmpeg_path is not None and not Path(settings.ffmpeg_path).exists():
        raise InvalidSettingsError(
            f"ffmpeg_path does not exist: {settings.ffmpeg_path}",
            details={"field": "ffmpeg_path"},
        )
    if settings.temp_dir is not None:
        temp_path = Path(settings.temp_dir)
        if temp_path.exists() and not temp_path.is_dir():
            raise InvalidSettingsError(
                f"temp_dir exists but is not a directory: {settings.temp_dir}",
                details={"field": "temp_dir"},
            )
    if settings.export_dir is not None:
        export_path = Path(settings.export_dir)
        if export_path.exists() and not export_path.is_dir():
            raise InvalidSettingsError(
                f"export_dir exists but is not a directory: {settings.export_dir}",
                details={"field": "export_dir"},
            )


# --- Effective value resolution -------------------------------------------
# These merge the persisted user overrides (AppSettings) with the built-in
# project defaults (Paths / env Settings), so the rest of the app always
# asks for ONE effective value instead of re-implementing this fallback.


def get_effective_ffmpeg_path() -> str | None:
    override = load_settings().ffmpeg_path
    if override:
        return override
    return get_settings().resolve_ffmpeg_path()


def get_effective_temp_dir() -> Path:
    override = load_settings().temp_dir
    path = Path(override) if override else Paths.temp
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_effective_export_dir() -> Path:
    override = load_settings().export_dir
    path = Path(override) if override else Paths.exports
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_effective_device_mode() -> str:
    return load_settings().device_mode
