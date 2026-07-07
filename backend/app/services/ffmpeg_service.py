"""
All FFmpeg/ffprobe interaction lives here: probing uploaded videos,
extracting their audio track, and (later) muxing converted audio back in.

Everything is invoked as a subprocess writing directly to/from files on
disk — FFmpeg streams the media itself, so we never hold a video or long
audio buffer in Python memory.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app.core.errors import CorruptAudioError, FFmpegNotFoundError, InvalidVideoError
from app.core.logging import get_logger
from app.schemas.job import VideoMetadata
from app.utils.settings_store import get_effective_ffmpeg_path

logger = get_logger(__name__)

SUPPORTED_INPUT_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

# Standard intermediate format for every pipeline stage: uncompressed PCM
# WAV keeps Demucs/RVC/librosa lossless end-to-end; only the final export
# re-encodes to the video's audio codec.
PIPELINE_AUDIO_SAMPLE_RATE = 44100
PIPELINE_AUDIO_CHANNELS = 2


def resolve_ffmpeg_binaries() -> tuple[str, str]:
    """
    Returns (ffmpeg_path, ffprobe_path). Raises FFmpegNotFoundError with a
    clear message if either cannot be located, so callers never have to
    guess why a subprocess call failed.
    """
    ffmpeg_path = get_effective_ffmpeg_path()
    if not ffmpeg_path:
        raise FFmpegNotFoundError(
            "FFmpeg was not found. Place ffmpeg.exe in the ffmpeg/ folder, "
            "install it on your system PATH, or set a custom path in Settings."
        )

    ffmpeg_dir = Path(ffmpeg_path).parent
    candidate = ffmpeg_dir / "ffprobe.exe"
    if candidate.exists():
        ffprobe_path = str(candidate)
    else:
        ffprobe_path = shutil.which("ffprobe")

    if not ffprobe_path:
        raise FFmpegNotFoundError(
            "ffprobe was not found alongside ffmpeg or on system PATH. "
            "ffprobe ships with any standard FFmpeg build — reinstall FFmpeg "
            "or place ffprobe.exe next to ffmpeg.exe."
        )

    return ffmpeg_path, ffprobe_path


def _run(cmd: list[str], *, error_cls=InvalidVideoError, error_message: str) -> subprocess.CompletedProcess:
    logger.debug("Running: %s", " ".join(cmd))
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=None,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
    except FileNotFoundError as exc:
        raise FFmpegNotFoundError(f"Could not execute FFmpeg/ffprobe: {exc}") from exc

    if result.returncode != 0:
        stderr_tail = "\n".join(result.stderr.strip().splitlines()[-15:])
        raise error_cls(f"{error_message}: {stderr_tail}")

    return result


def probe_video(video_path: Path) -> VideoMetadata:
    """
    Validates the file is a readable video with a valid container/codec and
    extracts the metadata the pipeline needs. Raises InvalidVideoError for
    anything ffprobe can't parse (corrupt file, unsupported codec, etc.).
    """
    if video_path.suffix.lower() not in SUPPORTED_INPUT_EXTENSIONS:
        raise InvalidVideoError(
            f"Unsupported video format '{video_path.suffix}'. "
            f"Supported formats: {', '.join(sorted(SUPPORTED_INPUT_EXTENSIONS))}"
        )

    _, ffprobe_path = resolve_ffmpeg_binaries()

    result = _run(
        [
            ffprobe_path,
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(video_path),
        ],
        error_message=f"'{video_path.name}' could not be read as a valid video",
    )

    try:
        probe = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise InvalidVideoError(f"ffprobe returned unparseable output for '{video_path.name}'") from exc

    streams = probe.get("streams", [])
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

    if not video_streams:
        raise InvalidVideoError(f"'{video_path.name}' does not contain a video stream.")

    video_stream = video_streams[0]
    audio_stream = audio_streams[0] if audio_streams else None

    duration_raw = probe.get("format", {}).get("duration") or video_stream.get("duration")
    try:
        duration = float(duration_raw) if duration_raw is not None else 0.0
    except ValueError:
        duration = 0.0

    return VideoMetadata(
        duration_seconds=duration,
        width=video_stream.get("width"),
        height=video_stream.get("height"),
        video_codec=video_stream.get("codec_name"),
        has_audio=audio_stream is not None,
        audio_codec=audio_stream.get("codec_name") if audio_stream else None,
        audio_sample_rate=int(audio_stream["sample_rate"]) if audio_stream and audio_stream.get("sample_rate") else None,
    )


def extract_audio(video_path: Path, output_wav_path: Path) -> Path:
    """
    Extracts the video's audio track to a standalone PCM WAV file, resampled
    to a fixed rate/channel layout so every downstream stage (Demucs, RVC,
    librosa) can assume a consistent format.
    """
    ffmpeg_path, _ = resolve_ffmpeg_binaries()
    output_wav_path.parent.mkdir(parents=True, exist_ok=True)

    _run(
        [
            ffmpeg_path,
            "-y",
            "-i", str(video_path),
            "-vn",  # drop video stream entirely
            "-acodec", "pcm_s16le",
            "-ar", str(PIPELINE_AUDIO_SAMPLE_RATE),
            "-ac", str(PIPELINE_AUDIO_CHANNELS),
            str(output_wav_path),
        ],
        error_cls=CorruptAudioError,
        error_message=f"Failed to extract audio from '{video_path.name}'",
    )

    if not output_wav_path.exists() or output_wav_path.stat().st_size == 0:
        raise CorruptAudioError(f"Audio extraction produced an empty file for '{video_path.name}'")

    return output_wav_path


_h264_encoder_cache: str | None = None

# Preference order: libx264 (best quality control) -> libopenh264 ->
# MediaFoundation (always present on Windows) -> mpeg4 as a last resort.
_H264_CANDIDATES = ["libx264", "libopenh264", "h264_mf", "mpeg4"]

# libx264 takes -crf; the other encoders only do bitrate control, so map the
# app's CRF quality tiers onto sensible 1080p-ish bitrates.
_CRF_TO_BITRATE = {"0": "12M", "18": "8M", "23": "5M", "28": "2500k"}


def _h264_encoder() -> str:
    """Detects (once per process) which H.264 encoder this ffmpeg build has."""
    global _h264_encoder_cache
    if _h264_encoder_cache is None:
        ffmpeg_path, _ = resolve_ffmpeg_binaries()
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        available = result.stdout
        _h264_encoder_cache = next(
            (c for c in _H264_CANDIDATES if f" {c} " in available), "mpeg4"
        )
        logger.info("Using video encoder: %s", _h264_encoder_cache)
    return _h264_encoder_cache


def _video_encode_args(video_crf: str) -> list[str]:
    encoder = _h264_encoder()
    if encoder == "libx264":
        return ["-c:v", "libx264", "-crf", video_crf, "-preset", "medium"]
    bitrate = _CRF_TO_BITRATE.get(video_crf, "5M")
    return ["-c:v", encoder, "-b:v", bitrate, "-pix_fmt", "yuv420p"]


def _subtitles_filter_arg(srt_path: Path) -> str:
    """
    ffmpeg's subtitles filter parses its argument, so Windows paths need the
    drive colon escaped and backslashes flipped: C\\:/path/to/subs.srt
    """
    posix = srt_path.resolve().as_posix().replace(":", r"\:")
    if srt_path.suffix.lower() == ".ass":
        # ASS files carry their own styling (e.g. the word-pop captions) —
        # force_style would override it.
        return f"subtitles='{posix}'"
    style = "FontName=Arial,FontSize=18,Bold=1,Outline=2,MarginV=40"
    return f"subtitles='{posix}':force_style='{style}'"


def mux_audio_into_video(
    video_path: Path,
    audio_path: Path,
    output_video_path: Path,
    *,
    video_crf: str = "18",
    audio_bitrate: str = "256k",
    normalize_loudness: bool = False,
    burn_subtitles_path: Path | None = None,
) -> Path:
    """
    Replaces the video's audio track with a new one. The video itself must
    stay unchanged per spec — only the voice changes — so this stream-copies
    the video track (`-c:v copy`, no re-encoding, bit-exact) by default.
    That only fails when the source codec genuinely can't be held by an MP4
    container as-is (e.g. some WEBM/VP9 or exotic AVI codecs); in that case
    it falls back to re-encoding with libx264 so the export doesn't just fail.
    """
    ffmpeg_path, _ = resolve_ffmpeg_binaries()
    output_video_path.parent.mkdir(parents=True, exist_ok=True)

    base_cmd = [
        ffmpeg_path,
        "-y",
        "-i", str(video_path),
        "-i", str(audio_path),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:a", "aac",
        "-b:a", audio_bitrate,
        "-shortest",
    ]
    if normalize_loudness:
        # YouTube's loudness target. Single-pass loudnorm is accurate enough
        # for speech content and avoids decoding the audio twice.
        base_cmd += ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11"]

    encode_args = _video_encode_args(video_crf)

    if burn_subtitles_path is not None:
        # Burning captions draws on the video image, which requires
        # re-encoding — stream-copy is not possible in this case.
        _run(
            [*base_cmd, "-vf", _subtitles_filter_arg(burn_subtitles_path), *encode_args, str(output_video_path)],
            error_cls=InvalidVideoError,
            error_message=f"Failed to burn captions into '{video_path.name}'",
        )
    else:
        try:
            _run(
                [*base_cmd, "-c:v", "copy", str(output_video_path)],
                error_cls=InvalidVideoError,
                error_message=f"Failed to mux final audio into '{video_path.name}'",
            )
        except InvalidVideoError:
            logger.warning(
                "Stream-copy mux failed for '%s' (source codec likely incompatible "
                "with MP4 as-is) — falling back to re-encoding the video.",
                video_path.name,
            )
            _run(
                [*base_cmd, *encode_args, str(output_video_path)],
                error_cls=InvalidVideoError,
                error_message=f"Failed to mux final audio into '{video_path.name}' (re-encode fallback)",
            )

    if not output_video_path.exists() or output_video_path.stat().st_size == 0:
        raise InvalidVideoError(f"Final video export produced an empty file for '{video_path.name}'")

    return output_video_path


def export_vertical_variant(
    source_video_path: Path,
    output_video_path: Path,
    *,
    video_crf: str = "18",
) -> Path:
    """
    Produces a 9:16 center-cropped variant (for Shorts/Reels) of an already
    finished export. Audio is stream-copied; only the video is re-encoded.
    """
    ffmpeg_path, _ = resolve_ffmpeg_binaries()
    output_video_path.parent.mkdir(parents=True, exist_ok=True)

    _run(
        [
            ffmpeg_path,
            "-y",
            "-i", str(source_video_path),
            # Center-crop to 9:16 using the full source height. ih*9/16 can
            # exceed iw only for already-vertical sources, so clamp with min.
            "-vf", "crop='min(iw,ih*9/16)':ih,scale=1080:1920:flags=lanczos",
            *_video_encode_args(video_crf),
            "-c:a", "copy",
            str(output_video_path),
        ],
        error_cls=InvalidVideoError,
        error_message=f"Failed to export vertical variant of '{source_video_path.name}'",
    )

    if not output_video_path.exists() or output_video_path.stat().st_size == 0:
        raise InvalidVideoError(f"Vertical export produced an empty file for '{source_video_path.name}'")

    return output_video_path
