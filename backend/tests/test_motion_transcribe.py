"""
Tests for motion_transcribe API endpoint and end-to-end layer persistence.
"""

import time
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app
from app.motion_studio import storage
from app.motion_studio.models import AudioTrack, MotionLayer, MotionProject, MotionScene, TextLayerProps, Transform
from app.services.transcribe_service import SpeechSegment, WordInfo

client = TestClient(app)


def test_transcribe_audio_track(tmp_path, monkeypatch):
    project_id = "test_transcribe_proj"
    asset_id = "0123456789abcdef0123456789abcdef"
    asset_dir = tmp_path / "assets" / asset_id
    asset_dir.mkdir(parents=True)
    audio_file = asset_dir / "voice.wav"
    audio_file.write_bytes(b"RIFF dummy audio data")

    monkeypatch.setattr("app.core.config.Paths.motion_assets", tmp_path / "assets")

    scene = MotionScene(
        id="scene_1",
        audio_tracks=[
            AudioTrack(
                id="track_1",
                name="Voiceover",
                kind="voiceover",
                source_url=f"/motion/assets/{asset_id}/voice.wav",
            )
        ],
    )
    project = MotionProject(id=project_id, name="Transcribe Test", scenes=[scene], created_at="now", updated_at="now")
    storage.save_project(project)

    mock_segments = [
        SpeechSegment(
            start=0.5,
            end=2.0,
            text="Hello subtitle test",
            words=[
                WordInfo(word="Hello", start=0.5, end=1.0, probability=0.99),
                WordInfo(word="subtitle", start=1.1, end=1.5, probability=0.98),
                WordInfo(word="test", start=1.6, end=2.0, probability=0.97),
            ],
        )
    ]

    with patch("app.services.transcribe_service.transcribe", return_value=mock_segments):
        resp = client.post(f"/motion/projects/{project_id}/tracks/track_1/transcribe")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        task_id = data["task_id"]

        for _ in range(20):
            status_resp = client.get(f"/motion/transcribe/{task_id}")
            assert status_resp.status_code == 200
            st = status_resp.json()
            if st.get("done"):
                break
            time.sleep(0.05)

        assert st["status"] == "done"
        cues = st["cues"]
        assert len(cues) == 1
        assert cues[0]["id"] == "cue-1"
        assert cues[0]["start"] == 0.5
        assert cues[0]["end"] == 2.0
        assert cues[0]["text"] == "Hello subtitle test"
        assert len(cues[0]["words"]) == 3
        assert cues[0]["words"][0] == {"text": "Hello", "start": 0.5, "end": 1.0, "confidence": 0.99}


def test_transcribe_end_to_end_project_persistence(tmp_path, monkeypatch):
    project_id = "test_transcribe_e2e"
    asset_id = "0123456789abcdef0123456789abcdef"
    asset_dir = tmp_path / "assets" / asset_id
    asset_dir.mkdir(parents=True)
    audio_file = asset_dir / "voice.wav"
    audio_file.write_bytes(b"RIFF dummy audio data")

    monkeypatch.setattr("app.core.config.Paths.motion_assets", tmp_path / "assets")

    scene = MotionScene(
        id="scene_1",
        audio_tracks=[
            AudioTrack(
                id="track_1",
                name="Voiceover",
                kind="voiceover",
                source_url=f"/motion/assets/{asset_id}/voice.wav",
            )
        ],
    )
    project = MotionProject(id=project_id, name="E2E Transcribe Test", scenes=[scene], created_at="now", updated_at="now")
    storage.save_project(project)

    mock_segments = [
        SpeechSegment(start=1.0, end=3.5, text="Welcome to Motion Studio", words=[]),
    ]

    with patch("app.services.transcribe_service.transcribe", return_value=mock_segments):
        resp = client.post(f"/motion/projects/{project_id}/tracks/track_1/transcribe")
        task_id = resp.json()["task_id"]

        for _ in range(20):
            st = client.get(f"/motion/transcribe/{task_id}").json()
            if st.get("done"):
                break
            time.sleep(0.05)

        cues = st["cues"]
        cue = cues[0]

        # Simulate front-end converting cue to MotionLayer text layer
        layer = MotionLayer(
            id="layer_caption_1",
            name="Caption: Welcome to Motion Studio",
            type="text",
            transform=Transform(x=100, y=900, width=1720, height=80),
            visible_start_ms=int(cue["start"] * 1000),
            visible_end_ms=int(cue["end"] * 1000),
            text=TextLayerProps(text=cue["text"], font_size=48, color="#FFFFFF"),
        )
        scene.layers.append(layer)

        # PUT updated project
        put_resp = client.put(f"/motion/projects/{project_id}", json=project.model_dump())
        assert put_resp.status_code == 200

        # Re-read project from storage API
        get_resp = client.get(f"/motion/projects/{project_id}")
        assert get_resp.status_code == 200
        loaded_proj = get_resp.json()

        loaded_layer = loaded_proj["scenes"][0]["layers"][0]
        assert loaded_layer["id"] == "layer_caption_1"
        assert loaded_layer["type"] == "text"
        assert loaded_layer["visible_start_ms"] == 1000
        assert loaded_layer["visible_end_ms"] == 3500
        assert loaded_layer["text"]["text"] == "Welcome to Motion Studio"


def test_transcribe_missing_track(tmp_path, monkeypatch):
    project_id = "test_transcribe_proj_missing"
    project = MotionProject(id=project_id, name="Test", scenes=[], created_at="now", updated_at="now")
    storage.save_project(project)

    resp = client.post(f"/motion/projects/{project_id}/tracks/nonexistent/transcribe")
    assert resp.status_code == 500 or resp.status_code == 400
    assert "not found" in resp.text
