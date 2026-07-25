"""Per-word timing shared by word_align.py (which populates it for real)
and ass_renderer.py (which needs a words list regardless of whether real
alignment ran)."""

from __future__ import annotations

from app.subtitle_engine.models import SubtitleCue, SubtitleWord


def proportional_words(cue: SubtitleCue) -> list[SubtitleWord]:
    """Honest approximation when real timing isn't available: split the
    cue's duration across its words proportionally to word length."""
    words = cue.text.split()
    if not words:
        return []
    total_chars = sum(len(w) for w in words) or 1
    duration = max(cue.end - cue.start, 0.05)
    t = cue.start
    out: list[SubtitleWord] = []
    for w in words:
        share = duration * (len(w) / total_chars)
        end = min(t + share, cue.end)
        out.append(SubtitleWord(text=w, start=t, end=end))
        t = end
    return out


def effective_words(cue: SubtitleCue) -> list[SubtitleWord]:
    """Real per-word timing when word_align populated it, else the
    proportional fallback — the single place every word-timed renderer
    should get its word list from."""
    return list(cue.words) if cue.words else proportional_words(cue)
