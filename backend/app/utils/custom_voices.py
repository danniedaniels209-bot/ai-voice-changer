"""
"My Voices": user-provided voice samples used as cloning references by the
local engines (Chatterbox narration, OpenVoice conversion). A voice is one
wav file under models/my_voices/; in requests it is referenced with the id
"custom:<name>" so it flows through the same tts_voice field as the
built-in narrator voices.

Cloud voices (edge-tts) cannot clone, so custom voices are valid only with
the local engines — the convert route enforces that with a clear error.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from fastapi import UploadFile

from app.core.config import Paths
from app.core.errors import AppError, InvalidModelFileError
from app.core.logging import get_logger

logger = get_logger(__name__)

CUSTOM_PREFIX = "custom:"
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_\- ]{1,40}$")
_MAX_SAMPLE_MB = 50
_ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"}


def _dir() -> Path:
    d = Paths.models / "my_voices"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _validate_name(name: str) -> None:
    if not _SAFE_NAME_RE.match(name):
        raise InvalidModelFileError(
            "Voice name must be 1-40 characters: letters, numbers, spaces, '-', '_'."
        )


def is_custom_voice(voice_id: str) -> bool:
    return voice_id.startswith(CUSTOM_PREFIX)


def voice_path(voice_id: str) -> Path:
    """Resolves 'custom:<name>' to its wav file. Raises if missing."""
    name = voice_id.removeprefix(CUSTOM_PREFIX)
    _validate_name(name)
    path = _dir() / f"{name}.wav"
    if not path.exists():
        raise AppError(f"Custom voice '{name}' does not exist.", details={"voice": voice_id})
    return path


def list_voices() -> list[dict]:
    return [
        {"id": f"{CUSTOM_PREFIX}{p.stem}", "name": p.stem, "size_mb": round(p.stat().st_size / 1048576, 2)}
        for p in sorted(_dir().glob("*.wav"))
    ]


def save_voice(name: str, sample: UploadFile) -> dict:
    """
    Stores an uploaded voice sample: size-capped streaming write to a temp
    file, converted to the reference format (24 kHz mono wav) with ffmpeg,
    then atomically published — same safety rules as video exports.
    """
    import os
    import uuid

    from app.services.ffmpeg_service import resolve_ffmpeg_binaries

    _validate_name(name)
    suffix = Path(sample.filename or "").suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise InvalidModelFileError(
            f"Unsupported audio format '{suffix}'. Use: {', '.join(sorted(_ALLOWED_EXTENSIONS))}"
        )

    final = _dir() / f"{name}.wav"
    if final.exists():
        raise InvalidModelFileError(f"A custom voice named '{name}' already exists.")

    token = uuid.uuid4().hex[:8]
    raw = _dir() / f".{name}.{token}{suffix}"
    tmp_wav = _dir() / f".{name}.{token}.wav"
    try:
        written = 0
        with raw.open("wb") as f:
            while chunk := sample.file.read(1024 * 1024):
                written += len(chunk)
                if written > _MAX_SAMPLE_MB * 1024 * 1024:
                    raise InvalidModelFileError(f"Voice sample exceeds the {_MAX_SAMPLE_MB} MB limit.")
                f.write(chunk)

        ffmpeg_path, _ = resolve_ffmpeg_binaries()
        result = subprocess.run(
            [ffmpeg_path, "-y", "-i", str(raw), "-ar", "24000", "-ac", "1", "-t", "60", str(tmp_wav)],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        if result.returncode != 0 or not tmp_wav.exists() or tmp_wav.stat().st_size == 0:
            raise InvalidModelFileError(
                "Could not read the voice sample as audio — is the file a valid recording?"
            )
        os.replace(tmp_wav, final)
    finally:
        raw.unlink(missing_ok=True)
        tmp_wav.unlink(missing_ok=True)

    logger.info("Custom voice '%s' saved (%.1f MB).", name, final.stat().st_size / 1048576)
    return {"id": f"{CUSTOM_PREFIX}{name}", "name": name, "size_mb": round(final.stat().st_size / 1048576, 2)}


def delete_voice(name: str) -> None:
    _validate_name(name)
    path = _dir() / f"{name}.wav"
    if not path.exists():
        raise AppError(f"Custom voice '{name}' does not exist.")
    path.unlink()
    logger.info("Custom voice '%s' deleted.", name)
