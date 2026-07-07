"""
Central path/config resolution for the backend.

Every other module asks THIS module for a path instead of hardcoding one,
so the on-disk layout (models/, temp/, exports/, ffmpeg/, logs/) only has
to be defined once and stays consistent between services, routes, and tests.
"""

from __future__ import annotations

import shutil
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> parents[3] is the project root (ai-voice-changer/)
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Paths:
    """Fixed, well-known directories the app reads from / writes to."""

    root: Path = PROJECT_ROOT
    frontend: Path = PROJECT_ROOT / "frontend"
    backend: Path = PROJECT_ROOT / "backend"
    models: Path = PROJECT_ROOT / "models"
    temp: Path = PROJECT_ROOT / "temp"
    exports: Path = PROJECT_ROOT / "exports"
    ffmpeg_dir: Path = PROJECT_ROOT / "ffmpeg"
    logs: Path = PROJECT_ROOT / "logs"

    # Where user-editable runtime settings (Settings page) are persisted.
    # A single JSON file — no database, per project requirements.
    settings_file: Path = PROJECT_ROOT / "backend" / "app_settings.json"

    @classmethod
    def ensure_all(cls) -> None:
        """Create every well-known directory if it doesn't exist yet."""
        for path in (
            cls.models,
            cls.temp,
            cls.exports,
            cls.ffmpeg_dir,
            cls.logs,
        ):
            path.mkdir(parents=True, exist_ok=True)

    @classmethod
    def job_temp_dir(cls, job_id: str) -> Path:
        """Scratch directory for one conversion job's intermediate files."""
        job_dir = cls.temp / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        return job_dir


class Settings(BaseSettings):
    """
    Process-level defaults, overridable via environment variables or a
    `.env` file in backend/. These are startup defaults only — day-to-day
    user preferences (ffmpeg path, device mode, export quality) live in
    the mutable app_settings.json managed by the Settings API, not here.
    """

    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / "backend" / ".env"),
        env_prefix="AVC_",
        extra="ignore",
    )

    app_name: str = "AI Video Voice Changer"
    host: str = "127.0.0.1"
    port: int = 8000

    # CORS: the Vite dev server origin. Adjust if the frontend runs elsewhere.
    frontend_origin: str = "http://localhost:5175"

    # "auto" = use CUDA if available, else CPU. Can be forced to "cpu" or "cuda".
    default_device_mode: str = "auto"

    max_upload_size_mb: int = 8192  # 8 GB safety ceiling for very long videos
    max_model_size_mb: int = 2048  # RVC .pth files are typically 50-200 MB

    # How many conversion pipelines may run at once. Demucs + RVC saturate a
    # GPU (or all CPU cores) on their own, so >1 mostly just causes OOM.
    max_concurrent_jobs: int = 1

    # temp/<job_id>/ folders older than this are deleted at startup.
    temp_retention_days: int = 3

    # Whisper model size for the TTS pipeline's transcription step.
    # tiny/base/small/medium/large-v3 — small is a good speed/accuracy balance.
    whisper_model: str = "small"

    # Access token for cloud/tunnel deployments (personal use): when set,
    # every request must carry it. Unset (default) = open local use.
    auth_token: str | None = None

    def resolve_ffmpeg_path(self) -> str | None:
        """
        Resolve the ffmpeg executable to use, in priority order:
        1. A binary bundled in the project's ffmpeg/ folder.
        2. An ffmpeg found on the system PATH.
        Returns None if neither is found (caller must raise a clear error).
        """
        bundled = Paths.ffmpeg_dir / "ffmpeg.exe"
        if bundled.exists():
            return str(bundled)

        on_path = shutil.which("ffmpeg")
        if on_path:
            return on_path

        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
