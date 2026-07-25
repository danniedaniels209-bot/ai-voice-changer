"""
Real per-word timing for the subtitle engine's karaoke/word/highlight modes.

The narration audio is synthesized speech reading exactly the cue text we
already have — so instead of fuzzy text matching, this transcribes the
final mixed audio with faster-whisper (word_timestamps=True) and walks its
flat word stream in chronological order, consuming len(cue.text.split())
real timestamps per cue. That's a much better anchor than the old
proportional-by-character-length guess, without needing a forced-aligner
dependency the project doesn't already have.

Falls back to the proportional split whenever whisper's word count doesn't
plausibly match what we expect (silence-eaten words, hallucinated extras,
transcription failure, ...) so a bad alignment pass degrades gracefully
instead of producing garbled timing or crashing the export.
"""

from __future__ import annotations

from pathlib import Path

from app.core.logging import get_logger
from app.subtitle_engine.models import SubtitleCue, SubtitleWord
from app.subtitle_engine.timing import proportional_words

logger = get_logger(__name__)

# If the real word count is off from the expected count by more than this
# fraction, whisper's pass is judged unreliable for this audio and every
# cue falls back to the proportional split instead of a partial mismatch.
_MISMATCH_TOLERANCE = 0.15


def _fallback(cues: list[SubtitleCue]) -> list[SubtitleCue]:
    return [cue.model_copy(update={"words": proportional_words(cue)}) for cue in cues]


def align_words(audio_path: Path, cues: list[SubtitleCue], device: str = "cpu") -> list[SubtitleCue]:
    """Returns `cues` with `.words` populated from real transcription
    timestamps where possible, else the proportional fallback. Never
    raises — alignment quality must never be able to break an export."""
    if not cues:
        return cues

    try:
        from app.services import transcribe_service

        segments = transcribe_service.transcribe(audio_path, device)
    except Exception as exc:  # noqa: BLE001 — alignment is best-effort
        logger.warning("Word alignment transcription failed, using proportional split: %s", exc)
        return _fallback(cues)

    flat_words = [w for seg in segments for w in (seg.words or [])]
    expected = sum(len(cue.text.split()) for cue in cues)
    if not flat_words or expected == 0 or abs(len(flat_words) - expected) / expected > _MISMATCH_TOLERANCE:
        logger.warning(
            "Word alignment count mismatch (got %d, expected %d), using proportional split",
            len(flat_words), expected,
        )
        return _fallback(cues)

    out: list[SubtitleCue] = []
    cursor = 0
    for cue in cues:
        tokens = cue.text.split()
        n = len(tokens)
        chunk = flat_words[cursor:cursor + n]
        cursor += n
        if len(chunk) != n:
            # Ran out of real words for this cue (shouldn't happen given the
            # count check above, but never trust an index into a partial
            # slice) — this cue alone falls back, the rest keep real timing.
            out.append(cue.model_copy(update={"words": proportional_words(cue)}))
            continue
        words = [
            SubtitleWord(
                text=token,
                # Clamp into the cue's own bounds: whisper's independent
                # pass can drift slightly from our known cue boundaries.
                start=min(max(w.start, cue.start), cue.end),
                end=min(max(w.end, cue.start), cue.end),
            )
            for token, w in zip(tokens, chunk)
        ]
        out.append(cue.model_copy(update={"words": words}))
    return out
