"""
Expressive voice conversion via OpenVoice's tone-color converter (vendored
under backend/openvoice, MIT license, MyShell.ai).

Unlike RVC, OpenVoice is explicitly designed to change ONLY the voice's
timbre while preserving the source delivery — emotion, emphasis, rhythm,
pauses, and accent all pass through. Its target voice comes from reference
AUDIO rather than a trained model file, so this app generates the reference
from any of its built-in TTS narrator voices (cached per voice): pick "Guy",
speak in your own style, come out sounding like Guy delivering it your way.
"""

from __future__ import annotations

import threading
from pathlib import Path

from app.core.config import Paths
from app.core.errors import AppError, SynthesisError
from app.core.logging import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()
# Serialize conversions and reference creation across pipeline workers: the
# converter is a shared torch module, and the reference cache is shared
# between concurrent jobs targeting the same voice.
_convert_lock = threading.Lock()
_reference_lock = threading.Lock()
_converter = None
_converter_device: str | None = None

# Reference text synthesized once per target voice. Several varied sentences
# give the speaker-embedding extractor a stable picture of the voice.
_REFERENCE_TEXT = (
    "The quick brown fox jumps over the lazy dog. "
    "I can't believe how well this turned out! "
    "Every morning, the city slowly comes to life. "
    "Numbers like three hundred forty seven matter too. "
    "Where do you think we should go next? "
    "This is the last sentence of the reference recording."
)


def _checkpoint_dir() -> Path:
    """Locates the downloaded converter checkpoint in the HF cache."""
    from huggingface_hub import snapshot_download

    try:
        # local_files_only: never blocks on the network — the checkpoint is
        # downloaded ahead of time (or on first use with internet).
        path = Path(snapshot_download("myshell-ai/OpenVoiceV2", allow_patterns=["converter/*"], local_files_only=True))
    except Exception:
        logger.info("OpenVoice checkpoint not cached yet — downloading (~131 MB)...")
        path = Path(snapshot_download("myshell-ai/OpenVoiceV2", allow_patterns=["converter/*"]))
    return path / "converter"


def _get_converter(device: str):
    """Loads (once per process) the tone color converter."""
    global _converter, _converter_device
    with _lock:
        if _converter is None or _converter_device != device:
            from openvoice.api import ToneColorConverter

            ckpt_dir = _checkpoint_dir()
            config = ckpt_dir / "config.json"
            checkpoint = ckpt_dir / "checkpoint.pth"
            if not config.exists() or not checkpoint.exists():
                raise AppError(
                    "The OpenVoice converter checkpoint is missing. It downloads "
                    "automatically on first use — check your internet connection."
                )

            logger.info("Loading OpenVoice tone color converter (device=%s)...", device)
            converter = ToneColorConverter(str(config), device=device, enable_watermark=False)
            converter.load_ckpt(str(checkpoint))
            _converter = converter
            _converter_device = device
        return _converter


def ensure_reference_audio(voice_id: str) -> Path:
    """
    Returns a wav of the target TTS voice reading the reference text,
    synthesizing and caching it on first use (needs internet once per voice).
    """
    from app.services.tts_service import _synthesize_one, is_known_voice

    # "My Voices": user-provided samples are already reference audio — both
    # Chatterbox and OpenVoice clone from them directly.
    from app.utils import custom_voices

    if custom_voices.is_custom_voice(voice_id):
        return custom_voices.voice_path(voice_id)

    if not is_known_voice(voice_id):
        raise SynthesisError(f"Unknown target voice '{voice_id}'.")

    cache_dir = Paths.models / "openvoice_references"
    cache_dir.mkdir(parents=True, exist_ok=True)
    wav_path = cache_dir / f"{voice_id}.wav"
    if wav_path.exists():
        return wav_path

    with _reference_lock:
        if wav_path.exists():  # another job created it while we waited
            return wav_path

        import os
        import subprocess
        import uuid

        from app.services.ffmpeg_service import resolve_ffmpeg_binaries

        # Unique temp names + atomic rename: a concurrent job can never read
        # a half-written reference file.
        token = uuid.uuid4().hex[:8]
        mp3_path = cache_dir / f".{voice_id}.{token}.mp3"
        tmp_wav = cache_dir / f".{voice_id}.{token}.wav"

        logger.info("Synthesizing OpenVoice reference audio for %s...", voice_id)
        _synthesize_one(_REFERENCE_TEXT, voice_id, mp3_path)

        ffmpeg_path, _ = resolve_ffmpeg_binaries()
        result = subprocess.run(
            [ffmpeg_path, "-y", "-i", str(mp3_path), "-ar", "22050", "-ac", "1", str(tmp_wav)],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        mp3_path.unlink(missing_ok=True)
        if result.returncode != 0 or not tmp_wav.exists():
            raise SynthesisError(f"Could not prepare reference audio for '{voice_id}'.")
        os.replace(tmp_wav, wav_path)  # atomic on the same volume
        return wav_path


def convert_expressive(
    source_path: Path,
    output_path: Path,
    target_voice_id: str,
    device: str,
) -> Path:
    """
    Converts `source_path` speech to the target voice's timbre while keeping
    the original delivery. tau=0.3 is OpenVoice's recommended conversion
    strength — higher sounds more like the target but flattens expression.
    """
    if not source_path.exists():
        raise AppError(f"Audio to convert does not exist: {source_path}")

    # OpenVoice asserts CUDA when given a cuda device string; degrade safely.
    import torch

    if "cuda" in device and not torch.cuda.is_available():
        device = "cpu"

    reference_wav = ensure_reference_audio(target_voice_id)
    converter = _get_converter(device)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with _convert_lock:
        source_se = converter.extract_se([str(source_path)])
        target_se = converter.extract_se([str(reference_wav)])
        converter.convert(
            audio_src_path=str(source_path),
            src_se=source_se,
            tgt_se=target_se,
            output_path=str(output_path),
            tau=0.3,
        )

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise AppError("Expressive conversion produced no audio.")

    logger.info("Expressive conversion complete: %s -> %s", source_path.name, output_path.name)
    return output_path
