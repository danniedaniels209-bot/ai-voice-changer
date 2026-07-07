"""
Mixes the RVC-converted voice track back with the Demucs-extracted
background bed into a single audio file, ready to be muxed into the video.

Uses librosa/soundfile/numpy directly (per the project's audio stack) rather
than another FFmpeg subprocess, since this is sample-accurate numeric mixing
(gain + length alignment), not format/codec conversion.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from app.core.errors import CorruptAudioError
from app.core.logging import get_logger

logger = get_logger(__name__)


def _load_stereo(path: Path) -> tuple[np.ndarray, int]:
    """Loads audio as float32, shape (frames, channels), forcing stereo."""
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    return data, sr


def _resample_if_needed(data: np.ndarray, src_sr: int, target_sr: int) -> np.ndarray:
    if src_sr == target_sr:
        return data
    import librosa

    resampled = librosa.resample(data.T, orig_sr=src_sr, target_sr=target_sr)
    return resampled.T


def _match_length(data: np.ndarray, target_frames: int) -> np.ndarray:
    """Pads with silence or trims so `data` has exactly `target_frames` frames."""
    current_frames = data.shape[0]
    if current_frames == target_frames:
        return data
    if current_frames < target_frames:
        pad = np.zeros((target_frames - current_frames, data.shape[1]), dtype=data.dtype)
        return np.concatenate([data, pad], axis=0)
    return data[:target_frames]


def _ducking_gain(voice: np.ndarray, sr: int) -> np.ndarray:
    """
    Per-sample gain curve for the background: drops toward 35% while the
    voice is speaking, eases back to 1.0 in the gaps. Frame-based RMS voice
    detection with a ~120 ms smoothed ramp so the ducking doesn't pump.
    """
    frame = max(1, int(sr * 0.02))  # 20 ms frames
    duck_level = 0.35
    threshold = 0.01  # frame RMS above this counts as speech

    mono = voice.mean(axis=1)
    n_frames = max(1, len(mono) // frame)
    rms = np.sqrt((mono[: n_frames * frame].reshape(n_frames, frame) ** 2).mean(axis=1) + 1e-12)
    frame_gain = np.where(rms > threshold, duck_level, 1.0)

    smooth = 6  # 6 frames = ~120 ms attack/release
    frame_gain = np.convolve(frame_gain, np.ones(smooth) / smooth, mode="same")

    sample_gain = np.repeat(frame_gain, frame)
    if len(sample_gain) < len(mono):
        sample_gain = np.pad(sample_gain, (0, len(mono) - len(sample_gain)), mode="edge")
    return sample_gain[: len(mono)].astype(np.float32)


def conform_duration(audio_path: Path, target_seconds: float, *, abort_over: float = 2.0) -> Path:
    """
    Master-timeline guard for whole-file conversion engines (RVC, OpenVoice,
    chained stages): their output must be exactly as long as their input.
    Small deviations (resampling edges, codec padding) are conformed in
    place — trimmed or zero-padded to the sample. A deviation larger than
    `abort_over` seconds means the engine genuinely misaligned the audio,
    and the job is aborted rather than exporting a desynchronized result.
    """
    data, sr = sf.read(str(audio_path), dtype="float32", always_2d=True)
    actual = data.shape[0] / sr
    deviation = actual - target_seconds

    if abs(deviation) > abort_over:
        raise CorruptAudioError(
            f"Timeline validation failed: converted audio is {actual:.2f}s but the "
            f"source is {target_seconds:.2f}s ({deviation:+.2f}s) — aborting to protect "
            "synchronization."
        )

    target_frames = int(round(target_seconds * sr))
    if data.shape[0] == target_frames:
        return audio_path
    if abs(deviation) > 0.05:
        logger.warning(
            "Conforming %s to the master timeline: %.2fs -> %.2fs",
            audio_path.name, actual, target_seconds,
        )
    data = _match_length(data, target_frames)
    sf.write(str(audio_path), data, sr, subtype="PCM_16")
    return audio_path


def mix_audio(
    converted_voice_path: Path,
    background_path: Path,
    output_path: Path,
    *,
    voice_gain: float = 1.0,
    background_gain: float = 1.0,
    duck_background: bool = False,
) -> Path:
    """
    Combines the converted voice track with the background bed, aligning
    them to the background's length (background comes straight from Demucs
    on the original audio, so its duration matches the source video exactly
    — the voice track is conformed to it, not the other way around).

    Peak-normalizes the result if mixing would clip, so voice_gain/
    background_gain > 1.0 can be used safely without distorting output.
    """
    if not converted_voice_path.exists():
        raise CorruptAudioError(f"Converted voice track does not exist: {converted_voice_path}")
    if not background_path.exists():
        raise CorruptAudioError(f"Background track does not exist: {background_path}")

    voice, voice_sr = _load_stereo(converted_voice_path)
    background, bg_sr = _load_stereo(background_path)

    target_sr = bg_sr
    voice = _resample_if_needed(voice, voice_sr, target_sr)
    voice = _match_length(voice, background.shape[0])

    if duck_background:
        background = background * _ducking_gain(voice, target_sr)[:, None]

    mixed = voice * voice_gain + background * background_gain

    peak = np.abs(mixed).max()
    if peak > 1.0:
        logger.debug("Mix peak %.3f exceeds full scale, normalizing down.", peak)
        mixed = mixed / peak * 0.99

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), mixed, target_sr, subtype="PCM_16")

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise CorruptAudioError(f"Audio mixing produced an empty file at {output_path}")

    logger.info("Mixed audio written to %s (%.1fs)", output_path, mixed.shape[0] / target_sr)
    return output_path
