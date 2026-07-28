import threading

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from app.motion_studio.export_service import ExportCancelled, export_project
from app.motion_studio.models import MotionProject, MotionScene, AudioTrack
from app.core.config import Paths

@pytest.fixture
def mock_ffmpeg_service():
    with patch("app.motion_studio.export_service.resolve_ffmpeg_binaries", return_value=("/mock/ffmpeg", "/mock/ffprobe")):
        with patch("app.motion_studio.export_service._run_cancellable") as mock_run:
            with patch("app.motion_studio.export_service._video_encode_args", return_value=["-c:v", "libx264"]):
                yield mock_run

@pytest.fixture
def mock_render_service():
    with patch("app.motion_studio.export_service.render_service.render_frames") as mock_render:
        def render_side_effect(project_id, scene_id, output_dir, fps, start_index=0, **kwargs):
            from app.motion_studio import export_service

            project = export_service.storage.load_project(project_id)
            scene = next((s for s in project.scenes if s.id == scene_id), project.scenes[0])
            total = max(1, int((max(1, scene.duration_ms) / 1000.0) * fps))
            suffix = "jpg" if kwargs.get("output_format") == "jpeg" else "png"
            output_dir.mkdir(parents=True, exist_ok=True)
            paths = []
            for i in range(total):
                path = output_dir / f"frame_{start_index + i:06d}.{suffix}"
                path.write_bytes(b"png")
                paths.append(path)
            return paths

        mock_render.side_effect = render_side_effect
        yield mock_render

@pytest.fixture
def mock_storage():
    with patch("app.motion_studio.export_service.storage.load_project") as mock_load:
        yield mock_load

@pytest.fixture
def mock_path_exists():
    with patch.object(Path, "exists", return_value=True):
        with patch.object(Path, "stat") as mock_stat:
            mock_stat.return_value = MagicMock(st_size=1024, st_mode=33188)
            with patch.object(Path, "is_dir", return_value=True):
                yield

def test_export_project_no_audio(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test1",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", audio_tracks=[])]
    )
    mock_storage.return_value = project

    export_project("test1", format="mp4")

    mock_ffmpeg_service.assert_called_once()
    cmd = mock_ffmpeg_service.call_args[0][0]
    
    assert "-filter_complex" not in cmd
    assert "-map" not in cmd
    mock_render_service.assert_called_once()
    assert mock_render_service.call_args.kwargs["scene_id"] == "scene1"
    assert mock_render_service.call_args.kwargs["output_format"] == "jpeg"

def test_transparent_mp4_export_uses_png_frames(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test-transparent",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", audio_tracks=[])]
    )
    mock_storage.return_value = project

    export_project("test-transparent", format="mp4", transparent=True)

    assert mock_render_service.call_args.kwargs["output_format"] == "png"

def test_png_sequence_export_uses_png_frames(mock_storage, tmp_path, monkeypatch):
    from app.motion_studio import export_service

    monkeypatch.setattr(Paths, "exports", tmp_path / "exports")
    project = MotionProject(
        id="test-png-seq",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", duration_ms=1000, audio_tracks=[])]
    )
    mock_storage.return_value = project
    seen = {}

    def render_frames(*args, **kwargs):
        seen["output_format"] = kwargs["output_format"]
        output_dir = kwargs["output_dir"]
        output_dir.mkdir(parents=True, exist_ok=True)
        frame = output_dir / "frame_000000.png"
        frame.write_bytes(b"png")
        return [frame]

    monkeypatch.setattr(export_service.render_service, "render_frames", render_frames)

    export_project("test-png-seq", format="png_sequence", fps=1)

    assert seen["output_format"] == "png"

def test_export_project_with_audio(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test2",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", audio_tracks=[
            AudioTrack(id="a1", name="Track 1", source_url="/motion/assets/id1/file1.wav", start_time_ms=1000, duration_ms=5000, volume=0.8)
        ])]
    )
    mock_storage.return_value = project

    export_project("test2", format="mp4")

    mock_ffmpeg_service.assert_called_once()
    cmd = mock_ffmpeg_service.call_args[0][0]
    
    assert "-filter_complex" in cmd
    filter_idx = cmd.index("-filter_complex")
    filter_arg = cmd[filter_idx + 1]
    
    assert "[1:a]atrim=0:5.0,volume=0.8,adelay=1000|1000[a1]" in filter_arg
    
    assert "-map" in cmd
    assert "0:v" in cmd
    assert "[aout]" in cmd
    
def test_export_project_with_multiple_audio_tracks(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test3",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", audio_tracks=[
            AudioTrack(id="a1", name="Track 1", source_url="/motion/assets/id1/file1.wav", start_time_ms=0, duration_ms=2000, fade_in_ms=500),
            AudioTrack(id="a2", name="Track 2", source_url="/motion/assets/id2/file2.wav", start_time_ms=1000, duration_ms=3000, fade_out_ms=1000)
        ])]
    )
    mock_storage.return_value = project

    export_project("test3", format="mp4")

    mock_ffmpeg_service.assert_called_once()
    cmd = mock_ffmpeg_service.call_args[0][0]
    
    assert "-filter_complex" in cmd
    filter_idx = cmd.index("-filter_complex")
    filter_arg = cmd[filter_idx + 1]
    
    assert "[1:a]atrim=0:2.0,afade=t=in:st=0:d=0.5,volume=1.0[a1]" in filter_arg
    assert "[2:a]atrim=0:3.0,afade=t=out:st=2.0:d=1.0,volume=1.0,adelay=1000|1000[a2]" in filter_arg
    assert "[a1][a2]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[amixout];[amixout]apad[aout]" in filter_arg
    
    assert "-map" in cmd
    assert "0:v" in cmd
    assert "[aout]" in cmd
    
def test_export_project_with_muted_and_solo_audio(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test4",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", audio_tracks=[
            AudioTrack(id="a1", name="Track 1", source_url="/motion/assets/id1/file1.wav", solo=False),
            AudioTrack(id="a2", name="Track 2", source_url="/motion/assets/id2/file2.wav", solo=True), # ONLY THIS ONE SHOULD PLAY
            AudioTrack(id="a3", name="Track 3", source_url="/motion/assets/id3/file3.wav", solo=True, muted=True) # SOLO BUT MUTED
        ])]
    )
    mock_storage.return_value = project

    export_project("test4", format="mp4")

    mock_ffmpeg_service.assert_called_once()
    cmd = mock_ffmpeg_service.call_args[0][0]
    
    # Track 2 is soloed, Track 1 is not soloed (ignored), Track 3 is soloed but muted (ignored)
    # Therefore, ONLY track 2 should be processed (which becomes input [1:a])
    assert str(Paths.motion_assets / "id2" / "file2.wav") in cmd
    assert str(Paths.motion_assets / "id1" / "file1.wav") not in cmd
    assert str(Paths.motion_assets / "id3" / "file3.wav") not in cmd
    
    assert "-filter_complex" in cmd
    filter_idx = cmd.index("-filter_complex")
    filter_arg = cmd[filter_idx + 1]
    
    assert "[1:a]atrim=0:1.0,volume=1.0[a1];[a1]apad[aout]" in filter_arg
    assert "[aout]" in cmd

def test_export_project_requires_all_scenes_flag_for_multi_scene(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test5",
        created_at="",
        updated_at="",
        scenes=[
            MotionScene(id="scene1", duration_ms=1000, audio_tracks=[]),
            MotionScene(id="scene2", duration_ms=2000, audio_tracks=[]),
        ]
    )
    mock_storage.return_value = project

    export_project("test5", format="mp4")

    mock_render_service.assert_called_once()
    assert mock_render_service.call_args.kwargs["scene_id"] == "scene1"
    assert mock_render_service.call_args.kwargs["start_index"] == 0

def test_export_project_all_scenes_renders_contiguous_frames(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test6",
        created_at="",
        updated_at="",
        scenes=[
            MotionScene(id="scene1", duration_ms=1000, audio_tracks=[]),
            MotionScene(id="scene2", duration_ms=2000, audio_tracks=[]),
        ]
    )
    mock_storage.return_value = project

    export_project("test6", all_scenes=True, fps=10, format="mp4")

    assert mock_render_service.call_count == 2
    first = mock_render_service.call_args_list[0].kwargs
    second = mock_render_service.call_args_list[1].kwargs
    assert first["scene_id"] == "scene1"
    assert first["start_index"] == 0
    assert first["width"] == 1920
    assert first["height"] == 1080
    assert second["scene_id"] == "scene2"
    assert second["start_index"] == 10
    assert second["width"] == 1920
    assert second["height"] == 1080

def test_export_project_all_scenes_offsets_scene_audio(mock_ffmpeg_service, mock_render_service, mock_storage, mock_path_exists):
    project = MotionProject(
        id="test7",
        created_at="",
        updated_at="",
        scenes=[
            MotionScene(id="scene1", duration_ms=1000, audio_tracks=[
                AudioTrack(id="a1", name="Scene 1", source_url="/motion/assets/id1/file1.wav", start_time_ms=250, duration_ms=500)
            ]),
            MotionScene(id="scene2", duration_ms=2000, audio_tracks=[
                AudioTrack(id="a2", name="Scene 2", source_url="/motion/assets/id2/file2.wav", start_time_ms=500, duration_ms=1000)
            ]),
        ]
    )
    mock_storage.return_value = project

    export_project("test7", all_scenes=True, format="mp4")

    cmd = mock_ffmpeg_service.call_args[0][0]
    filter_arg = cmd[cmd.index("-filter_complex") + 1]
    assert "[1:a]atrim=0:0.5,volume=1.0,adelay=250|250[a1]" in filter_arg
    assert "[2:a]atrim=0:1.0,volume=1.0,adelay=1500|1500[a2]" in filter_arg
    assert "-t" in cmd
    assert cmd[cmd.index("-t") + 1] == "3.0"

def test_export_project_rejects_invalid_video_bitrate(mock_storage):
    from app.core.errors import AppError

    project = MotionProject(
        id="test8",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", duration_ms=1000, audio_tracks=[])]
    )
    mock_storage.return_value = project

    with pytest.raises(AppError, match="Video bitrate"):
        export_project("test8", format="mp4", video_bitrate="fast")

def test_mov_export_requires_prores_encoder(mock_render_service, mock_storage, monkeypatch):
    from app.core.errors import AppError
    from app.motion_studio import export_service

    project = MotionProject(
        id="test9",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", duration_ms=1000, audio_tracks=[])]
    )
    mock_storage.return_value = project
    monkeypatch.setattr(export_service, "_prores_encoder_available", lambda: False)

    with pytest.raises(AppError, match="prores_ks"):
        export_project("test9", format="mov")

def test_export_project_cleans_temp_frames_after_render_failure(mock_storage, tmp_path, monkeypatch):
    from app.core.errors import AppError
    from app.motion_studio import export_service

    monkeypatch.setattr(Paths, "temp", tmp_path)
    project = MotionProject(
        id="test8",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", duration_ms=1000, audio_tracks=[])]
    )
    mock_storage.return_value = project

    def fail_render(*args, **kwargs):
        output_dir = kwargs["output_dir"]
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "frame_000000.png").write_bytes(b"png")
        raise AppError("render failed")

    monkeypatch.setattr(export_service.render_service, "render_frames", fail_render)

    with pytest.raises(AppError, match="render failed"):
        export_project("test8", format="mp4")

    assert list(tmp_path.glob("motion_frames_test8_*")) == []

def test_export_project_cleans_temp_frames_after_cancel(mock_storage, tmp_path, monkeypatch):
    from app.motion_studio import export_service

    monkeypatch.setattr(Paths, "temp", tmp_path)
    project = MotionProject(
        id="test9",
        created_at="",
        updated_at="",
        scenes=[MotionScene(id="scene1", duration_ms=1000, audio_tracks=[])]
    )
    mock_storage.return_value = project
    cancel_event = threading.Event()

    def cancel_render(*args, **kwargs):
        output_dir = kwargs["output_dir"]
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "frame_000000.png").write_bytes(b"png")
        cancel_event.set()
        return [output_dir / "frame_000000.png"]

    monkeypatch.setattr(export_service.render_service, "render_frames", cancel_render)

    with pytest.raises(ExportCancelled):
        export_project("test9", format="mp4", cancel_event=cancel_event)

    assert list(tmp_path.glob("motion_frames_test9_*")) == []
