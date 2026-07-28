"""
The seams test: one project carried all the way through to a finished file.

Every other test here checks a piece. This checks that the pieces still fit
together, because that is where every serious bug in this feature has
actually lived:

  - video played in the editor but exported as a frozen first frame
  - audio mixed correctly but silently truncated the video to its own length
  - connectors drew on the canvas and vanished from the export
  - a gradient previewed 90 degrees off from how it rendered

Not one of those was visible to a unit test. All of them were obvious within
seconds of exporting a real project and looking at it. So this builds a
project that uses several subsystems at once — a video layer with animated
opacity, a shorter audio track, a text layer — exports it for real, and
asserts on the resulting file.

Playwright IS used here (unlike test_motion_export_output.py, which stubs
the renderer to stay fast). That's the point: the browser render path is
half the seam. It makes this the slowest test in the suite, which is the
right trade for the one test that would have caught the worst bugs we
shipped.

Skips cleanly when ffmpeg/ffprobe or Playwright's browser aren't available.
"""

from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path

import pytest

from app.core.config import Paths
from app.motion_studio import export_service, storage
from app.motion_studio.models import (
    AudioTrack,
    Keyframe,
    MotionLayer,
    RectLayerProps,
    TextLayerProps,
    Transform,
    VideoLayerProps,
)


def _bins() -> tuple[str, str] | None:
    try:
        from app.services.ffmpeg_service import resolve_ffmpeg_binaries

        ffmpeg, ffprobe = resolve_ffmpeg_binaries()
        return (ffmpeg, ffprobe) if ffmpeg and ffprobe else None
    except Exception:
        return None


def _playwright_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            browser.close()
        return True
    except Exception:
        return False


_BINS = _bins()

pytestmark = [
    pytest.mark.skipif(_BINS is None, reason="ffmpeg/ffprobe not available"),
    pytest.mark.slow,
]


def _probe(path: Path) -> dict:
    _, ffprobe = _BINS  # type: ignore[misc]
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,width,height", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


@pytest.fixture
def media(tmp_path):
    """A short silent clip and a shorter tone, staged as uploaded assets.

    The audio is deliberately SHORTER than the scene: that combination is
    what silently truncated exports before, so the fixture bakes the
    regression into every run of this test.
    """
    ffmpeg, _ = _BINS  # type: ignore[misc]
    created: list[Path] = []

    def stage(name: str, args: list[str]) -> str:
        asset_id = uuid.uuid4().hex[:12]
        d = Paths.motion_assets / asset_id
        d.mkdir(parents=True, exist_ok=True)
        dest = d / name
        subprocess.run([ffmpeg, "-y", "-v", "error", *args, str(dest)], check=True)
        created.append(d)
        return f"/motion/assets/{asset_id}/{name}"

    # libopenh264 explicitly: this ffmpeg build has no libx264, and the
    # default mp4 encoder here is mpeg4, which Chromium cannot decode. A clip
    # the browser can't play renders as nothing, which makes the
    # frames-differ assertion below fail for a reason that has nothing to do
    # with the code under test.
    video_url = stage("clip.mp4", [
        "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=3",
        "-c:v", "libopenh264", "-pix_fmt", "yuv420p",
    ])
    audio_url = stage("vo.wav", ["-f", "lavfi", "-i", "sine=frequency=440:duration=2"])
    yield {"video": video_url, "audio": audio_url}

    for d in created:
        for f in d.iterdir():
            f.unlink(missing_ok=True)
        d.rmdir()


@pytest.fixture
def journey_project(media):
    """Video + text + audio in one 4s scene. Audio is 2s on purpose."""
    project = storage.create_project("journey test")
    scene = project.scenes[0]
    scene.duration_ms = 4000
    scene.width, scene.height = 960, 540

    scene.layers.append(
        MotionLayer(
            id=uuid.uuid4().hex[:12], name="Caption", type="text",
            transform=Transform(x=40, y=40, width=880, height=120),
            text=TextLayerProps(text="Journey", font_size=48, color="#FFFFFF"),
        )
    )
    # Animated opacity so the export has to interpolate, not just draw t=0.
    scene.layers.append(
        MotionLayer(
            id=uuid.uuid4().hex[:12], name="Footage", type="video",
            transform=Transform(x=100, y=120, width=760, height=380),
            video=VideoLayerProps(source_url=media["video"]),
            keyframes=[
                Keyframe(id="k1", time_ms=0, property="opacity", value=0.0, easing="ease_out"),
                Keyframe(id="k2", time_ms=1000, property="opacity", value=1.0, easing="spring"),
            ],
        )
    )
    # A moving rect as well as the video. If the frames-differ test ever fails
    # again, this narrows it immediately: a rect needs no codec, so identical
    # frames means keyframe interpolation is broken, not media decoding.
    scene.layers.append(
        MotionLayer(
            id=uuid.uuid4().hex[:12], name="Mover", type="rect",
            transform=Transform(x=0, y=460, width=80, height=40),
            rect=RectLayerProps(fill="#FF3366"),
            keyframes=[
                Keyframe(id="m1", time_ms=0, property="x", value=0, easing="linear"),
                Keyframe(id="m2", time_ms=4000, property="x", value=800, easing="linear"),
            ],
        )
    )
    scene.audio_tracks.append(
        AudioTrack(
            id=uuid.uuid4().hex[:12], name="VO", kind="voiceover",
            source_url=media["audio"], start_time_ms=0, duration_ms=2000, volume=0.9,
        )
    )
    storage.save_project(project)
    yield project
    storage.delete_project(project.id)


@pytest.mark.skipif(not _playwright_available(), reason="Playwright browser not installed")
def test_full_journey_export(journey_project):
    scene = journey_project.scenes[0]

    out = export_service.export_project(
        project_id=journey_project.id,
        scene_id=scene.id,
        fps=10,
        width=960,
        height=540,
        format="mp4",
    )
    out = Path(out)
    assert out.exists(), "export reported success but produced no file"

    info = _probe(out)
    duration = float(info["format"]["duration"])
    kinds = {s["codec_type"] for s in info["streams"]}
    video = next(s for s in info["streams"] if s["codec_type"] == "video")

    # The scene is 4s and the voiceover is 2s. If this comes back ~2s, audio
    # is truncating the video again and the user has silently lost half
    # their animation.
    assert duration == pytest.approx(4.0, abs=0.4), (
        f"scene is 4s but export is {duration:.2f}s — audio truncated the video"
    )
    assert kinds == {"video", "audio"}, f"expected muxed video+audio, got {kinds}"
    assert (video["width"], video["height"]) == (960, 540)

    out.unlink(missing_ok=True)


@pytest.mark.skipif(not _playwright_available(), reason="Playwright browser not installed")
def test_animated_frames_are_not_identical(journey_project, tmp_path):
    """Frames must differ over time.

    A frozen export is the failure this catches: the video layer used to
    render its poster frame for every frame, and the opacity keyframes above
    have to actually interpolate. Identical frames means one of those broke,
    and both look completely fine in a metadata check.
    """
    from app.motion_studio import render_service

    frames_dir = tmp_path / "frames"
    paths = render_service.render_frames(
        project_id=journey_project.id,
        scene_id=journey_project.scenes[0].id,
        output_dir=frames_dir,
        fps=4,
        width=320,
        height=180,
    )
    assert len(paths) >= 8, f"expected ~16 frames for a 4s scene at 4fps, got {len(paths)}"

    digests = {Path(p).read_bytes() for p in paths[:8]}
    assert len(digests) > 1, (
        "every rendered frame is byte-identical — the animation isn't being "
        "applied, or the video layer is stuck on one frame"
    )
