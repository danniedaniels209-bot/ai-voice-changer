"""
Local speech-to-text via faster-whisper, producing timestamped segments the
TTS stage re-voices one by one. Runs fully offline after the first model
download (weights are cached under the Hugging Face cache directory).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import TranscriptionError
from app.core.logging import get_logger

logger = get_logger(__name__)

_model_lock = threading.Lock()
_model_cache: dict[tuple[str, str], object] = {}


@dataclass
class WordInfo:
    word: str
    start: float
    end: float
    probability: float  # Whisper's own confidence in this word


@dataclass
class SpeechSegment:
    start: float  # seconds
    end: float
    text: str
    # Per-word confidence data when word timestamps were requested; used by
    # the context-recognition layer. None keeps older callers unaffected.
    words: list[WordInfo] | None = None


def _get_model(device: str):
    """
    Loads (and caches) the Whisper model. faster-whisper models are heavy;
    loading once per process and reusing across jobs matters.
    """
    from faster_whisper import WhisperModel

    model_size = get_settings().whisper_model
    # int8 on CPU halves memory with negligible quality loss; float16 is
    # the native fast path on CUDA.
    compute_type = "float16" if device == "cuda" else "int8"
    key = (model_size, device)

    with _model_lock:
        if key not in _model_cache:
            logger.info("Loading Whisper model '%s' (device=%s, %s)...", model_size, device, compute_type)
            try:
                _model_cache[key] = WhisperModel(model_size, device=device, compute_type=compute_type)
            except Exception as exc:
                raise TranscriptionError(
                    f"Could not load the Whisper speech recognition model '{model_size}': {exc}. "
                    "The first run needs internet access to download the model."
                ) from exc
        return _model_cache[key]


def transcribe(
    audio_path: Path,
    device: str,
    progress_callback=None,
) -> list[SpeechSegment]:
    """
    Transcribes `audio_path` into timestamped segments. `progress_callback`
    (if given) receives 0-100 as transcription advances through the audio.
    Raises TranscriptionError if nothing intelligible is found — better to
    fail loudly than export a silent voice track.
    """
    if not audio_path.exists():
        raise TranscriptionError(f"Audio file to transcribe does not exist: {audio_path}")

    model = _get_model(device)
    logger.info("Transcribing %s ...", audio_path.name)

    try:
        segments_iter, info = model.transcribe(  # type: ignore[attr-defined]
            str(audio_path),
            vad_filter=True,  # skip non-speech so music/noise doesn't hallucinate text
            beam_size=5,
            # Per-word confidence for the context-recognition layer.
            word_timestamps=True,
            # Soft domain bias (NOT a dictionary): nudges decoding toward
            # keeping technical tokens instead of "fixing" them into common
            # English words. Whisper treats this as preceding context only.
            initial_prompt=(
                "This recording may mention AI models, software products, "
                "programming languages, frameworks, APIs, company names, "
                "and other technical terminology."
            ),
        )
    except Exception as exc:
        raise TranscriptionError(f"Speech transcription failed: {exc}") from exc

    total = info.duration or 1.0
    segments: list[SpeechSegment] = []
    for seg in segments_iter:
        text = seg.text.strip()
        if not text:
            continue
        words = None
        if seg.words:
            words = [
                WordInfo(word=w.word.strip(), start=w.start, end=w.end, probability=w.probability)
                for w in seg.words
            ]
        segments.append(SpeechSegment(start=seg.start, end=seg.end, text=text, words=words))
        if progress_callback:
            progress_callback(min(seg.end / total * 100.0, 100.0))

    if not segments:
        raise TranscriptionError(
            "No speech could be detected in this video's audio track, so there "
            "is nothing to re-voice. (Detected language: "
            f"{info.language}, probability {info.language_probability:.0%})"
        )

    logger.info(
        "Transcription complete: %d segment(s), language=%s (%.0f%%)",
        len(segments),
        info.language,
        info.language_probability * 100,
    )
    return segments
