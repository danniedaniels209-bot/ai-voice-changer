"""ASS burn-in renderer: verifies the structural output (dialogue counts,
override tags, style fields) for each word_mode/animation combination the
5 built-in presets exercise. These don't render with libass itself (no
such binding here) — they check the .ass text is well-formed and encodes
the right semantics per libass's documented tag behavior."""

from pathlib import Path

import pytest

from app.subtitle_engine.ass_renderer import render_ass
from app.subtitle_engine.models import SubtitleCue, SubtitleWord
from app.subtitle_engine.presets import CAPCUT, CLASSIC, HIGHLIGHT, KARAOKE, WORD_POP


def _cue(**kw) -> SubtitleCue:
    defaults = dict(id="c1", start=0.0, end=2.0, text="hello brave world")
    defaults.update(kw)
    return SubtitleCue(**defaults)


def _timed_words() -> list[SubtitleWord]:
    return [
        SubtitleWord(text="hello", start=0.0, end=0.6),
        SubtitleWord(text="brave", start=0.6, end=1.2),
        SubtitleWord(text="world", start=1.2, end=2.0),
    ]


def test_classic_line_mode_emits_one_dialogue_with_fade(tmp_path: Path):
    out = render_ass([_cue()], CLASSIC, tmp_path / "classic.ass")
    text = out.read_text(encoding="utf-8")
    assert text.count("Dialogue:") == 1
    assert r"\fad(150,150)" in text
    assert "hello brave world" in text
    fields = _style_section(text).split(",")
    assert fields[_field_index("BorderStyle")] == "1"


def test_karaoke_mode_emits_one_dialogue_with_kf_per_word(tmp_path: Path):
    cue = _cue(words=_timed_words())
    out = render_ass([cue], KARAOKE, tmp_path / "karaoke.ass")
    text = out.read_text(encoding="utf-8")
    assert text.count("Dialogue:") == 1
    assert text.count(r"\kf") == 3
    # 0.6s word -> 60 centiseconds
    assert r"\kf60" in text


def test_word_pop_mode_emits_one_dialogue_per_word_with_pop_tag(tmp_path: Path):
    cue = _cue(words=_timed_words())
    out = render_ass([cue], WORD_POP, tmp_path / "word_pop.ass")
    text = out.read_text(encoding="utf-8")
    assert text.count("Dialogue:") == 3
    assert text.count(r"\fscx60\fscy60") == 3
    # Each word event's own timing, not the whole cue's.
    assert "0:00:00.00,0:00:00.60" in text
    assert "0:00:00.60,0:00:01.20" in text


def test_highlight_mode_shows_full_line_every_word_with_color_swap(tmp_path: Path):
    cue = _cue(words=_timed_words())
    out = render_ass([cue], HIGHLIGHT, tmp_path / "highlight.ass")
    text = out.read_text(encoding="utf-8")
    assert text.count("Dialogue:") == 3
    for line in [ln for ln in text.splitlines() if ln.startswith("Dialogue:")]:
        assert "hello" in line and "brave" in line and "world" in line
        assert r"\c" in line


def test_capcut_uses_opaque_box_border_style(tmp_path: Path):
    out = render_ass([_cue(words=_timed_words())], CAPCUT, tmp_path / "capcut.ass")
    text = out.read_text(encoding="utf-8")
    style_line = next(ln for ln in text.splitlines() if ln.startswith("Style:"))
    fields = style_line.split(",")
    # Format: ...BorderStyle, Outline, Shadow, Alignment,...
    border_style_index = _field_index("BorderStyle")
    assert fields[border_style_index] == "3"


def test_words_without_alignment_fall_back_to_proportional_split(tmp_path: Path):
    """No .words populated on the cue at all — karaoke mode must still
    produce a working sweep, not crash or emit zero events."""
    out = render_ass([_cue()], KARAOKE, tmp_path / "karaoke_fallback.ass")
    text = out.read_text(encoding="utf-8")
    assert text.count("Dialogue:") == 1
    assert text.count(r"\kf") == 3


def test_unknown_word_mode_raises_instead_of_silently_producing_nothing(tmp_path: Path):
    bad = CLASSIC.model_copy(update={"word_mode": "line"})
    object.__setattr__(bad, "word_mode", "line")  # sanity: model_copy path used elsewhere
    # Construct an actually-invalid style bypassing the Literal type check.
    broken = CLASSIC.model_dump()
    broken["word_mode"] = "not-a-real-mode"
    from app.subtitle_engine.models import SubtitleStyle

    with pytest.raises(Exception):
        SubtitleStyle.model_validate(broken)


def _style_section(text: str) -> str:
    return next(ln for ln in text.splitlines() if ln.startswith("Style:"))


_FORMAT_FIELDS = (
    "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
    "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
    "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
).split(", ")


def _field_index(name: str) -> int:
    return _FORMAT_FIELDS.index(name)
