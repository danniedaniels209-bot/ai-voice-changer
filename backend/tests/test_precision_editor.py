"""
Precision word placement + segment editor guarantees:
- phrase splitting anchors to real word timestamps at natural boundaries
- strict fitting keeps phrases inside their own windows (no pause borrowing)
- the content-hash cache makes unedited re-renders free and edited ones fresh
"""

import numpy as np
import pytest
import soundfile as sf

from app.services import alignment_service, tts_service
from app.services.transcribe_service import SpeechSegment, WordInfo
from app.services.tts_service import TIMELINE_SR


def _words(spec):
    """spec: list of (word, start, end)"""
    return [WordInfo(word=w, start=s, end=e, probability=0.95) for w, s, e in spec]


def test_split_at_speech_gaps():
    seg = SpeechSegment(
        0.0, 6.0, "hello there now continue speaking",
        words=_words([
            ("hello", 0.0, 0.4), ("there", 0.45, 0.9),
            # 1.1s silence — a clear phrase boundary
            ("now", 2.0, 2.3), ("continue", 2.35, 2.9), ("speaking", 2.95, 3.5),
        ]),
    )
    phrases = alignment_service.split_to_phrases([seg])
    assert len(phrases) == 2
    assert phrases[0].text == "hello there"
    assert phrases[0].start == 0.0 and abs(phrases[0].end - 0.9) < 1e-6
    assert phrases[1].start == 2.0  # anchored exactly where "now" was spoken
    assert phrases[1].text == "now continue speaking"


def test_split_preserves_every_word_exactly_once():
    spec = [(f"w{i}", i * 0.5, i * 0.5 + 0.4) for i in range(30)]
    seg = SpeechSegment(0.0, 15.0, " ".join(w for w, _, _ in spec), words=_words(spec))
    phrases = alignment_service.split_to_phrases([seg])
    rejoined = " ".join(p.text for p in phrases).split()
    assert rejoined == [w for w, _, _ in spec]  # nothing lost, nothing duplicated
    for a, b in zip(phrases, phrases[1:]):
        assert a.end <= b.start + 1e-6  # chronological, non-overlapping


def test_segments_without_words_pass_through():
    seg = SpeechSegment(1.0, 3.0, "no word data here")
    assert alignment_service.split_to_phrases([seg]) == [seg]


@pytest.fixture
def fake_engine(monkeypatch, tmp_path):
    durations: dict[str, float] = {}
    calls: list[str] = []

    def fake_synth(text, output_path, reference_wav, exaggeration, device="cpu",
                   stability=None, seed=0):
        calls.append(f"{text}|{seed}")
        t = np.linspace(0, durations.get(text, 1.0), int(TIMELINE_SR * durations.get(text, 1.0)), endpoint=False)
        sf.write(str(output_path), (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32),
                 TIMELINE_SR, format="WAV")
        return output_path

    ref = tmp_path / "ref.wav"
    sf.write(str(ref), np.zeros(TIMELINE_SR, dtype=np.float32), TIMELINE_SR)

    import app.services.chatterbox_service as cbs
    import app.services.expressive_service as exs

    monkeypatch.setattr(cbs, "synthesize", fake_synth)
    monkeypatch.setattr(exs, "ensure_reference_audio", lambda voice_id: ref)
    return durations, calls


def test_strict_fit_does_not_borrow_trailing_pause(fake_engine, tmp_path):
    durations, _ = fake_engine
    # 2.4s audio, 2.0s window, 2s pause after: normal fit borrows the pause
    # untouched; STRICT fit must instead tempo-fit into ~the original window.
    durations.update({"tight line": 2.4, "next": 1.0})
    segments = [SpeechSegment(0.0, 2.0, "tight line"), SpeechSegment(4.0, 5.5, "next")]
    _, placements = tts_service.synthesize_timeline(
        segments, "en-US-GuyNeural", 6.0, tmp_path / "w", tmp_path / "o.wav",
        engine="chatterbox", strict_fit=True,
    )
    assert placements[0].end <= 2.0 + 0.15 + 0.02  # only the tiny strict allowance


def test_cache_reuses_unedited_and_rerenders_edited(fake_engine, tmp_path):
    durations, calls = fake_engine
    durations.update({"same line": 1.0, "edited line": 1.0, "old line": 1.0})
    segs = [SpeechSegment(0.0, 1.5, "same line"), SpeechSegment(2.0, 3.5, "old line")]
    work = tmp_path / "w"

    tts_service.synthesize_timeline(segs, "en-US-GuyNeural", 5.0, work, tmp_path / "a.wav",
                                    engine="chatterbox")
    first_calls = len(calls)
    assert first_calls == 2

    # "Re-export": one line edited, one untouched.
    segs2 = [SpeechSegment(0.0, 1.5, "same line"), SpeechSegment(2.0, 3.5, "edited line")]
    tts_service.synthesize_timeline(segs2, "en-US-GuyNeural", 5.0, work, tmp_path / "b.wav",
                                    engine="chatterbox")
    assert len(calls) == first_calls + 1  # ONLY the edited line re-rendered
    assert calls[-1].startswith("edited line|")


def test_new_take_seed_busts_cache(fake_engine, tmp_path):
    durations, calls = fake_engine
    durations.update({"a line": 1.0})
    segs = [SpeechSegment(0.0, 1.5, "a line")]
    work = tmp_path / "w"
    tts_service.synthesize_timeline(segs, "en-US-GuyNeural", 3.0, work, tmp_path / "a.wav",
                                    engine="chatterbox")
    tts_service.synthesize_timeline(segs, "en-US-GuyNeural", 3.0, work, tmp_path / "b.wav",
                                    engine="chatterbox", seeds={0: 1})
    assert calls == ["a line|0", "a line|1"]  # seed change = fresh take


def test_synthesize_single_matches_timeline_cache(fake_engine, tmp_path):
    durations, calls = fake_engine
    durations.update({"preview me": 1.0})
    work = tmp_path / "w"
    # Editor preview first...
    tts_service.synthesize_single(work, "preview me", "en-US-GuyNeural",
                                  engine="chatterbox", seed=0)
    # ...then the full re-export must reuse that exact render.
    tts_service.synthesize_timeline(
        [SpeechSegment(0.0, 1.5, "preview me")], "en-US-GuyNeural", 3.0, work,
        tmp_path / "o.wav", engine="chatterbox",
    )
    assert len(calls) == 1  # one synthesis serves both
