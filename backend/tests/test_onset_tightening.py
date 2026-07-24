"""
Onset-tightening: leading/trailing silence is trimmed from each rendered clip
so the first spoken sound lands exactly on the segment's original timestamp,
without ever dropping speech or emptying a clip.
"""

import numpy as np
import soundfile as sf

from app.services import tts_service
from app.services.tts_service import TIMELINE_SR, _trim_silence_edges
from app.services.transcribe_service import SpeechSegment


def _tone(seconds: float, amp: float = 0.3, freq: float = 220.0) -> np.ndarray:
    t = np.linspace(0, seconds, int(TIMELINE_SR * seconds), endpoint=False)
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(TIMELINE_SR * seconds), dtype=np.float32)


# ---- pure function --------------------------------------------------------

def test_trims_leading_and_trailing_silence():
    clip = np.concatenate([_silence(0.5), _tone(1.0), _silence(0.5)])
    out = _trim_silence_edges(clip, TIMELINE_SR)
    # Roughly the tone plus two 25 ms margins — the half-second pads are gone.
    assert len(out) < len(clip)
    expected = TIMELINE_SR * (1.0 + 2 * 0.025)
    assert abs(len(out) - expected) < TIMELINE_SR * 0.05


def test_keeps_a_margin_so_attack_is_not_clipped():
    clip = np.concatenate([_silence(0.3), _tone(0.5)])
    out = _trim_silence_edges(clip, TIMELINE_SR)
    # First audible sound should sit ~one margin in, not at index 0.
    onset = int(np.argmax(np.abs(out) > 0.05))
    assert 0 < onset <= int(0.025 * TIMELINE_SR) + 5


def test_pure_silence_is_never_emptied():
    clip = _silence(1.0)
    out = _trim_silence_edges(clip, TIMELINE_SR)
    assert len(out) == len(clip)  # unchanged, not emptied


def test_clip_without_silence_is_unchanged():
    clip = _tone(1.0)
    out = _trim_silence_edges(clip, TIMELINE_SR)
    assert len(out) == len(clip)


def test_no_speech_energy_is_lost():
    """Total energy inside the tone survives — only silence is removed."""
    clip = np.concatenate([_silence(0.4), _tone(0.8), _silence(0.4)])
    out = _trim_silence_edges(clip, TIMELINE_SR)
    assert abs(float((out**2).sum()) - float((clip**2).sum())) < 1e-3


# ---- end-to-end through the timeline --------------------------------------

def test_onset_lands_on_timestamp_after_trimming(monkeypatch, tmp_path):
    """A clip synthesized with 0.5 s of leading silence must still start its
    audible speech at the segment's timestamp, not half a second late."""
    import app.services.chatterbox_service as cbs
    import app.services.expressive_service as exs

    def synth_with_silence(text, output_path, reference_wav, exaggeration,
                           device="cpu", stability=None, seed=0):
        clip = np.concatenate([_silence(0.5), _tone(1.0), _silence(0.5)])
        sf.write(str(output_path), clip, TIMELINE_SR, format="WAV")
        return output_path

    ref = tmp_path / "ref.wav"
    sf.write(str(ref), _silence(1.0), TIMELINE_SR)
    monkeypatch.setattr(cbs, "synthesize", synth_with_silence)
    monkeypatch.setattr(exs, "ensure_reference_audio", lambda v: ref)

    seg_start = 2.0
    out = tmp_path / "o.wav"
    tts_service.synthesize_timeline(
        [SpeechSegment(seg_start, seg_start + 2.0, "hello")],
        "en-US-GuyNeural", 6.0, tmp_path / "w", out, engine="chatterbox",
    )
    audio, sr = sf.read(str(out), dtype="float32")
    onset = int(np.argmax(np.abs(audio) > 0.05)) / sr
    # Without trimming the onset would be seg_start + 0.5 = 2.5 s.
    assert abs(onset - seg_start) < 0.06
