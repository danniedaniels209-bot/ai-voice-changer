"""
Precision word placement — anchors synthesized speech to where the ORIGINAL
words were spoken.

Standard placement anchors whole Whisper segments (or merged chunks) at
their start time; words inside a long segment can drift because synthesized
pacing differs from the speaker's. Precision mode uses the word-level
timestamps Whisper already produces to split speech into short PHRASES at
natural boundaries (speech gaps, punctuation), each carrying its own exact
original start/end. Every phrase is then placed and duration-fitted
independently, so words land where they were meant to be.

Opt-in by design (a toggle on the Home page): smaller units mean the TTS
engine gets less context per utterance, which can sound slightly less
flowing — the user chooses word-accuracy vs. flow. Off = behavior is
byte-identical to before this module existed.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.services.transcribe_service import SpeechSegment, WordInfo

logger = get_logger(__name__)

# A silence between words longer than this is a natural phrase boundary.
GAP_BOUNDARY_S = 0.35
# Punctuation that ends a phrase (when the phrase is already long enough).
_PHRASE_END = (".", ",", "!", "?", ";", ":")
# Bounds keeping phrases synthesizable: long enough to sound natural,
# short enough that intra-phrase drift stays imperceptible.
MIN_PHRASE_S = 0.6
MAX_PHRASE_S = 6.0


def _make_segment(words: list[WordInfo]) -> SpeechSegment:
    text = " ".join(w.word for w in words).strip()
    return SpeechSegment(
        start=words[0].start,
        end=words[-1].end,
        text=text,
        words=list(words),
    )


def split_to_phrases(segments: list[SpeechSegment]) -> list[SpeechSegment]:
    """
    Splits transcription segments into word-anchored phrases. Segments
    without word data pass through unchanged (they can't be anchored more
    precisely than they already are).
    """
    phrases: list[SpeechSegment] = []

    for seg in segments:
        if not seg.words:
            phrases.append(seg)
            continue

        current: list[WordInfo] = []
        for i, w in enumerate(seg.words):
            current.append(w)
            duration = current[-1].end - current[0].start
            next_word = seg.words[i + 1] if i + 1 < len(seg.words) else None

            boundary = False
            if next_word is not None:
                gap = next_word.start - w.end
                if gap >= GAP_BOUNDARY_S and duration >= MIN_PHRASE_S:
                    boundary = True
                elif w.word.rstrip().endswith(_PHRASE_END) and duration >= 1.5:
                    boundary = True
                elif duration >= MAX_PHRASE_S:
                    boundary = True

            if boundary:
                phrases.append(_make_segment(current))
                current = []

        if current:
            phrases.append(_make_segment(current))

    logger.info(
        "Precision alignment: %d segment(s) -> %d word-anchored phrase(s)",
        len(segments),
        len(phrases),
    )
    return phrases
