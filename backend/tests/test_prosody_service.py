import numpy as np
import pytest
import soundfile as sf

from app.schemas.rvc import VoiceConversionParams
from app.services import prosody_service


def test_engine_capabilities():
    assert prosody_service.engine_supports_prosody("rvc")
    assert not prosody_service.engine_supports_prosody("tts")
    assert not prosody_service.engine_supports_prosody("unknown-engine")
    assert "re-synthesizes" in prosody_service.unsupported_reason("tts")


def test_adapt_rvc_params_preserves_pitch_settings():
    params = VoiceConversionParams(
        pitch_semitones=-12, auto_pitch=True, auto_pitch_target="male", rms_mix_rate=1.0, protect=0.2
    )
    adapted = prosody_service.adapt_rvc_params(params)

    # Prosody-critical knobs are forced...
    assert adapted.rms_mix_rate == 0.0
    assert adapted.protect == 0.5
    assert adapted.f0_method == "rmvpe"
    # ...but the user's pitch intent is untouched.
    assert adapted.pitch_semitones == -12
    assert adapted.auto_pitch is True
    assert adapted.auto_pitch_target == "male"
    # Original object is not mutated.
    assert params.rms_mix_rate == 1.0


@pytest.fixture
def sine_files(tmp_path):
    """Source: sine with a strong amplitude ramp. Converted: flat sine."""
    sr = 16000
    duration = 2.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    tone = np.sin(2 * np.pi * 220 * t).astype(np.float32)

    ramp = np.linspace(0.05, 0.9, len(t)).astype(np.float32)  # quiet -> loud
    source = tone * ramp
    converted = tone * 0.5  # constant loudness

    source_path = tmp_path / "source.wav"
    converted_path = tmp_path / "converted.wav"
    sf.write(str(source_path), source, sr)
    sf.write(str(converted_path), converted, sr)
    return source_path, converted_path, sr


def test_transfer_loudness_reimposes_source_dynamics(sine_files, tmp_path):
    source_path, converted_path, sr = sine_files
    output_path = tmp_path / "out.wav"

    prosody_service.transfer_loudness(source_path, converted_path, output_path)

    out, out_sr = sf.read(str(output_path), dtype="float32")
    assert out_sr == sr
    assert len(out) == len(sf.read(str(converted_path), dtype="float32")[0])

    # The output should now ramp like the source: its second half must be
    # substantially louder than its first half.
    half = len(out) // 2
    rms_first = np.sqrt((out[:half] ** 2).mean())
    rms_second = np.sqrt((out[half:] ** 2).mean())
    assert rms_second > rms_first * 2

    # And its frame envelope should correlate strongly with the source's.
    frame = int(sr * 0.04)
    src, _ = sf.read(str(source_path), dtype="float32")
    env = lambda x: np.sqrt(  # noqa: E731
        (x[: len(x) // frame * frame].reshape(-1, frame) ** 2).mean(axis=1)
    )
    corr = np.corrcoef(env(src), env(out))[0, 1]
    assert corr > 0.95


def test_transfer_loudness_missing_file_raises(tmp_path):
    from app.core.errors import CorruptAudioError

    real = tmp_path / "real.wav"
    sf.write(str(real), np.zeros(1600, dtype=np.float32), 16000)

    with pytest.raises(CorruptAudioError):
        prosody_service.transfer_loudness(tmp_path / "missing.wav", real, tmp_path / "out.wav")
    with pytest.raises(CorruptAudioError):
        prosody_service.transfer_loudness(real, tmp_path / "missing.wav", tmp_path / "out.wav")
