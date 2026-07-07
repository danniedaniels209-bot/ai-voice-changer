"""
Export Manager — turns the assembled narration into deliverables: audio in
wav/mp3/flac/aac/ogg, plus optional .srt subtitles and a timestamps JSON.
Encoding goes through ffmpeg (already required by the app).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from app.core.errors import AppError
from app.utils.subtitles import SubtitleCue, write_srt

_FORMATS = {
    "wav": [],
    "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
    "flac": ["-c:a", "flac"],
    "aac": ["-c:a", "aac", "-b:a", "192k"],
    "ogg": ["-c:a", "libvorbis", "-q:a", "6"],
}


def export_audio(narration_wav: Path, fmt: str) -> Path:
    if fmt not in _FORMATS:
        raise AppError(f"Unsupported export format '{fmt}'. Use: {', '.join(_FORMATS)}")
    if fmt == "wav":
        return narration_wav

    from app.services.ffmpeg_service import resolve_ffmpeg_binaries

    ffmpeg_path, _ = resolve_ffmpeg_binaries()
    out = narration_wav.with_suffix(f".{fmt}")
    result = subprocess.run(
        [ffmpeg_path, "-y", "-i", str(narration_wav), *_FORMATS[fmt], str(out)],
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
    )
    if result.returncode != 0 or not out.exists():
        tail = "\n".join(result.stderr.strip().splitlines()[-5:])
        raise AppError(f"Export to {fmt} failed: {tail}")
    return out


def export_subtitles(timestamps: list[dict], out_path: Path) -> Path:
    cues = [SubtitleCue(t["start"], t["end"], t["text"]) for t in timestamps]
    return write_srt(cues, out_path)


def export_timestamps(timestamps: list[dict], out_path: Path) -> Path:
    out_path.write_text(json.dumps(timestamps, indent=2), encoding="utf-8")
    return out_path
