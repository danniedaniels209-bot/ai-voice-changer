import numpy as np
import pytest
import soundfile as sf

from app.core.errors import CorruptAudioError
from app.services.mixer_service import conform_duration


def _write(path, seconds, sr=24000):
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    sf.write(str(path), (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr)
    return path


def test_conform_pads_short_audio(tmp_path):
    p = _write(tmp_path / "a.wav", 9.7)
    conform_duration(p, 10.0)
    assert abs(sf.info(str(p)).duration - 10.0) < 0.01


def test_conform_trims_long_audio(tmp_path):
    p = _write(tmp_path / "a.wav", 10.4)
    conform_duration(p, 10.0)
    assert abs(sf.info(str(p)).duration - 10.0) < 0.01


def test_conform_leaves_exact_audio_untouched(tmp_path):
    p = _write(tmp_path / "a.wav", 10.0)
    before = p.read_bytes()
    conform_duration(p, 10.0)
    assert p.read_bytes() == before


def test_conform_aborts_on_gross_misalignment(tmp_path):
    p = _write(tmp_path / "a.wav", 6.0)
    with pytest.raises(CorruptAudioError, match="Timeline validation failed"):
        conform_duration(p, 10.0)  # 4s deviation > 2s threshold
