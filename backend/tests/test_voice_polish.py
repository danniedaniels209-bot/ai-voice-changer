"""Voice-polish DSP: each refinement is bounded and never drops speech."""

import numpy as np

from app.services import voice_polish
from app.services.voice_polish import PolishConfig


SR = 24000


def _tone(seconds: float, amp: float = 0.3, freq: float = 220.0) -> np.ndarray:
    t = np.linspace(0, seconds, int(SR * seconds), endpoint=False)
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SR * seconds), dtype=np.float32)


# ---- config ---------------------------------------------------------------

def test_config_roundtrip_and_defaults():
    c = PolishConfig()
    assert c.level_loudness and c.declick and c.smart_tempo and c.soft_limiter
    assert c.voice_presence is False
    assert PolishConfig.from_dict(c.to_dict()) == c
    assert PolishConfig.from_dict(None) == c
    assert PolishConfig.from_dict({"declick": False}).declick is False


# ---- declick --------------------------------------------------------------

def test_declick_fades_edges_without_changing_length():
    clip = _tone(0.5)
    out = voice_polish.declick(clip, SR)
    assert len(out) == len(clip)
    assert abs(out[0]) < abs(clip[0]) + 1e-6  # first sample attenuated
    assert abs(out[-1]) <= abs(clip[-1]) + 1e-6
    # Middle is untouched.
    mid = len(clip) // 2
    assert out[mid] == clip[mid]


# ---- loudness leveling ----------------------------------------------------

def test_level_gain_is_bounded_and_partial():
    # A very quiet clip is boosted, but only partially and within bounds.
    g = voice_polish.level_gain(rms=0.05, target_rms=0.5)
    assert 1.0 < g <= 1.4
    # A loud clip is pulled down, bounded.
    g2 = voice_polish.level_gain(rms=1.0, target_rms=0.1)
    assert 0.7 <= g2 < 1.0
    # Silence never divides by zero.
    assert voice_polish.level_gain(0.0, 0.3) == 1.0


# ---- smart tempo (internal pause compression) -----------------------------

def test_compress_internal_pauses_shrinks_gap_keeps_speech():
    clip = np.concatenate([_tone(0.5), _silence(0.6), _tone(0.5)])
    out = voice_polish.compress_internal_pauses(clip, SR)
    assert len(out) < len(clip)  # the 0.6s internal gap was shrunk
    # Both speech bursts survive — total tone energy is preserved.
    assert abs(float((out**2).sum()) - float((clip**2).sum())) < 1e-2


def test_compress_leaves_edge_silence_alone():
    # Leading/trailing silence is an edge, not an internal pause — untouched.
    clip = np.concatenate([_silence(0.5), _tone(0.5)])
    out = voice_polish.compress_internal_pauses(clip, SR)
    assert len(out) == len(clip)


def test_compress_no_pause_is_unchanged():
    clip = _tone(1.0)
    out = voice_polish.compress_internal_pauses(clip, SR)
    assert len(out) == len(clip)


# ---- soft limiter ---------------------------------------------------------

def test_soft_limiter_tames_peaks_keeps_quiet_linear():
    loud = np.array([2.0, -2.0, 0.9], dtype=np.float32)
    out = voice_polish.soft_limiter(loud)
    assert np.all(np.abs(out) < 0.98 + 1e-6)  # nothing exceeds the ceiling
    quiet = np.array([0.05, -0.05], dtype=np.float32)
    qout = voice_polish.soft_limiter(quiet)
    assert np.allclose(qout, quiet, atol=0.01)  # near-linear for small signals


# ---- presence EQ ----------------------------------------------------------

def test_presence_eq_preserves_shape_and_is_finite():
    voice = np.stack([_tone(0.5), _tone(0.5)], axis=1)  # (frames, 2)
    out = voice_polish.presence_eq(voice, SR)
    assert out.shape == voice.shape
    assert np.all(np.isfinite(out))
    mono = _tone(0.5)
    assert voice_polish.presence_eq(mono, SR).shape == mono.shape
