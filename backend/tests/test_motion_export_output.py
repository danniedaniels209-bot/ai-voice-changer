"""
End-to-end checks on the ACTUAL FILE the motion exporter produces.

Why this file exists, separately from test_export_service.py:

test_export_service.py mocks `_run`, so ffmpeg never executes. Those tests
assert on the *command string* we build — useful for checking that a flag is
present, useless for checking that the resulting video is correct. A real bug
slipped through exactly that gap: `-shortest` truncated the video to the
length of the audio track, so a 5s scene with a 2s voiceover exported as a
2s video. Every mocked test passed, because the command "looked right".

So these tests run ffmpeg for real and probe the output with ffprobe. They
assert on properties of the artifact — duration, streams, dimensions — not on
how we asked for it.

Playwright is NOT involved: rendering real frames in a headless browser would
make this suite minutes slower and isn't what's under test here. Instead
render_frames is patched to emit real (tiny, solid-colour) PNG frames via
ffmpeg, and everything downstream — the filtergraph, the mux, the encode — is
the genuine code path.

The whole module skips cleanly if ffmpeg/ffprobe aren't available, so a dev
box without them doesn't see spurious failures.
"""

from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.config import Paths
from app.motion_studio import export_service, storage
from app.motion_studio.models import (
    AudioTrack,
    MotionLayer,
    MotionScene,
    RectLayerProps,
    Transform,
)


def _ffmpeg_paths() -> tuple[str, str] | None:
    try:
        from app.services.ffmpeg_service import resolve_ffmpeg_binaries

        ffmpeg, ffprobe = resolve_ffmpeg_binaries()
        if ffmpeg and ffprobe:
            return ffmpeg, ffprobe
    except Exception:
        pass
    return None


_BINS = _ffmpeg_paths()

pytestmark = pytest.mark.skipif(
    _BINS is None, reason="ffmpeg/ffprobe not available on this machine"
)


def _probe_duration(path: Path) -> float:
    """Container duration in seconds."""
    _, ffprobe = _BINS  # type: ignore[misc]
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def _probe_streams(path: Path) -> list[dict]:
    _, ffprobe = _BINS  # type: ignore[misc]
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,width,height,pix_fmt,bit_rate", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out or "{}").get("streams", [])


def _has_prores_encoder() -> bool:
    ffmpeg, _ = _BINS  # type: ignore[misc]
    out = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"],
        capture_output=True, text=True, check=True,
    ).stdout
    return " prores_ks " in out


@pytest.fixture
def fake_frames():
    """Patch render_frames so it writes real PNGs without a browser.

    The frames are genuine image files (ffmpeg has to be able to read them),
    just trivially cheap to make. Everything after rendering is the real
    code path.
    """
    def _render(project_id, scene_id, output_dir, fps, width, height,
                transparent=False, base_url=None, start_index=0, cancel_event=None,
                output_format="png", progress_callback=None):
        ffmpeg, _ = _BINS  # type: ignore[misc]
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        project = storage.load_project(project_id)
        scene = next((s for s in project.scenes if s.id == scene_id), project.scenes[0])
        total = max(1, round(scene.duration_ms / 1000 * fps))
        suffix = "jpg" if output_format == "jpeg" else "png"
        subprocess.run(
            [ffmpeg, "-y", "-v", "error",
             "-f", "lavfi", "-i", f"color=c=blue:s={width}x{height}:d={total / fps}",
             "-vframes", str(total),
             "-start_number", str(start_index),
             str(output_dir / f"frame_%06d.{suffix}")],
            check=True,
        )
        return sorted(output_dir.glob(f"frame_*.{suffix}"))

    with patch.object(export_service.render_service, "render_frames", side_effect=_render):
        yield


@pytest.fixture
def tone_asset():
    """A real 2-second audio file, staged where the exporter resolves assets."""
    ffmpeg, _ = _BINS  # type: ignore[misc]
    asset_id = uuid.uuid4().hex[:12]
    asset_dir = Paths.motion_assets / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)
    wav = asset_dir / "tone.wav"
    subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=2", str(wav)],
        check=True,
    )
    yield f"/motion/assets/{asset_id}/tone.wav"
    try:
        wav.unlink(missing_ok=True)
        asset_dir.rmdir()
    except OSError:
        pass


def _make_project(name: str, duration_ms: int, audio: AudioTrack | None = None):
    project = storage.create_project(name)
    scene = project.scenes[0]
    scene.duration_ms = duration_ms
    scene.layers.append(
        MotionLayer(
            id=uuid.uuid4().hex[:12], name="Bg", type="rect",
            transform=Transform(x=0, y=0, width=320, height=180),
            rect=RectLayerProps(fill="#3355FF"),
        )
    )
    if audio is not None:
        scene.audio_tracks.append(audio)
    storage.save_project(project)
    return project


def test_export_duration_matches_scene_without_audio(fake_frames):
    project = _make_project("out-noaudio", 3000)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mp4",
        )
        assert _probe_duration(out) == pytest.approx(3.0, abs=0.35)
    finally:
        storage.delete_project(project.id)


def test_all_scenes_export_duration_is_sum_of_scene_durations(fake_frames):
    project = _make_project("out-multiscene", 1000)
    project.scenes.append(
        MotionScene(
            id=uuid.uuid4().hex[:12],
            name="Scene 2",
            duration_ms=2000,
            layers=[
                MotionLayer(
                    id=uuid.uuid4().hex[:12], name="Bg 2", type="rect",
                    transform=Transform(x=0, y=0, width=320, height=180),
                    rect=RectLayerProps(fill="#22AA66"),
                )
            ],
        )
    )
    storage.save_project(project)
    try:
        out = export_service.export_project(
            project_id=project.id, all_scenes=True,
            fps=10, width=320, height=180, format="mp4",
        )
        assert _probe_duration(out) == pytest.approx(3.0, abs=0.35)
    finally:
        storage.delete_project(project.id)


def test_short_audio_does_not_truncate_the_video(fake_frames, tone_asset):
    """Regression: `-shortest` used to cut the video down to the audio length.

    A 5s scene with a 2s voiceover must still export 5s of video. This is the
    exact bug the mocked tests could not see — they only checked that the
    ffmpeg command contained the flags we intended.
    """
    track = AudioTrack(
        id=uuid.uuid4().hex[:12], name="VO", kind="voiceover",
        source_url=tone_asset, start_time_ms=0, duration_ms=2000, volume=1.0,
    )
    project = _make_project("out-shortaudio", 5000, audio=track)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mp4",
        )
        duration = _probe_duration(out)
        assert duration == pytest.approx(5.0, abs=0.35), (
            f"scene is 5s but export is {duration:.2f}s — the audio track "
            f"truncated the video"
        )
        kinds = {s["codec_type"] for s in _probe_streams(out)}
        assert kinds == {"video", "audio"}
    finally:
        storage.delete_project(project.id)


def test_long_audio_does_not_extend_the_video(fake_frames, tone_asset):
    """The mirror of the truncation bug: audio must not make the video LONGER.

    A 1s scene with a 2s track should still export 1s. Fixing truncation by
    padding audio (`apad`) makes the audio stream effectively infinite, so
    without an explicit duration bound the padding would run the export past
    the end of the animation instead.
    """
    track = AudioTrack(
        id=uuid.uuid4().hex[:12], name="Music", kind="music",
        source_url=tone_asset, start_time_ms=0, duration_ms=2000, volume=1.0,
    )
    project = _make_project("out-longaudio", 1000, audio=track)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mp4",
        )
        duration = _probe_duration(out)
        assert duration == pytest.approx(1.0, abs=0.35), (
            f"scene is 1s but export is {duration:.2f}s — the audio track "
            f"extended the video past the animation"
        )
    finally:
        storage.delete_project(project.id)


def test_export_honours_requested_dimensions(fake_frames):
    project = _make_project("out-dims", 2000)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=640, height=360, format="mp4",
        )
        video = next(s for s in _probe_streams(out) if s["codec_type"] == "video")
        assert (video["width"], video["height"]) == (640, 360)
    finally:
        storage.delete_project(project.id)


def test_mov_export_uses_prores_codec(fake_frames):
    if not _has_prores_encoder():
        pytest.skip("ffmpeg build does not include prores_ks")

    project = _make_project("out-mov", 1000)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mov",
        )
        assert out.suffix == ".mov"
        video = next(s for s in _probe_streams(out) if s["codec_type"] == "video")
        assert video["codec_name"] == "prores"
    finally:
        storage.delete_project(project.id)


def test_mov_transparent_export_uses_alpha_capable_pixel_format(fake_frames):
    if not _has_prores_encoder():
        pytest.skip("ffmpeg build does not include prores_ks")

    project = _make_project("out-mov-alpha", 1000)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mov", transparent=True,
        )
        video = next(s for s in _probe_streams(out) if s["codec_type"] == "video")
        assert video["codec_name"] == "prores"
        assert "yuva" in video["pix_fmt"]
    finally:
        storage.delete_project(project.id)


def test_mp4_custom_bitrate_still_produces_video_stream(fake_frames):
    project = _make_project("out-bitrate", 1000)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mp4", video_bitrate="500k",
        )
        video = next(s for s in _probe_streams(out) if s["codec_type"] == "video")
        assert video["codec_name"]
        assert (video["width"], video["height"]) == (320, 180)
    finally:
        storage.delete_project(project.id)


def test_export_without_audio_tracks_has_no_audio_stream(fake_frames):
    project = _make_project("out-silent", 2000)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mp4",
        )
        kinds = {s["codec_type"] for s in _probe_streams(out)}
        assert kinds == {"video"}
    finally:
        storage.delete_project(project.id)
