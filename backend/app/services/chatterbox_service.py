"""
Human-like local narration via Resemble AI's Chatterbox TTS (MIT license,
~2.1 GB, cached under the Hugging Face hub directory).

Compared with the edge-tts engine, Chatterbox:
  - runs fully locally after the one-time weights download,
  - clones any voice from a few seconds of reference audio (this app feeds
    it the same cached reference clips used by OpenVoice, so the built-in
    narrator voices are all available as clone targets),
  - exposes an emotion-exaggeration dial (0 = flat/monotone, 0.5 = neutral
    default, 1 = highly dramatic).

The trade-off is speed: it is a 0.5B-parameter model, so CPU generation
takes several seconds per sentence.
"""

from __future__ import annotations

import threading
from pathlib import Path

from app.core.errors import SynthesisError
from app.core.logging import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()
# Torch modules are not safe for concurrent generate() calls from multiple
# pipeline workers — serialize synthesis on the shared model instance.
_synth_lock = threading.Lock()
_model = None
_model_device: str | None = None


def _get_model(device: str):
    global _model, _model_device
    with _lock:
        if _model is None or _model_device != device:
            try:
                from chatterbox.tts import ChatterboxTTS
            except ImportError as exc:
                raise SynthesisError(
                    f"Chatterbox is not installed correctly: {exc}"
                ) from exc

            logger.info("Loading Chatterbox TTS (device=%s) — first load takes a while...", device)
            from app.core.config import Paths

            local_dir = Paths.models / "chatterbox"
            required = ["ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"]
            try:
                if all((local_dir / f).exists() for f in required):
                    # Weights downloaded directly into models/chatterbox/
                    # (bypasses the HF hub client, which stalls on some networks).
                    _model = ChatterboxTTS.from_local(str(local_dir), device=device)
                else:
                    _model = ChatterboxTTS.from_pretrained(device=device)
            except Exception as exc:
                raise SynthesisError(
                    f"Could not load the Chatterbox model: {exc}. Its weights "
                    "(~3 GB) must finish downloading into models/chatterbox/ first."
                ) from exc
            _model_device = device
        return _model


def synthesize(
    text: str,
    output_path: Path,
    reference_wav: Path | None,
    exaggeration: float,
    device: str = "cpu",
    stability: float | None = None,
) -> Path:
    """
    Generates `text` as speech. With `reference_wav`, the voice is cloned
    from that audio; without it, Chatterbox's built-in voice is used.

    `stability` (0-1, from the continuity settings) counters per-segment
    identity drift — generation is stochastic, so consecutive segments
    otherwise sound like slightly different "takes" of the voice:
      - a fixed random seed makes every segment draw the same noise,
      - higher cfg_weight pulls generation harder toward the reference,
      - lower temperature narrows sampling toward the model's confident
        (and therefore more consistent) outputs.
    """
    import torch

    if "cuda" in device and not torch.cuda.is_available():
        device = "cpu"

    model = _get_model(device)

    kwargs = {}
    if stability is not None:
        s = max(0.0, min(1.0, stability))
        kwargs["cfg_weight"] = 0.3 + 0.5 * s  # default 0.5 at s=0.4
        kwargs["temperature"] = 1.0 - 0.5 * s  # default 0.8 at s=0.4
        torch.manual_seed(42)  # same noise draws per segment = consistent takes

    try:
        with _synth_lock:
            wav = model.generate(
                text,
                audio_prompt_path=str(reference_wav) if reference_wav else None,
                exaggeration=max(0.0, min(1.0, exaggeration)),
                **kwargs,
            )
    except Exception as exc:
        raise SynthesisError(f"Chatterbox synthesis failed: {exc}") from exc

    import torchaudio

    output_path.parent.mkdir(parents=True, exist_ok=True)
    torchaudio.save(str(output_path), wav.cpu(), model.sr)

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise SynthesisError(f"Chatterbox produced no audio for: '{text[:60]}...'")
    return output_path
