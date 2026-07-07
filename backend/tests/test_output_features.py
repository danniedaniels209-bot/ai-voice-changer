import numpy as np
import soundfile as sf

from app.utils.subtitles import SubtitleCue, write_srt


def test_write_srt_format(tmp_path):
    cues = [
        SubtitleCue(0.5, 2.25, "Hello there."),
        SubtitleCue(3.0, 65.789, "This is the second line."),
    ]
    out = write_srt(cues, tmp_path / "subs.srt")
    text = out.read_text(encoding="utf-8")

    assert "1\n00:00:00,500 --> 00:00:02,250\nHello there." in text
    assert "2\n00:00:03,000 --> 00:01:05,789\nThis is the second line." in text


def test_split_script_into_segments():
    from app.services.tts_service import split_script_into_segments

    segments = split_script_into_segments(
        "First sentence here. Second one! And a third?", total_duration=30.0
    )
    assert [s.text for s in segments] == ["First sentence here.", "Second one!", "And a third?"]
    # Segments are ordered, non-overlapping, and within the video.
    assert segments[0].start < segments[1].start < segments[2].start
    assert segments[-1].end <= 30.0 + 1e-6


def test_ducking_lowers_background_under_voice(tmp_path):
    from app.services.mixer_service import mix_audio

    sr = 16000
    t = np.linspace(0, 2.0, sr * 2, endpoint=False)
    # Voice speaks only in the first half.
    voice = np.zeros_like(t, dtype=np.float32)
    voice[: sr] = 0.5 * np.sin(2 * np.pi * 220 * t[: sr]).astype(np.float32)
    background = (0.4 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

    voice_path, bg_path, out_path = tmp_path / "v.wav", tmp_path / "b.wav", tmp_path / "m.wav"
    sf.write(str(voice_path), voice, sr)
    sf.write(str(bg_path), background, sr)

    mix_audio(voice_path, bg_path, out_path, voice_gain=0.0, duck_background=True)

    # With the voice muted in the mix (gain 0), what remains is the ducked
    # background: quieter where the voice was speaking than where it wasn't.
    out, _ = sf.read(str(out_path), dtype="float32")
    mono = out.mean(axis=1)
    margin = sr // 4  # avoid the smoothing ramp around the transition
    rms_speaking = np.sqrt((mono[: sr - margin] ** 2).mean())
    rms_silent = np.sqrt((mono[sr + margin :] ** 2).mean())
    assert rms_speaking < rms_silent * 0.6
