"""
Timeline reconstruction guarantees: chronological order, no missing or
duplicate segments, bounded overlap, duration-aware fitting, and validation
that aborts instead of exporting corrupt audio.
"""

import numpy as np
import pytest
import soundfile as sf

from app.core.errors import SynthesisError
from app.services import tts_service
from app.services.transcribe_service import SpeechSegment
from app.services.tts_service import TIMELINE_SR, _validate_reconstruction


def _tone(seconds: float, freq: float = 220.0) -> np.ndarray:
    t = np.linspace(0, seconds, int(TIMELINE_SR * seconds), endpoint=False)
    return (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


@pytest.fixture
def fake_engine(monkeypatch, tmp_path):
    """Chatterbox mock whose per-segment audio duration we control by text."""
    durations: dict[str, float] = {}

    def fake_synth(text, output_path, reference_wav, exaggeration, device="cpu", stability=None, seed=0):
        sf.write(str(output_path), _tone(durations.get(text, 1.0)), TIMELINE_SR, format="WAV")
        return output_path

    ref = tmp_path / "ref.wav"
    sf.write(str(ref), np.zeros(TIMELINE_SR, dtype=np.float32), TIMELINE_SR)

    import app.services.chatterbox_service as cbs
    import app.services.expressive_service as exs

    monkeypatch.setattr(cbs, "synthesize", fake_synth)
    monkeypatch.setattr(exs, "ensure_reference_audio", lambda voice_id: ref)
    return durations


def test_unsorted_segments_are_placed_chronologically(fake_engine, tmp_path):
    fake_engine.update({"first": 1.0, "second": 1.0, "third": 1.0})
    # Deliberately out of order — reconstruction must sort by original time.
    segments = [
        SpeechSegment(6.0, 7.5, "third"),
        SpeechSegment(0.5, 2.0, "first"),
        SpeechSegment(3.0, 4.5, "second"),
    ]
    _, placements = tts_service.synthesize_timeline(
        segments, "en-US-GuyNeural", 9.0, tmp_path / "w", tmp_path / "o.wav", engine="chatterbox"
    )
    assert [p.text for p in placements] == ["first", "second", "third"]
    assert all(placements[i].start < placements[i + 1].start for i in range(2))


def test_overlong_segment_never_bleeds_into_next_slot(fake_engine, tmp_path):
    # 8s of audio for a 2s slot: even after the 2x tempo cap (-> 4s) it must
    # be truncated so it never overlaps the next segment's speech.
    fake_engine.update({"way too long": 8.0, "next one": 1.0})
    segments = [
        SpeechSegment(0.0, 2.0, "way too long"),
        SpeechSegment(2.0, 4.0, "next one"),
    ]
    out = tmp_path / "o.wav"
    _, placements = tts_service.synthesize_timeline(
        segments, "en-US-GuyNeural", 5.0, tmp_path / "w", out, engine="chatterbox"
    )
    # First placement must end at (or within a rounding hair of) the second's start.
    assert placements[0].end <= placements[1].start + 0.02
    assert len(placements) == 2


def test_every_segment_appears_exactly_once(fake_engine, tmp_path):
    texts = [f"chunk {i}" for i in range(6)]
    fake_engine.update({t: 0.8 for t in texts})
    segments = [SpeechSegment(i * 1.5, i * 1.5 + 1.0, t) for i, t in enumerate(texts)]
    _, placements = tts_service.synthesize_timeline(
        segments, "en-US-GuyNeural", 10.0, tmp_path / "w", tmp_path / "o.wav", engine="chatterbox"
    )
    assert [p.text for p in placements] == texts  # all present, once, in order


def test_validation_rejects_missing_segments():
    master = [(0, 0.0, 1.0, "a"), (1, 2.0, 3.0, "b")]
    fitted = [(0, SpeechSegment(0, 1, "a"), _tone(1.0), 0)]
    with pytest.raises(SynthesisError, match="MISSING.*segment #1"):
        _validate_reconstruction(fitted, master, fade_samples=0)


def test_validation_rejects_duplicates():
    master = [(0, 0.0, 1.0, "a"), (1, 2.0, 3.0, "b")]
    a = (0, SpeechSegment(0, 1, "a"), _tone(1.0), 0)
    dup = (0, SpeechSegment(0, 1, "a"), _tone(1.0), 0)
    with pytest.raises(SynthesisError, match="duplicate"):
        _validate_reconstruction([a, dup], master, fade_samples=0)


def test_validation_rejects_shifted_placement():
    master = [(0, 0.0, 2.0, "a")]
    # Placed at 1s instead of its original 0s.
    shifted = (0, SpeechSegment(0, 2, "a"), _tone(1.0), TIMELINE_SR)
    with pytest.raises(SynthesisError, match="SHIFTED"):
        _validate_reconstruction([shifted], master, fade_samples=0)


def test_validation_rejects_overrun_past_original_end():
    master = [(0, 0.0, 2.0, "a"), (1, 2.0, 4.0, "b")]
    a = (0, SpeechSegment(0, 2, "a"), _tone(3.0), 0)  # 3s audio for a 2s segment
    b = (1, SpeechSegment(2, 4, "b"), _tone(1.0), 2 * TIMELINE_SR)
    with pytest.raises(SynthesisError, match="OVERRUN"):
        _validate_reconstruction([a, b], master, fade_samples=0)


def test_short_audio_leaves_original_silence_intact(fake_engine, tmp_path):
    # 0.5s of speech for a 3s segment: the remaining 2.5s must stay silent,
    # exactly where the original had its pause - never pulled earlier.
    fake_engine.update({"short": 0.5, "after": 1.0})
    segments = [SpeechSegment(0.0, 3.0, "short"), SpeechSegment(4.0, 5.5, "after")]
    out = tmp_path / "o.wav"
    tts_service.synthesize_timeline(
        segments, "en-US-GuyNeural", 6.0, tmp_path / "w", out, engine="chatterbox"
    )
    audio, sr = sf.read(str(out), dtype="float32")
    gap = audio[int(3.2 * sr) : int(3.8 * sr)]  # inside the original pause
    assert np.abs(gap).max() < 1e-4


def test_moderate_overrun_borrows_trailing_pause_instead_of_stretching(fake_engine, tmp_path):
    # 2.4s of audio for a 2s segment followed by a 2s pause: the overflow
    # fits in the allowed half-gap, so the speech must NOT be tempo-mangled
    # and must end inside the borrowed window (never at the next start).
    fake_engine.update({"a bit long": 2.4, "next": 1.0})
    segments = [SpeechSegment(0.0, 2.0, "a bit long"), SpeechSegment(4.0, 5.5, "next")]
    _, placements = tts_service.synthesize_timeline(
        segments, "en-US-GuyNeural", 6.0, tmp_path / "w", tmp_path / "o.wav", engine="chatterbox"
    )
    assert abs(placements[0].end - 2.4) < 0.05  # untouched, not stretched
    assert placements[0].end <= 3.0 + 0.02  # inside the borrow allowance
    assert placements[1].start == 4.0  # next segment unmoved
