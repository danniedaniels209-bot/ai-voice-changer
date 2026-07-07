"""
Verifies the narration pipeline's chatterbox-engine path end-to-end with the
model itself mocked out — proves the plumbing (engine dispatch, reference
audio lookup, tempo fitting, timeline placement) has no errors independent
of the 2 GB weights download.
"""

import numpy as np
import soundfile as sf

from app.services import tts_service
from app.services.transcribe_service import SpeechSegment


def test_synthesize_timeline_chatterbox_engine(tmp_path, monkeypatch):
    sr = 24000

    def fake_chatterbox_synthesize(
        text, output_path, reference_wav, exaggeration, device="cpu", stability=None
    ):
        # Write ~1s of tone per segment, like the real model would.
        t = np.linspace(0, 1.0, sr, endpoint=False)
        sf.write(str(output_path), (0.3 * np.sin(2 * np.pi * 200 * t)).astype(np.float32), sr)
        assert 0.0 <= exaggeration <= 1.0
        assert reference_wav.name == "en-US-GuyNeural.wav"
        return output_path

    ref = tmp_path / "en-US-GuyNeural.wav"
    sf.write(str(ref), np.zeros(sr, dtype=np.float32), sr)

    import app.services.chatterbox_service as cbs
    import app.services.expressive_service as exs

    monkeypatch.setattr(cbs, "synthesize", fake_chatterbox_synthesize)
    monkeypatch.setattr(exs, "ensure_reference_audio", lambda voice_id: ref)

    segments = [
        SpeechSegment(0.5, 2.0, "First test sentence."),
        SpeechSegment(2.5, 4.0, "Second test sentence."),
    ]
    out = tmp_path / "narration.wav"
    result_path, placements = tts_service.synthesize_timeline(
        segments,
        voice="en-US-GuyNeural",
        total_duration=5.0,
        work_dir=tmp_path / "work",
        output_path=out,
        engine="chatterbox",
        exaggeration=0.7,
    )

    assert result_path.exists()
    audio, out_sr = sf.read(str(out), dtype="float32")
    assert out_sr == tts_service.TIMELINE_SR
    assert abs(len(audio) / out_sr - 5.0) < 0.1  # trimmed to video duration
    assert len(placements) == 2
    assert placements[0].start == 0.5
    # Audio actually landed on the timeline (non-silent).
    assert np.abs(audio).max() > 0.1
