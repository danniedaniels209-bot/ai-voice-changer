"""
Voice conversion via RVC (Retrieval-based Voice Conversion).

The actual synthesizer network and inference pipeline come from the
`rvc-python` package (pip-installed with --no-deps — see requirements.txt),
which vendors the real RVC-Project architecture: code whose layer shapes
must exactly match public .pth checkpoints, so we use it as-is rather than
reimplementing it. `app.rvc_lib.patch` removes its only hard-to-satisfy
dependency (fairseq) by swapping in a fairseq-free HuggingFace `transformers`
content encoder before rvc_python is imported — see that module's docstring
for the full explanation.
"""

from __future__ import annotations

import threading
from pathlib import Path

import soundfile as sf
import torch

from app.core.errors import (
    CorruptAudioError,
    InvalidModelFileError,
    ModelNotFoundError,
    OutOfMemoryError,
)
from app.core.logging import get_logger
from app.rvc_lib import patch as rvc_patch
from app.schemas.rvc import VoiceConversionParams

logger = get_logger(__name__)

rvc_patch.apply()

from rvc_python.infer import RVCInference  # noqa: E402 — must import after patch.apply()

_lock = threading.Lock()
_rvc_instance: RVCInference | None = None
_loaded_model_key: tuple[str, str | None] | None = None


def _detect_model_version(pth_path: Path) -> str:
    """
    Public RVC checkpoints record whether they're the legacy 256-dim (v1) or
    modern 768-dim (v2) architecture. Trusting a fixed default instead of
    reading it would silently load mismatched weights (strict=False in
    rvc_python's net_g.load_state_dict swallows shape mismatches rather than
    raising), producing garbage audio instead of a clear error.
    """
    try:
        checkpoint = torch.load(pth_path, map_location="cpu", weights_only=False)
        if isinstance(checkpoint, dict):
            return checkpoint.get("version", "v1")
    except Exception as exc:
        logger.warning(
            "Could not detect RVC model version for %s, defaulting to v2: %s", pth_path, exc
        )
    return "v2"


class _ForceCpuDuringInit:
    """
    rvc_python's internal Config is a process-wide singleton that
    auto-detects CUDA itself the first time it's constructed, ignoring the
    device string it was given whenever a GPU is physically present. To
    honor an explicit "cpu" device-mode override from Settings on that
    first construction, CUDA is made to look unavailable to torch only for
    the duration of that one call.
    """

    def __enter__(self):
        self._real_is_available = torch.cuda.is_available
        torch.cuda.is_available = lambda: False
        return self

    def __exit__(self, *exc_info):
        torch.cuda.is_available = self._real_is_available


def _get_rvc(device: str) -> RVCInference:
    """
    Returns the process-wide RVCInference instance, creating it on first
    use. Because of the Config singleton described above, the device mode
    is effectively fixed for the backend process's lifetime once this is
    first called — changing CPU/GPU mode in Settings requires restarting
    the backend for voice conversion specifically (Demucs and FFmpeg are
    unaffected and pick up the new mode immediately).
    """
    global _rvc_instance

    if _rvc_instance is not None:
        return _rvc_instance

    torch_device = f"{device}:0"
    logger.info(
        "Initializing RVC inference engine on device=%s (first use — "
        "downloads the content encoder and pitch model on first run)...",
        torch_device,
    )

    if device == "cpu":
        with _ForceCpuDuringInit():
            _rvc_instance = RVCInference(device=torch_device)
    else:
        _rvc_instance = RVCInference(device=torch_device)

    return _rvc_instance


def convert_voice(
    voice_wav_path: Path,
    output_wav_path: Path,
    model_pth_path: Path,
    index_path: Path | None,
    params: VoiceConversionParams,
    device: str,
) -> Path:
    """
    Runs RVC voice conversion on an isolated voice track (Demucs output),
    producing a new WAV with the target model's voice but the original
    speaker's content/timing/emotion. Raises OutOfMemoryError on GPU OOM,
    CorruptAudioError if conversion fails or produces invalid output, and
    ModelNotFoundError if the .pth is missing.
    """
    if not model_pth_path.exists():
        raise ModelNotFoundError(f"RVC model weights not found: {model_pth_path}")
    if not voice_wav_path.exists():
        raise CorruptAudioError(f"Voice track for conversion does not exist: {voice_wav_path}")

    output_wav_path.parent.mkdir(parents=True, exist_ok=True)
    version = _detect_model_version(model_pth_path)

    global _loaded_model_key
    with _lock:
        rvc = _get_rvc(device)

        model_key = (str(model_pth_path), str(index_path) if index_path else None)
        if _loaded_model_key != model_key:
            logger.info("Loading RVC model %s (version=%s)", model_pth_path.name, version)
            try:
                rvc.load_model(
                    str(model_pth_path),
                    version=version,
                    index_path=str(index_path) if index_path else "",
                )
            except Exception as exc:
                _loaded_model_key = None
                raise InvalidModelFileError(
                    f"'{model_pth_path.name}' could not be loaded as an RVC model — it may be "
                    f"corrupt, incomplete, or not a valid RVC .pth checkpoint.",
                    details={"stage": "load_model", "underlying_error": str(exc)},
                ) from exc
            _loaded_model_key = model_key

        rvc.set_params(
            f0up_key=params.pitch_semitones,
            f0method=params.f0_method,
            index_rate=params.index_rate,
            filter_radius=params.filter_radius,
            resample_sr=params.sample_rate,
            rms_mix_rate=params.rms_mix_rate,
            protect=params.protect,
        )

        try:
            rvc.infer_file(str(voice_wav_path), str(output_wav_path))
        except torch.cuda.OutOfMemoryError as exc:
            torch.cuda.empty_cache()
            raise OutOfMemoryError(
                "The GPU ran out of memory during voice conversion. "
                "Try switching to CPU mode in Settings, or use a shorter video.",
                details={"stage": "convert_voice", "device": device},
            ) from exc
        except RuntimeError as exc:
            if "out of memory" in str(exc).lower():
                torch.cuda.empty_cache()
                raise OutOfMemoryError(
                    "The GPU ran out of memory during voice conversion. "
                    "Try switching to CPU mode in Settings, or use a shorter video.",
                    details={"stage": "convert_voice", "device": device},
                ) from exc
            raise CorruptAudioError(f"Voice conversion failed: {exc}") from exc

    if not output_wav_path.exists():
        raise CorruptAudioError("Voice conversion did not produce an output file.")

    try:
        info = sf.info(str(output_wav_path))
        if info.frames == 0:
            raise CorruptAudioError("Voice conversion produced an empty audio file.")
    except sf.LibsndfileError as exc:
        raise CorruptAudioError(f"Voice conversion produced an unreadable audio file: {exc}") from exc

    logger.info("Voice conversion complete: %s", output_wav_path)
    return output_wav_path
