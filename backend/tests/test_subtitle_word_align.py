"""Word alignment: real per-word timestamps come from transcribing the
final mixed audio and walking its flat word stream in cue order. Must
degrade gracefully (proportional fallback) whenever that transcription is
unavailable or its word count doesn't plausibly match the cues."""

from pathlib import Path

from app.subtitle_engine.models import SubtitleCue
from app.subtitle_engine.word_align import align_words


def _cues() -> list[SubtitleCue]:
    return [
        SubtitleCue(id="a", start=0.0, end=2.0, text="hello brave world"),
        SubtitleCue(id="b", start=2.0, end=3.0, text="goodbye now"),
    ]


def _fake_segments(word_specs):
    """word_specs: list of (word, start, end) tuples -> a fake
    transcribe_service.SpeechSegment-shaped object list."""
    from app.services.transcribe_service import SpeechSegment, WordInfo

    words = [WordInfo(word=w, start=s, end=e, probability=1.0) for w, s, e in word_specs]
    return [SpeechSegment(start=words[0].start, end=words[-1].end, text=" ".join(w for w, _, _ in word_specs), words=words)]


def test_matching_word_count_uses_real_timestamps(monkeypatch):
    from app.services import transcribe_service

    specs = [
        ("hello", 0.0, 0.5), ("brave", 0.5, 1.0), ("world", 1.0, 1.8),
        ("goodbye", 2.0, 2.6), ("now", 2.6, 3.0),
    ]
    monkeypatch.setattr(transcribe_service, "transcribe", lambda *a, **kw: _fake_segments(specs))

    result = align_words(Path("fake.wav"), _cues())
    assert [w.text for w in result[0].words] == ["hello", "brave", "world"]
    assert result[0].words[0].start == 0.0
    assert result[0].words[2].end == 1.8
    assert [w.text for w in result[1].words] == ["goodbye", "now"]


def test_word_timestamps_are_clamped_into_their_cues_bounds(monkeypatch):
    """Whisper's independent pass can drift slightly outside the cue's
    known boundaries — clamp so downstream rendering never gets a word
    interval that starts before or ends after its own cue."""
    from app.services import transcribe_service

    specs = [
        ("hello", -0.2, 0.5), ("brave", 0.5, 1.0), ("world", 1.0, 2.4),
        ("goodbye", 1.9, 2.6), ("now", 2.6, 3.4),
    ]
    monkeypatch.setattr(transcribe_service, "transcribe", lambda *a, **kw: _fake_segments(specs))

    result = align_words(Path("fake.wav"), _cues())
    assert result[0].words[0].start == 0.0  # clamped up to cue.start
    assert result[0].words[2].end == 2.0  # clamped down to cue.end
    assert result[1].words[0].start == 2.0  # clamped up to cue.start
    assert result[1].words[1].end == 3.0  # clamped down to cue.end


def test_mismatched_word_count_falls_back_to_proportional_split(monkeypatch):
    from app.services import transcribe_service

    # Only 2 real words for 5 expected — way outside tolerance.
    specs = [("hello", 0.0, 0.5), ("world", 0.5, 1.0)]
    monkeypatch.setattr(transcribe_service, "transcribe", lambda *a, **kw: _fake_segments(specs))

    result = align_words(Path("fake.wav"), _cues())
    assert [w.text for w in result[0].words] == ["hello", "brave", "world"]
    # Fallback timing is proportional, not the (wrong) real timestamps.
    assert result[0].words[0].end != 0.5


def test_transcription_failure_falls_back_to_proportional_split(monkeypatch):
    from app.services import transcribe_service

    def boom(*a, **kw):
        raise RuntimeError("no ffmpeg / model unavailable")

    monkeypatch.setattr(transcribe_service, "transcribe", boom)

    result = align_words(Path("fake.wav"), _cues())
    assert len(result[0].words) == 3
    assert len(result[1].words) == 2


def test_empty_cues_returns_empty_without_transcribing(monkeypatch):
    called = []
    from app.services import transcribe_service

    monkeypatch.setattr(transcribe_service, "transcribe", lambda *a, **kw: called.append(1))

    assert align_words(Path("fake.wav"), []) == []
    assert not called
