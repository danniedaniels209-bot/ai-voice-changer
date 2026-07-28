"""
Export pipeline service: stitches rendered frame image sequences into MP4, GIF,
or transparent PNG sequence archives via FFmpeg and zipfile.
"""

from __future__ import annotations

import shutil
import subprocess
import re
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Callable

from app.core.config import Paths
from app.core.errors import AppError
from app.core.logging import get_logger
from app.motion_studio import render_service, storage
from app.services.ffmpeg_service import _video_encode_args, resolve_ffmpeg_binaries

logger = get_logger(__name__)

SUPPORTED_FORMATS = {"mp4", "mov", "gif", "png_sequence", "png", "zip"}
_BITRATE_RE = re.compile(r"^[1-9][0-9]*(?:k|K|m|M)?$")
_prores_encoder_available_cache: bool | None = None


class ExportCancelled(AppError):
    code = "motion_export_cancelled"
    status_code = 409


def _raise_if_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event and cancel_event.is_set():
        raise ExportCancelled("Motion export was cancelled.")


def _validate_video_bitrate(video_bitrate: str | None) -> str | None:
    if video_bitrate is None:
        return None
    value = video_bitrate.strip()
    if not _BITRATE_RE.match(value):
        raise AppError("Video bitrate must be a positive number, optionally followed by k or M.")
    return value


def _mp4_encode_args(video_crf: str, video_bitrate: str | None) -> list[str]:
    if not video_bitrate:
        return _video_encode_args(video_crf)
    from app.services.ffmpeg_service import _h264_encoder

    encoder = _h264_encoder()
    return ["-c:v", encoder, "-b:v", video_bitrate, "-pix_fmt", "yuv420p"]


def _prores_encoder_available() -> bool:
    global _prores_encoder_available_cache
    if _prores_encoder_available_cache is None:
        ffmpeg_path, _ = resolve_ffmpeg_binaries()
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        _prores_encoder_available_cache = " prores_ks " in result.stdout
    return _prores_encoder_available_cache


def _mov_encode_args(transparent: bool) -> list[str]:
    if not _prores_encoder_available():
        raise AppError(
            "MOV export requires an FFmpeg build with the prores_ks encoder."
        )
    pix_fmt = "yuva444p10le" if transparent else "yuv422p10le"
    return ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", pix_fmt]


def _run_cancellable(
    cmd: list[str],
    *,
    cancel_event: threading.Event | None,
    error_message: str,
) -> subprocess.CompletedProcess:
    logger.debug("Running: %s", " ".join(cmd))
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
    except FileNotFoundError as exc:
        from app.core.errors import FFmpegNotFoundError

        raise FFmpegNotFoundError(f"Could not execute FFmpeg/ffprobe: {exc}") from exc

    while True:
        try:
            stdout, stderr = process.communicate(timeout=0.1)
            break
        except subprocess.TimeoutExpired:
            if not (cancel_event and cancel_event.is_set()):
                continue
            process.terminate()
            try:
                stdout, stderr = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate(timeout=5)
            raise ExportCancelled("Motion export was cancelled.")

    result = subprocess.CompletedProcess(cmd, process.returncode, stdout, stderr)
    if result.returncode != 0:
        stderr_tail = "\n".join((result.stderr or "").strip().splitlines()[-15:])
        raise AppError(f"{error_message}: {stderr_tail}")
    return result


def export_project(
    project_id: str,
    scene_id: str | None = None,
    all_scenes: bool = False,
    fps: int = 30,
    width: int = 1920,
    height: int = 1080,
    format: str = "mp4",
    transparent: bool = False,
    video_crf: str = "18",
    video_bitrate: str | None = None,
    base_url: str | None = None,
    cancel_event: threading.Event | None = None,
    status_callback: Callable[[str], None] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> Path:
    """
    Renders project frames via render_service, then exports to MP4, GIF, or PNG sequence zip.
    """
    fmt = (format or "mp4").lower()
    if fmt not in SUPPORTED_FORMATS:
        raise AppError(
            f"Unsupported export format '{format}'. Supported formats: mp4, mov, gif, png_sequence"
        )
    video_bitrate = _validate_video_bitrate(video_bitrate)
    if fmt == "mov" and not _prores_encoder_available():
        raise AppError("MOV export requires an FFmpeg build with the prores_ks encoder.")

    frames_dir = Paths.temp / f"motion_frames_{project_id}_{uuid.uuid4().hex[:8]}"
    frames_dir.mkdir(parents=True, exist_ok=True)

    try:
        frame_format = "jpeg" if fmt in {"mp4", "mov"} and not transparent else "png"
        frame_suffix = "jpg" if frame_format == "jpeg" else "png"
        _raise_if_cancelled(cancel_event)
        project = storage.load_project(project_id)
        if not project.scenes:
            raise AppError(f"Project '{project_id}' contains no scenes.")

        if all_scenes:
            selected_scenes = project.scenes
        else:
            scene = None
            if scene_id:
                scene = next((s for s in project.scenes if s.id == scene_id), None)
            selected_scenes = [scene or project.scenes[0]]

        scene_frame_counts = [
            max(1, int((max(1, scene.duration_ms) / 1000.0) * fps))
            for scene in selected_scenes
        ]
        expected_frame_count = sum(scene_frame_counts)
        total_duration_s = sum(max(1, scene.duration_ms) for scene in selected_scenes) / 1000.0

        rendered_frames = 0

        def _render_progress(p: float) -> None:
            if progress_callback:
                complete = (rendered_frames + p * current_scene_frames) / expected_frame_count
                progress_callback(complete * 0.7, f"Rendering frame ({int(complete * 100)}%)")

        if progress_callback:
            progress_callback(0.0, "Starting frame rendering...")
        if status_callback:
            status_callback("rendering")

        next_frame_index = 0
        for scene, current_scene_frames in zip(selected_scenes, scene_frame_counts, strict=True):
            _raise_if_cancelled(cancel_event)
            render_service.render_frames(
                project_id=project_id,
                scene_id=scene.id,
                output_dir=frames_dir,
                fps=fps,
                width=width,
                height=height,
                transparent=transparent,
                output_format=frame_format,
                base_url=base_url,
                start_index=next_frame_index,
                cancel_event=cancel_event,
                progress_callback=_render_progress,
            )
            _raise_if_cancelled(cancel_event)
            rendered_frames += current_scene_frames
            next_frame_index += current_scene_frames

        frame_paths = sorted(frames_dir.glob(f"frame_*.{frame_suffix}"))
        if len(frame_paths) != expected_frame_count:
            raise AppError(
                f"Expected {expected_frame_count} rendered frames for project '{project_id}', "
                f"found {len(frame_paths)}."
            )
        for expected_index, frame_path in enumerate(frame_paths):
            if frame_path.name != f"frame_{expected_index:06d}.{frame_suffix}":
                raise AppError(
                    f"Rendered frame sequence has a gap at frame {expected_index} "
                    f"for project '{project_id}'."
                )

        if progress_callback:
            progress_callback(0.75, f"Encoding {fmt.upper()} export...")
        if status_callback:
            status_callback("encoding")

        output_file: Path
        token = uuid.uuid4().hex[:8]
        Paths.exports.mkdir(parents=True, exist_ok=True)

        if fmt in ("png_sequence", "png", "zip"):
            output_file = Paths.exports / f"motion_{project_id}_{token}.zip"
            with zipfile.ZipFile(output_file, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for frame_path in sorted(frames_dir.glob("frame_*.png")):
                    _raise_if_cancelled(cancel_event)
                    zf.write(frame_path, arcname=frame_path.name)

        elif fmt == "gif":
            output_file = Paths.exports / f"motion_{project_id}_{token}.gif"
            ffmpeg_path, _ = resolve_ffmpeg_binaries()
            cmd = [
                ffmpeg_path,
                "-y",
                "-framerate", str(fps),
                "-i", str(frames_dir / "frame_%06d.png"),
                "-vf", "split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse",
                str(output_file),
            ]
            _run_cancellable(
                cmd,
                cancel_event=cancel_event,
                error_message=f"Failed to encode GIF animation for project '{project_id}'",
            )

        else:  # mp4/mov
            output_file = Paths.exports / f"motion_{project_id}_{token}.{fmt}"
            ffmpeg_path, _ = resolve_ffmpeg_binaries()

            active_tracks = []
            scene_offset_ms = 0
            for scene in selected_scenes:
                any_solo = any(t.solo for t in scene.audio_tracks)
                for t in scene.audio_tracks:
                    if t.muted:
                        continue
                    if any_solo and not t.solo:
                        continue
                    if not t.source_url:
                        continue
                    # Resolve relative path from CODEX's uploader
                    if t.source_url.startswith("/motion/assets/"):
                        rel_path = t.source_url[len("/motion/assets/"):]
                        track_path = Paths.motion_assets / rel_path
                        if track_path.exists():
                            active_tracks.append((t, track_path, scene_offset_ms))
                        else:
                            logger.warning("Audio track file not found: %s", track_path)
                    else:
                        logger.warning("Audio track ignored: unsupported URL scheme '%s'", t.source_url)
                scene_offset_ms += max(1, scene.duration_ms)

            cmd = [
                ffmpeg_path,
                "-y",
                "-framerate", str(fps),
                "-i", str(frames_dir / f"frame_%06d.{frame_suffix}"),
            ]

            if active_tracks:
                video_args = _mov_encode_args(transparent) if fmt == "mov" else _mp4_encode_args(video_crf, video_bitrate)
                video_filter_args = [] if fmt == "mov" else ["-vf", "format=yuv420p"]
                filters = []
                for idx, (track, track_path, scene_offset_ms) in enumerate(active_tracks, start=1):
                    cmd.extend(["-i", str(track_path)])
                    t_filter = f"[{idx}:a]atrim=0:{track.duration_ms / 1000.0}"
                    if track.fade_in_ms > 0:
                        t_filter += f",afade=t=in:st=0:d={track.fade_in_ms / 1000.0}"
                    if track.fade_out_ms > 0:
                        fade_out_start = (track.duration_ms - track.fade_out_ms) / 1000.0
                        t_filter += f",afade=t=out:st={fade_out_start}:d={track.fade_out_ms / 1000.0}"
                    t_filter += f",volume={track.volume}"
                    delay_ms = scene_offset_ms + track.start_time_ms
                    if delay_ms > 0:
                        t_filter += f",adelay={delay_ms}|{delay_ms}"
                    t_filter += f"[a{idx}];"
                    filters.append(t_filter)

                if len(active_tracks) == 1:
                    filters.append("[a1]apad[aout]")
                    filter_complex = "".join(filters)
                    map_audio = "[aout]"
                else:
                    amix_in = "".join(f"[a{i}]" for i in range(1, len(active_tracks) + 1))
                    filters.append(f"{amix_in}amix=inputs={len(active_tracks)}:duration=longest:dropout_transition=0:normalize=0[amixout];")
                    filters.append("[amixout]apad[aout]")
                    filter_complex = "".join(filters)
                    map_audio = "[aout]"

                cmd.extend([
                    *video_args,
                    *video_filter_args,
                    "-filter_complex", filter_complex,
                    "-map", "0:v",
                    "-map", map_audio,
                    "-c:a", "aac",
                    "-b:a", "256k",
                    "-t", str(total_duration_s),
                    str(output_file),
                ])
            else:
                video_args = _mov_encode_args(transparent) if fmt == "mov" else _mp4_encode_args(video_crf, video_bitrate)
                video_filter_args = [] if fmt == "mov" else ["-vf", "format=yuv420p"]
                cmd.extend([
                    *video_args,
                    *video_filter_args,
                    str(output_file),
                ])

            _run_cancellable(
                cmd,
                cancel_event=cancel_event,
                error_message=f"Failed to stitch frame sequence into {fmt.upper()} for project '{project_id}'",
            )

        if not output_file.exists() or output_file.stat().st_size == 0:
            raise AppError(f"Export produced an empty file for project '{project_id}'.")

        if progress_callback:
            progress_callback(1.0, "Export complete")

        return output_file
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
