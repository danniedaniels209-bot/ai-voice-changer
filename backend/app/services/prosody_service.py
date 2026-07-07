"""
Prosody Preservation Mode: keep the original speaker's delivery (emphasis,
intonation, rhythm, pauses, loudness dynamics) while changing only the voice
identity.

What each conversion engine can preserve is described in
ENGINE_PROSODY_CAPABILITIES, so the pipeline (and future engines) query one
registry instead of hardcoding per-engine behavior. To add an expressive
engine later: add its capability entry here, and give it an `adapt_*_params`
hook if it has prosody-relevant knobs.

For RVC, prosody preservation means two things:

1. Parameter adaptation (before conversion). RVC inherently keeps the
   source's timing, rhythm, pauses, and pitch contour — but its defaults
   trade delivery fidelity for target-voice similarity:
     - rms_mix_rate=1.0 replaces the source's loudness dynamics with the
       model's flat output envelope -> 0.0 keeps the speaker's dynamics.
     - protect=0.33 lets the model reshape consonants/breaths -> 0.5 (max)
       keeps the source articulation, at some cost to timbre similarity.
     - f0_method must be rmvpe: it tracks the source pitch contour (and
       with it, emphasis and intonation) far more faithfully than pm/harvest.

2. Loudness envelope transfer (after conversion). Even with the settings
   above, RVC's vocoder compresses dynamics. We measure the source's
   frame-by-frame RMS envelope and re-impose it on the converted audio,
   restoring word emphasis and relative loudness.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from app.core.errors import CorruptAudioError
from app.core.logging import get_logger
from app.schemas.rvc import VoiceConversionParams

logger = get_logger(__name__)

# What each engine can preserve when Prosody Preservation Mode is on.
# `supported` gates whether the pipeline runs the preservation steps at all;
# `limitation` is surfaced to the user in the job log when unsupported.
ENGINE_PROSODY_CAPABILITIES: dict[str, dict[str, Any]] = {
    "rvc": {
        "supported": True,
        "preserves": [
            "speaking rhythm and rate (inherent: output is time-aligned to input)",
            "pauses (inherent)",
            "pitch contour / intonation (source F0 is reused, shifted by a constant)",
            "word emphasis and relative loudness (via envelope transfer)",
            "consonant articulation and breaths (via protect=0.5)",
        ],
        "limitations": [
            "voice quality emotion cues (vocal fry, whisper, breathiness shifts) "
            "are only partially carried through the converted timbre",
        ],
    },
    "openvoice": {
        "supported": True,
        "preserves": [
            "emotion, emphasis, intonation, rhythm, pauses, and accent "
            "(inherent: OpenVoice converts only the voice's tone color)",
        ],
        "limitations": [
            "target similarity is softer than RVC's — the result carries the "
            "target's timbre but keeps more of the source speaker's character",
        ],
    },
    "tts": {
        "supported": False,
        "preserves": [],
        "limitation": (
            "TTS mode transcribes the speech to plain text and re-synthesizes it, "
            "so the original delivery (emphasis, intonation, rhythm, emotion) is "
            "discarded by design — only the words and approximate timing survive. "
            "Preserving delivery requires a voice conversion engine (use RVC mode), "
            "or an expressive VC model such as Seed-VC or DDDM-VC."
        ),
    },
}


def engine_supports_prosody(mode: str) -> bool:
    return bool(ENGINE_PROSODY_CAPABILITIES.get(mode, {}).get("supported"))


def unsupported_reason(mode: str) -> str:
    return ENGINE_PROSODY_CAPABILITIES.get(mode, {}).get(
        "limitation", f"Engine '{mode}' does not support prosody preservation."
    )


def adapt_rvc_params(params: VoiceConversionParams) -> VoiceConversionParams:
    """
    Returns a copy of `params` tuned for delivery preservation. The user's
    pitch settings (manual or auto) are kept — pitch *transposition* moves
    the whole contour without changing its shape, so it doesn't harm prosody.
    """
    return params.model_copy(
        update={
            "rms_mix_rate": 0.0,  # keep the source's loudness dynamics
            "protect": 0.5,  # maximum protection of consonants/breaths
            "f0_method": "rmvpe",  # most faithful pitch-contour tracking
        }
    )


# --- Loudness envelope transfer --------------------------------------------

_FRAME_SECONDS = 0.04  # ~40 ms frames: word-level dynamics without tremolo
_MAX_GAIN = 4.0  # cap correction so near-silent frames don't explode
_SMOOTH_FRAMES = 5  # moving-average window over the gain curve


def _rms_envelope(audio: np.ndarray, frame: int) -> np.ndarray:
    """Frame-wise RMS of a mono signal, one value per frame."""
    n_frames = max(1, len(audio) // frame)
    trimmed = audio[: n_frames * frame].reshape(n_frames, frame)
    return np.sqrt((trimmed**2).mean(axis=1) + 1e-12)


def transfer_loudness(
    source_path: Path, converted_path: Path, output_path: Path, weight: float = 1.0
) -> Path:
    """
    Re-imposes the source speech's loudness envelope onto the converted
    audio, frame by frame. The two files are aligned by relative position
    (RVC output is time-aligned with its input, so this is a near-1:1 map
    even if sample rates differ).

    `weight` (0-1) blends between the converted audio's own dynamics (0)
    and the full source envelope (1) — driven by the Prosody Preservation
    slider when continuity processing is enabled.
    """
    if not source_path.exists():
        raise CorruptAudioError(f"Prosody source does not exist: {source_path}")
    if not converted_path.exists():
        raise CorruptAudioError(f"Converted audio does not exist: {converted_path}")

    source, src_sr = sf.read(str(source_path), dtype="float32")
    converted, conv_sr = sf.read(str(converted_path), dtype="float32")
    src_mono = source.mean(axis=1) if source.ndim > 1 else source
    conv_mono = converted.mean(axis=1) if converted.ndim > 1 else converted

    src_env = _rms_envelope(src_mono, int(src_sr * _FRAME_SECONDS))
    conv_frame = int(conv_sr * _FRAME_SECONDS)
    conv_env = _rms_envelope(conv_mono, conv_frame)

    # Map the source envelope onto the converted frame grid by relative
    # position, then compute the per-frame gain that makes the converted
    # dynamics match the source's.
    positions = np.linspace(0, len(src_env) - 1, num=len(conv_env))
    src_env_aligned = np.interp(positions, np.arange(len(src_env)), src_env)
    gain = np.clip(src_env_aligned / conv_env, 0.0, _MAX_GAIN)

    if len(gain) > _SMOOTH_FRAMES:
        kernel = np.ones(_SMOOTH_FRAMES) / _SMOOTH_FRAMES
        gain = np.convolve(gain, kernel, mode="same")

    weight = max(0.0, min(1.0, weight))
    if weight < 1.0:
        gain = 1.0 + (gain - 1.0) * weight

    # Expand frame gains to sample resolution and apply.
    sample_gain = np.repeat(gain, conv_frame)[: len(conv_mono)]
    if len(sample_gain) < len(conv_mono):  # tail frame shorter than `frame`
        sample_gain = np.pad(sample_gain, (0, len(conv_mono) - len(sample_gain)), mode="edge")

    if converted.ndim > 1:
        result = converted * sample_gain[:, None]
    else:
        result = converted * sample_gain

    peak = np.abs(result).max()
    if peak > 1.0:
        result = result / peak * 0.99

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), result, conv_sr, subtype="PCM_16")
    logger.info(
        "Loudness envelope transferred: %s -> %s (%d frames)",
        source_path.name,
        output_path.name,
        len(gain),
    )
    return output_path
