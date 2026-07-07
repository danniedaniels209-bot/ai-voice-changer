"""
Natural-continuity processing: the pieces that make converted output sound
like ONE continuous performance instead of independently processed clips.

Why each mechanism improves naturalness (see also README):

1. merge_segments — Whisper's VAD cuts speech at every silence, and each cut
   becomes an independent TTS utterance whose prosody starts from scratch.
   Merging across brief pauses (and up to sentence/paragraph boundaries)
   gives the synthesis engine whole thoughts to perform, so pitch trend,
   pacing, and momentum develop naturally WITHIN a chunk instead of
   resetting every few words. Chunk size adapts to the context-window
   setting; a hard cap keeps memory use flat.

2. Rolling energy memory (used by tts_service during assembly) — human
   loudness drifts smoothly; independently synthesized chunks each come out
   at the engine's default level. An exponential moving average of segment
   RMS, decaying gradually across the timeline, pulls each new segment
   toward the established trend so no segment "jumps out".

3. Crossfaded placement (used by tts_service) — hard segment starts create
   audible clicks/steps at boundaries. Short raised-cosine fades make every
   boundary a blend instead of a cut.

4. smooth_voice_track — a final pass over the assembled voice track that
   softens residual loudness discontinuities: the frame-RMS envelope is
   heavily smoothed and the track is nudged toward that smooth envelope.
   Correction is bounded so speech dynamics (emphasis, shouts, whispers)
   survive — only step-changes between regions are ironed out.

All functions are pure/stateless per call: no global state, no extra model
memory, CPU/GPU-agnostic (numpy only).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from app.core.logging import get_logger
from app.services.transcribe_service import SpeechSegment

logger = get_logger(__name__)

_SENTENCE_END = (".", "!", "?", "…")


def max_chunk_seconds(context_window: float) -> float:
    """Adaptive chunk cap: short window ≈ 8s, long window ≈ 30s."""
    return 8.0 + 22.0 * max(0.0, min(1.0, context_window))


def merge_segments(
    segments: list[SpeechSegment],
    context_window: float = 0.5,
    gap_threshold: float = 0.6,
    sentence_gap_threshold: float = 1.2,
    max_chunk_override_s: float | None = None,
    max_chars: int | None = None,
) -> list[SpeechSegment]:
    """
    Merges neighbouring speech into sentence/paragraph-sized chunks:

    - gaps shorter than `gap_threshold` are always bridged (brief pauses
      should never split a performance);
    - an unfinished sentence (no terminal punctuation) is bridged across
      gaps up to `sentence_gap_threshold` so thoughts stay whole;
    - a merged chunk never exceeds the adaptive cap, so worst-case memory
      and latency stay bounded.
    """
    if not segments:
        return []

    cap = max_chunk_seconds(context_window)
    if max_chunk_override_s is not None:
        # Engine-specific ceiling: local TTS models (Chatterbox) truncate or
        # skip words on long inputs, so their chunks must stay smaller than
        # the context window would otherwise allow.
        cap = min(cap, max_chunk_override_s)
    merged: list[SpeechSegment] = []
    current = segments[0]

    for seg in segments[1:]:
        gap = seg.start - current.end
        sentence_finished = current.text.rstrip().endswith(_SENTENCE_END)
        bridge = gap <= gap_threshold or (not sentence_finished and gap <= sentence_gap_threshold)
        would_exceed_cap = (seg.end - current.start) > cap
        if max_chars is not None and len(current.text) + len(seg.text) + 1 > max_chars:
            would_exceed_cap = True

        if bridge and not would_exceed_cap:
            current = SpeechSegment(
                start=current.start,
                end=seg.end,
                text=f"{current.text.strip()} {seg.text.strip()}",
            )
        else:
            merged.append(current)
            current = seg

    merged.append(current)
    logger.info(
        "Adaptive segmentation: %d raw segments -> %d chunks (cap %.0fs)",
        len(segments),
        len(merged),
        cap,
    )
    return merged


def crossfade_length_samples(naturalness: int, sr: int) -> int:
    """10ms at naturalness=0 up to 90ms at naturalness=100."""
    ms = 10.0 + 0.8 * max(0, min(100, naturalness))
    return max(1, int(sr * ms / 1000.0))


def apply_edge_fades(audio: np.ndarray, fade_samples: int) -> np.ndarray:
    """
    Raised-cosine fade-in/out on a mono segment. Where neighbouring segments
    overlap on the timeline, their fades sum to a constant-power crossfade;
    against silence they remove clicks and hard onsets.
    """
    n = len(audio)
    fade = min(fade_samples, n // 2)
    if fade < 2:
        return audio
    ramp = 0.5 * (1 - np.cos(np.linspace(0, np.pi, fade)))
    out = audio.copy()
    out[:fade] *= ramp
    out[-fade:] *= ramp[::-1]
    return out


class RollingEnergyMemory:
    """
    Tracks the loudness trend across the performance. `beta` (from the
    context-window setting) controls decay: long windows remember further
    back, short windows adapt quickly. The correction toward the trend is
    deliberately partial and bounded — segments are nudged, never forced,
    so genuine dynamics (a shout, a whisper) still land.
    """

    def __init__(self, context_window: float, strength: float):
        self.beta = 0.5 + 0.45 * max(0.0, min(1.0, context_window))  # decay
        self.strength = max(0.0, min(1.0, strength))  # how hard we correct
        self._ema: float | None = None

    def adapt(self, audio: np.ndarray) -> np.ndarray:
        rms = float(np.sqrt((audio**2).mean() + 1e-12))
        if rms < 1e-6:
            return audio
        if self._ema is None:
            self._ema = rms
            return audio

        target = self._ema
        gain = target / rms
        gain = float(np.clip(gain, 0.6, 1.6))  # bounded: preserve real dynamics
        effective = 1.0 + (gain - 1.0) * self.strength
        adapted = audio * effective

        new_rms = float(np.sqrt((adapted**2).mean() + 1e-12))
        self._ema = self.beta * self._ema + (1.0 - self.beta) * new_rms
        return adapted


def smooth_voice_track(
    input_path: Path,
    output_path: Path,
    naturalness: int,
) -> Path:
    """
    Final smoothing pass: softens step-changes in loudness between converted
    regions. The frame-RMS envelope is smoothed over ~0.6s and the audio is
    partially corrected toward it; correction strength and bounds scale with
    the naturalness setting so 0 is a no-op and 100 is still conservative.
    """
    strength = max(0, min(100, naturalness)) / 100.0
    if strength <= 0.01:
        if input_path != output_path:
            output_path.write_bytes(input_path.read_bytes())
        return output_path

    audio, sr = sf.read(str(input_path), dtype="float32")
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio

    frame = max(1, int(sr * 0.03))  # 30 ms frames
    n_frames = max(1, len(mono) // frame)
    rms = np.sqrt((mono[: n_frames * frame].reshape(n_frames, frame) ** 2).mean(axis=1) + 1e-12)

    # Heavy smoothing (~0.6 s) of the envelope = the "intended" loudness arc.
    kernel_n = max(3, int(0.6 / 0.03))
    kernel = np.ones(kernel_n) / kernel_n
    smooth = np.convolve(rms, kernel, mode="same")

    # Correct partially toward the smooth arc, bounded so dynamics survive.
    max_correction = 1.0 + 0.5 * strength  # up to +-50% gain at naturalness=100
    gain = np.clip(smooth / rms, 1.0 / max_correction, max_correction)
    gain = 1.0 + (gain - 1.0) * strength

    sample_gain = np.repeat(gain, frame)
    if len(sample_gain) < len(mono):
        sample_gain = np.pad(sample_gain, (0, len(mono) - len(sample_gain)), mode="edge")
    sample_gain = sample_gain[: len(mono)].astype(np.float32)

    result = audio * (sample_gain[:, None] if audio.ndim > 1 else sample_gain)
    peak = np.abs(result).max()
    if peak > 1.0:
        result = result / peak * 0.99

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), result, sr, subtype="PCM_16")
    logger.info("Continuity smoothing applied (naturalness=%d) -> %s", naturalness, output_path.name)
    return output_path
