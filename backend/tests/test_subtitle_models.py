"""Data model + preset registry sanity: every built-in preset must be a
valid SubtitleStyle and round-trip through JSON exactly like the frontend
would receive it from the API."""

from app.subtitle_engine.models import SubtitleCue, SubtitleStyle, SubtitleWord
from app.subtitle_engine.presets import BUILTIN_PRESETS, DEFAULT_PRESET_ID, get_preset


def test_every_builtin_preset_is_a_valid_style():
    for preset in BUILTIN_PRESETS:
        assert isinstance(preset, SubtitleStyle)
        assert preset.id
        assert preset.word_mode in ("line", "word", "karaoke", "highlight")


def test_preset_ids_are_unique():
    ids = [p.id for p in BUILTIN_PRESETS]
    assert len(ids) == len(set(ids))


def test_get_preset_returns_requested_style():
    assert get_preset("karaoke").id == "karaoke"


def test_get_preset_falls_back_to_default_for_unknown_id():
    assert get_preset("does-not-exist").id == DEFAULT_PRESET_ID


def test_get_preset_falls_back_to_default_for_none():
    assert get_preset(None).id == DEFAULT_PRESET_ID


def test_style_round_trips_through_json():
    preset = get_preset("capcut")
    restored = SubtitleStyle.model_validate_json(preset.model_dump_json())
    assert restored == preset


def test_cue_words_default_to_empty_list():
    cue = SubtitleCue(id="c1", start=0.0, end=1.0, text="hello world")
    assert cue.words == []


def test_cue_with_words_round_trips():
    cue = SubtitleCue(
        id="c1", start=0.0, end=1.0, text="hi",
        words=[SubtitleWord(text="hi", start=0.0, end=1.0)],
    )
    restored = SubtitleCue.model_validate_json(cue.model_dump_json())
    assert restored == cue
