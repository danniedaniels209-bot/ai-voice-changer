"""
LT-AUDIODUCK: real end-to-end check on the ACTUAL exported audio, same
philosophy as test_motion_export_output.py — a mocked ffmpeg-command-string
test would pass even if the duck expression were silently wrong (e.g. wrong
sign, wrong time reference), because it never actually mixes real audio.

Two pure sine tones so they're spectrally separable in the mixed output:
  - voiceover: 440 Hz, active [1.0s, 3.0s)
  - music:     880 Hz, whole 6s scene, ducking toggled per test

After a real export, band-pass around 880 Hz and run ffmpeg's volumedetect
on three segments of the SAME mixed file (pre / during / post voiceover).
That measures the MUSIC component's actual level in the real output, not a
synthetic isolated-filter check — if the ramp math or the local-vs-scene
time reference were wrong, this is what would catch it.
"""

from __future__ import annotations

import json
import re
import subprocess
import uuid
from pathlib import Path

import pytest

from app.core.config import Paths
from app.motion_studio import export_service, storage
from app.motion_studio.models import AudioTrack, MotionLayer, RectLayerProps, Transform


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


@pytest.fixture
def fake_frames():
    """Same pattern as test_motion_export_output.py's fixture of the same
    name — real PNG frames via ffmpeg, no browser, everything downstream
    (filtergraph, mux, encode) is the genuine code path."""

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
            [ffmpeg, "-y", "-v", "error", "-f", "lavfi",
             "-i", f"color=c=blue:s={width}x{height}:d={total / fps}",
             "-vframes", str(total), "-start_number", str(start_index),
             str(output_dir / f"frame_%06d.{suffix}")],
            check=True,
        )
        return sorted(output_dir.glob(f"frame_*.{suffix}"))

    from unittest.mock import patch

    with patch.object(export_service.render_service, "render_frames", side_effect=_render):
        yield


def _tone_asset(freq: int) -> str:
    """A real N-Hz sine wave, staged where the exporter resolves assets."""
    ffmpeg, _ = _BINS  # type: ignore[misc]
    asset_id = uuid.uuid4().hex[:12]
    asset_dir = Paths.motion_assets / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)
    wav = asset_dir / "tone.wav"
    subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"sine=frequency={freq}:duration=6", str(wav)],
        check=True,
    )
    return f"/motion/assets/{asset_id}/tone.wav"


def _make_project(name: str, ducking_enabled: bool):
    project = storage.create_project(name)
    scene = project.scenes[0]
    scene.duration_ms = 6000
    scene.layers.append(
        MotionLayer(
            id=uuid.uuid4().hex[:12], name="Bg", type="rect",
            transform=Transform(x=0, y=0, width=320, height=180),
            rect=RectLayerProps(fill="#3355FF"),
        )
    )
    scene.audio_tracks.append(
        AudioTrack(
            id=uuid.uuid4().hex[:12], name="VO", kind="voiceover",
            source_url=_tone_asset(440), start_time_ms=1000, duration_ms=2000, volume=1.0,
        )
    )
    scene.audio_tracks.append(
        AudioTrack(
            id=uuid.uuid4().hex[:12], name="Music", kind="music",
            source_url=_tone_asset(880), start_time_ms=0, duration_ms=6000, volume=1.0,
            ducking_enabled=ducking_enabled,
        )
    )
    storage.save_project(project)
    return project


def _mean_volume_db(mp4: Path, start: float, end: float, band_center: int) -> float:
    """Mean dB of the audio, band-limited around `band_center`, over [start,end)."""
    ffmpeg, _ = _BINS  # type: ignore[misc]
    result = subprocess.run(
        [ffmpeg, "-v", "info", "-ss", str(start), "-to", str(end), "-i", str(mp4),
         "-af", f"bandpass=f={band_center}:width_type=h:w=200,volumedetect",
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    m = re.search(r"mean_volume:\s*(-?[\d.]+)\s*dB", result.stderr)
    assert m, f"volumedetect output not found:\n{result.stderr[-800:]}"
    return float(m.group(1))


def _export_and_measure(ducking_enabled: bool) -> tuple[float, float, float]:
    project = _make_project(f"ducktest-{ducking_enabled}", ducking_enabled)
    try:
        out = export_service.export_project(
            project_id=project.id, scene_id=project.scenes[0].id,
            fps=10, width=320, height=180, format="mp4",
        )
        pre = _mean_volume_db(out, 0.2, 0.7, 880)
        during = _mean_volume_db(out, 1.5, 2.5, 880)
        post = _mean_volume_db(out, 3.5, 4.5, 880)
        return pre, during, post
    finally:
        storage.delete_project(project.id)


def test_ducking_enabled_lowers_music_during_voiceover(fake_frames):
    pre, during, post = _export_and_measure(ducking_enabled=True)
    # _DUCK_RATIO = 0.35 -> 20*log10(0.35) ~= -9.12 dB. Real AAC encode +
    # band-pass measurement isn't exact, so allow a few dB of tolerance —
    # the point is a REAL, SUBSTANTIAL drop, not the theoretical number to
    # the decimal.
    drop = during - pre
    assert drop < -4.0, f"expected a substantial dip during the voiceover, got {drop:+.2f} dB"
    # And it must come back up afterward — a one-way duck that never
    # recovers is as wrong as no duck at all.
    assert post == pytest.approx(pre, abs=1.5)


def test_ducking_disabled_leaves_music_at_full_volume(fake_frames):
    pre, during, post = _export_and_measure(ducking_enabled=False)
    assert during == pytest.approx(pre, abs=1.0)
    assert post == pytest.approx(pre, abs=1.0)


def test_duck_volume_expr_is_none_with_no_voiceover_windows():
    from app.motion_studio.export_service import _duck_volume_expr

    assert _duck_volume_expr(0, 0, 5000, []) is None


def test_duck_volume_expr_windows_outside_track_span_are_dropped():
    from app.motion_studio.export_service import _duck_volume_expr

    # Track spans local [0, 2)s; a voiceover window entirely after that
    # (scene-absolute [10000, 12000)ms) should produce no envelope at all.
    assert _duck_volume_expr(0, 0, 2000, [(10000, 12000)]) is None


def test_duck_volume_expr_uses_track_local_time():
    from app.motion_studio.export_service import _duck_volume_expr

    # A track starting 5s into the scene, with a voiceover window at
    # scene-absolute [6000, 7000)ms, must reference LOCAL time (1.0-2.0s),
    # not the scene-absolute numbers — same reference afade already uses.
    expr = _duck_volume_expr(0, 5000, 3000, [(6000, 7000)])
    assert expr is not None
    # Scene-absolute numbers must NOT leak into the expression...
    assert "6000" not in expr and "7000" not in expr
    # ...only the LOCAL window (1.0-2.0s, padded by the 0.25s ramp on each
    # side -> 0.75 rising / 2.25 falling) should appear.
    assert "0.75" in expr
    assert "2.25" in expr
