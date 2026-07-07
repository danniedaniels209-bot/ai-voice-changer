"""
Source-pitch analysis for RVC's auto-pitch feature: measures the speaker's
median fundamental frequency and computes the semitone transpose needed to
land in a typical male (or female) speaking range. Saves users from having
to know that female->male conversion needs roughly -12 semitones.
"""

from __future__ import annotations

import math
from pathlib import Path

from app.core.errors import CorruptAudioError
from app.core.logging import get_logger

logger = get_logger(__name__)

# Median speaking F0 targets. Typical adult ranges: male ~85-155 Hz,
# female ~165-255 Hz — these sit comfortably inside them.
TARGET_F0 = {
    "male": 115.0,
    "female": 210.0,
}

# Only analyze the first N seconds — median pitch stabilizes quickly and
# pyin is slow on long files.
_ANALYSIS_SECONDS = 60


def measure_median_f0(audio_path: Path) -> float | None:
    """
    Returns the median voiced F0 in Hz, or None if no voiced speech could
    be detected (silence, music-only, etc.).
    """
    import librosa
    import numpy as np

    if not audio_path.exists():
        raise CorruptAudioError(f"Audio file for pitch analysis does not exist: {audio_path}")

    y, sr = librosa.load(str(audio_path), sr=16000, mono=True, duration=_ANALYSIS_SECONDS)
    if y.size == 0:
        return None

    f0, voiced_flag, _ = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),  # ~65 Hz
        fmax=librosa.note_to_hz("C5"),  # ~523 Hz
        sr=sr,
    )
    voiced = f0[voiced_flag & ~np.isnan(f0)] if f0 is not None else np.array([])
    if voiced.size < 10:
        return None

    median_f0 = float(np.median(voiced))
    logger.info("Measured median speaking pitch: %.1f Hz (%s)", median_f0, audio_path.name)
    return median_f0


def suggest_transpose(audio_path: Path, target_gender: str) -> int:
    """
    Semitones to shift the source voice toward the target gender's typical
    speaking pitch. Returns 0 if the source pitch can't be measured (better
    to convert un-shifted than to guess).
    """
    target = TARGET_F0.get(target_gender, TARGET_F0["male"])
    median_f0 = measure_median_f0(audio_path)
    if median_f0 is None:
        logger.warning("Could not measure source pitch — using no transpose.")
        return 0

    semitones = round(12 * math.log2(target / median_f0))
    semitones = max(-24, min(24, semitones))
    logger.info(
        "Auto-pitch: source %.1f Hz -> target ~%.0f Hz (%s) = %+d semitones",
        median_f0,
        target,
        target_gender,
        semitones,
    )
    return semitones
