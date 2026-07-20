"""
Translation dubbing: translates transcribed segments into a target language
before synthesis. Timing is untouched — each translated line inherits its
source segment's exact window, so every downstream guarantee (master
timeline, precision placement, the segment editor) applies unchanged.

Translation runs on the local Qwen LLM (scriptgen.llm), so like the Script
Studio it is GPU-gated: available in cloud sessions, cleanly refused on a
CPU laptop. All segments go through in ONE numbered-lines call to keep GPU
time low; a per-line fallback covers any parse mismatch.
"""

from __future__ import annotations

import re

from app.core.errors import AppError
from app.core.logging import get_logger
from app.services.transcribe_service import SpeechSegment

logger = get_logger(__name__)

LANGUAGES = {
    "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese (Brazil)",
    "hi": "Hindi", "it": "Italian", "ja": "Japanese", "ko": "Korean",
    "ar": "Arabic", "ru": "Russian",
}

_SYSTEM = (
    "You are a professional subtitle translator. Translate into {language} "
    "for spoken narration: natural, conversational phrasing of similar spoken "
    "length to the source. Keep product names, model names, company names, "
    "and technical terms in their original form. Output ONLY the translated "
    "lines, same numbering, one per line, nothing else."
)


def _parse_numbered(raw: str, expected: int) -> list[str] | None:
    lines: dict[int, str] = {}
    for line in raw.splitlines():
        m = re.match(r"\s*(\d+)\s*[.):\-]\s*(.+)", line)
        if m:
            lines[int(m.group(1))] = m.group(2).strip()
    if len(lines) != expected:
        return None
    return [lines[i] for i in sorted(lines)] if set(lines) == set(range(1, expected + 1)) else None


def translate_segments(segments: list[SpeechSegment], target_lang: str) -> list[SpeechSegment]:
    """Returns new segments with translated text and identical timing."""
    from app.scriptgen import llm

    language = LANGUAGES.get(target_lang)
    if not language:
        raise AppError(f"Unsupported dubbing language '{target_lang}'. Use: {', '.join(LANGUAGES)}")
    ok, reason = llm.availability()
    if not ok:
        raise AppError(f"Translation dubbing needs the GPU language model: {reason}")

    numbered = "\n".join(f"{i + 1}. {s.text}" for i, s in enumerate(segments))
    raw = llm.generate(
        _SYSTEM.format(language=language),
        numbered,
        max_new_tokens=min(4000, 60 * len(segments) + 200),
    )
    translated = _parse_numbered(raw, len(segments))

    if translated is None:
        logger.warning("Batch translation parse mismatch — falling back to per-line calls.")
        translated = []
        for s in segments:
            line = llm.generate(
                _SYSTEM.format(language=language), f"1. {s.text}", max_new_tokens=300
            )
            parsed = _parse_numbered(line, 1)
            translated.append(parsed[0] if parsed else line.strip())

    logger.info("Translated %d segment(s) into %s.", len(segments), language)
    return [
        SpeechSegment(start=s.start, end=s.end, text=t, words=None)
        for s, t in zip(segments, translated)
    ]
