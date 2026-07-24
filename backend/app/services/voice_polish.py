"""
Voice-quality polish — optional audio refinements applied to the synthesized
narration, each independently toggled by the user on the New Conversion page
(never a hidden global setting). All functions are pure numpy/scipy, bounded,
and safe: they refine loudness/edges/dynamics but never drop or reorder
speech, so the master-timeline guarantees are untouched.

Toggles:
  level_loudness  — pull each clip's loudness toward a common level so no
                    segment jumps out (the biggest "amateur AI voice" tell).
  declick         — tiny raised-cosine fades on every clip edge so segment
                    boundaries don't click/pop.
  smart_tempo     — when a segment is too long for its slot, shrink the
                    silences INSIDE it before speeding up the words, so
                    speech stays natural instead of sounding rushed.
  voice_presence  — a gentle presence-band EQ lift so the voice cuts through
                    a background music bed (applied only when mixing music).
  soft_limiter    — soft-knee (tanh) limiting instead of hard peak-normalize:
                    consistent punch without crushed dynamics.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class PolishConfig:
    level_loudness: bool = True
    declick: bool = True
    smart_tempo: bool = True
    voice_presence: bool = False
    soft_limiter: bool = True

    @classmethod
    def from_dict(cls, data: dict | None) -> "PolishConfig":
        if not data:
            return cls()
        fields = {f: bool(data[f]) for f in cls.__dataclass_fields__ if f in data}
        return cls(**fields)

    def to_dict(self) -> dict:
        return {f: getattr(self, f) for f in self.__dataclass_fields__}


def declick(audio: np.ndarray, sr: int, fade_ms: float = 8.0) -> np.ndarray:
    """Raised-cosine fade on both edges — removes boundary clicks/pops.
    Length is unchanged (fades multiply in place), so placement is unaffected."""
    n = len(audio)
    fade = min(int(sr * fade_ms / 1000.0), n // 2)
    if fade < 2:
        return audio
    ramp = (0.5 * (1.0 - np.cos(np.linspace(0.0, np.pi, fade)))).astype(np.float32)
    out = audio.copy()
    out[:fade] *= ramp
    out[-fade:] *= ramp[::-1]
    return out


def level_gain(
    rms: float, target_rms: float, lo: float = 0.7, hi: float = 1.4, strength: float = 0.7
) -> float:
    """Bounded, partial gain pulling a clip's RMS toward `target_rms`. Bounds
    and partial strength preserve genuine emphasis — a segment is nudged
    toward the common level, never forced flat."""
    if rms < 1e-6 or target_rms < 1e-6:
        return 1.0
    g = float(np.clip(target_rms / rms, lo, hi))
    return 1.0 + (g - 1.0) * strength


def compress_internal_pauses(
    audio: np.ndarray,
    sr: int,
    floor_db: float = -40.0,
    min_pause_s: float = 0.18,
    keep_s: float = 0.10,
) -> np.ndarray:
    """
    Shrink long near-silences INSIDE a clip to `keep_s`, leaving a natural
    micro-pause. Only internal dead air is removed — never speech, never the
    clip's leading/trailing edges — so this can only shorten the clip, which
    helps it fit its slot without speeding up the words. Splices happen inside
    near-silence, so they don't click.
    """
    if audio.size == 0:
        return audio
    peak = float(np.abs(audio).max())
    if peak < 1e-4:
        return audio
    threshold = peak * (10.0 ** (floor_db / 20.0))
    quiet = np.abs(audio) < threshold
    min_len = int(min_pause_s * sr)
    keep_len = max(1, int(keep_s * sr))

    parts: list[np.ndarray] = []
    i, n = 0, len(audio)
    changed = False
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            run = j - i
            # Internal only: a pause touching the start (i==0) or end (j==n) is
            # a leading/trailing edge — leave it to the onset-trimmer.
            if run >= min_len and i > 0 and j < n and run > keep_len:
                parts.append(audio[i : i + keep_len])
                changed = True
            else:
                parts.append(audio[i:j])
            i = j
        else:
            j = i
            while j < n and not quiet[j]:
                j += 1
            parts.append(audio[i:j])
            i = j

    if not changed:
        return audio
    return np.concatenate(parts).astype(np.float32)


def soft_limiter(audio: np.ndarray, ceiling: float = 0.98) -> np.ndarray:
    """
    tanh soft-clip: near-linear for normal levels, smoothly compresses peaks
    toward ±ceiling. Gives consistent, punchy loudness with no clipping and
    no pumping — a gentler final stage than hard peak-normalization.
    """
    if audio.size == 0:
        return audio
    return (ceiling * np.tanh(audio / ceiling)).astype(np.float32)


def presence_eq(
    audio: np.ndarray, sr: int, gain_db: float = 3.5, freq: float = 3200.0, q: float = 0.9
) -> np.ndarray:
    """
    Peaking-EQ lift around the speech-presence band (~3 kHz) so the voice
    cuts through a music bed. RBJ biquad, applied per channel. audio may be
    1-D (mono) or (frames, channels).
    """
    from scipy.signal import lfilter

    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * freq / sr
    cos_w0 = np.cos(w0)
    alpha = np.sin(w0) / (2.0 * q)

    b0 = 1.0 + alpha * A
    b1 = -2.0 * cos_w0
    b2 = 1.0 - alpha * A
    a0 = 1.0 + alpha / A
    a1 = -2.0 * cos_w0
    a2 = 1.0 - alpha / A
    b = np.array([b0, b1, b2]) / a0
    a = np.array([1.0, a1 / a0, a2 / a0])

    if audio.ndim == 1:
        return lfilter(b, a, audio).astype(np.float32)
    out = np.empty_like(audio)
    for ch in range(audio.shape[1]):
        out[:, ch] = lfilter(b, a, audio[:, ch])
    return out.astype(np.float32)
