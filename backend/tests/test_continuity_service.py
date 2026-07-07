import numpy as np
import soundfile as sf

from app.services import continuity_service as cs
from app.services.transcribe_service import SpeechSegment


def test_merge_bridges_brief_pauses():
    segments = [
        SpeechSegment(0.0, 2.0, "Hello there,"),
        SpeechSegment(2.3, 4.0, "this continues the sentence."),  # 0.3s gap
        SpeechSegment(7.0, 9.0, "A new thought after a long pause."),  # 3s gap
    ]
    merged = cs.merge_segments(segments, context_window=0.5)
    assert len(merged) == 2
    assert merged[0].text == "Hello there, this continues the sentence."
    assert merged[0].start == 0.0 and merged[0].end == 4.0


def test_merge_bridges_unfinished_sentences_across_bigger_gaps():
    segments = [
        SpeechSegment(0.0, 2.0, "I was thinking"),  # no terminal punctuation
        SpeechSegment(3.0, 5.0, "about the plan."),  # 1.0s gap, bridged
        SpeechSegment(6.1, 8.0, "Done deal."),  # 1.1s gap after finished sentence: split
    ]
    merged = cs.merge_segments(segments, context_window=0.5)
    assert [m.text for m in merged] == ["I was thinking about the plan.", "Done deal."]


def test_merge_respects_adaptive_cap():
    # Continuous speech far beyond the short-window cap must still split.
    segments = [SpeechSegment(i * 2.0, i * 2.0 + 1.9, f"part {i}") for i in range(20)]
    merged_short = cs.merge_segments(segments, context_window=0.0)  # cap 8s
    merged_long = cs.merge_segments(segments, context_window=1.0)  # cap 30s
    assert len(merged_short) > len(merged_long) > 1
    assert all(m.end - m.start <= cs.max_chunk_seconds(0.0) + 1e-6 for m in merged_short)


def test_edge_fades_remove_hard_onsets():
    audio = np.ones(1000, dtype=np.float32)
    faded = cs.apply_edge_fades(audio, 100)
    assert faded[0] < 0.01  # starts from silence
    assert faded[-1] < 0.01  # ends in silence
    assert faded[500] == 1.0  # middle untouched


def test_rolling_memory_pulls_toward_trend():
    memory = cs.RollingEnergyMemory(context_window=0.5, strength=1.0)
    loud = np.full(1000, 0.5, dtype=np.float32)
    quiet = np.full(1000, 0.1, dtype=np.float32)

    memory.adapt(loud)  # establishes the trend
    adapted = memory.adapt(quiet)
    # The quiet segment is pulled up toward the loud trend (bounded at 1.6x).
    assert adapted.mean() > quiet.mean() * 1.3


def test_smooth_voice_track_reduces_level_steps(tmp_path):
    sr = 16000
    t = np.linspace(0, 2.0, sr * 2, endpoint=False)
    tone = np.sin(2 * np.pi * 220 * t).astype(np.float32)
    # Hard loudness step in the middle: 0.2 -> 0.8
    stepped = tone * np.where(t < 1.0, 0.2, 0.8).astype(np.float32)
    src = tmp_path / "in.wav"
    sf.write(str(src), stepped, sr)

    out = tmp_path / "out.wav"
    cs.smooth_voice_track(src, out, naturalness=100)
    smoothed, _ = sf.read(str(out), dtype="float32")

    margin = sr // 8
    before = np.sqrt((smoothed[sr - margin : sr] ** 2).mean())
    after = np.sqrt((smoothed[sr : sr + margin] ** 2).mean())
    orig_ratio = 0.8 / 0.2
    new_ratio = after / before
    assert new_ratio < orig_ratio * 0.75  # the step got measurably softer


def test_smooth_voice_track_zero_naturalness_is_noop(tmp_path):
    sr = 16000
    audio = np.random.default_rng(0).uniform(-0.5, 0.5, sr).astype(np.float32)
    src = tmp_path / "in.wav"
    sf.write(str(src), audio, sr)
    out = tmp_path / "out.wav"
    cs.smooth_voice_track(src, out, naturalness=0)
    result, _ = sf.read(str(out), dtype="float32")
    assert np.allclose(result, audio, atol=1e-4)
