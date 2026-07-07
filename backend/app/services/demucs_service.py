"""
Speech/background separation via Demucs.

Demucs is invoked as a subprocess (`python -m demucs`) rather than through
its internal Python API: the CLI already handles chunked/streamed audio
processing (so long tracks don't blow up memory), device selection, and
resampling — reimplementing that against Demucs's internal API would be
fragile across versions for no real benefit.
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from app.core.errors import CorruptAudioError, OutOfMemoryError
from app.core.logging import get_logger

logger = get_logger(__name__)

# htdemucs is Demucs' current best general-purpose model. --two-stems vocals
# makes it output exactly what this pipeline needs: an isolated vocal track
# and a "no_vocals" track (drums+bass+other summed) as the background bed.
import os

# htdemucs = default (fast, good). Cloud sessions set AVC_DEMUCS_MODEL to
# htdemucs_ft (fine-tuned: cleaner separation, ~4x slower - trivial on GPU).
DEMUCS_MODEL = os.environ.get("AVC_DEMUCS_MODEL", "htdemucs")

# Demucs prints tqdm-style progress bars ("... 42%|####...") while separating.
_PROGRESS_RE = re.compile(r"(\d{1,3})%\|")


def separate_speech(
    audio_path: Path,
    output_dir: Path,
    device: str,
    progress_callback: Callable[[float], None] | None = None,
) -> tuple[Path, Path]:
    """
    Splits `audio_path` into (voice_path, background_path) WAV files under
    output_dir. Raises OutOfMemoryError if the GPU runs out of VRAM (caller
    can suggest switching to CPU mode), or CorruptAudioError for any other
    separation failure.
    """
    if not audio_path.exists():
        raise CorruptAudioError(f"Audio file for separation does not exist: {audio_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, "-m", "demucs",
        "-n", DEMUCS_MODEL,
        "--two-stems", "vocals",
        "-d", device,
        "-o", str(output_dir),
        str(audio_path),
    ]
    logger.info("Running Demucs separation on device=%s: %s", device, audio_path.name)

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
    )

    tail_lines: list[str] = []
    assert process.stdout is not None
    # tqdm progress bars end lines with \r, not \n, so read in chunks and
    # split on both — plain line iteration would only yield the bar once
    # it finishes.
    buffer = ""
    while chunk := process.stdout.read(256):
        buffer += chunk
        *lines, buffer = re.split(r"[\r\n]", buffer)
        for raw_line in lines:
            line = raw_line.rstrip()
            if not line:
                continue
            tail_lines.append(line)
            tail_lines[:] = tail_lines[-30:]  # keep only the tail for error reporting
            logger.debug("[demucs] %s", line)
            if progress_callback:
                match = _PROGRESS_RE.search(line)
                if match:
                    progress_callback(min(float(match.group(1)), 100.0))

    returncode = process.wait()

    if returncode != 0:
        tail = "\n".join(tail_lines)
        if "out of memory" in tail.lower() or "cuda error" in tail.lower():
            raise OutOfMemoryError(
                "The GPU ran out of memory during speech separation. "
                "Try switching to CPU mode in Settings, or use a shorter video.",
                details={"stage": "separate_speech", "device": device},
            )
        raise CorruptAudioError(f"Speech separation failed (exit code {returncode}): {tail}")

    track_name = audio_path.stem
    result_dir = output_dir / DEMUCS_MODEL / track_name
    voice_path = result_dir / "vocals.wav"
    background_path = result_dir / "no_vocals.wav"

    if not voice_path.exists() or not background_path.exists():
        raise CorruptAudioError(
            f"Demucs finished but expected output files are missing in {result_dir}"
        )

    logger.info("Separation complete: voice=%s background=%s", voice_path, background_path)
    return voice_path, background_path
