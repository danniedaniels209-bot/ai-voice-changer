"""
Export pipeline service: stitches rendered frame image sequences into MP4, GIF,
or transparent PNG sequence archives via FFmpeg and zipfile.
"""

from __future__ import annotations

import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Callable

from app.core.config import Paths
from app.core.errors import AppError
from app.core.logging import get_logger
from app.motion_studio import render_service
from app.services.ffmpeg_service import _run, _video_encode_args, resolve_ffmpeg_binaries

logger = get_logger(__name__)

SUPPORTED_FORMATS = {"mp4", "gif", "png_sequence", "png", "zip"}


def export_project(
    project_id: str,
    scene_id: str | None = None,
    fps: int = 30,
    width: int = 1920,
    height: int = 1080,
    format: str = "mp4",
    transparent: bool = False,
    base_url: str | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> Path:
    """
    Renders project frames via render_service, then exports to MP4, GIF, or PNG sequence zip.
    """
    fmt = (format or "mp4").lower()
    if fmt not in SUPPORTED_FORMATS:
        raise AppError(
            f"Unsupported export format '{format}'. Supported formats: mp4, gif, png_sequence"
        )

    frames_dir = Paths.temp / f"motion_frames_{project_id}_{uuid.uuid4().hex[:8]}"
    frames_dir.mkdir(parents=True, exist_ok=True)

    try:
        def _render_progress(p: float) -> None:
            if progress_callback:
                progress_callback(p * 0.7, f"Rendering frame ({int(p * 100)}%)")

        if progress_callback:
            progress_callback(0.0, "Starting frame rendering...")

        render_service.render_frames(
            project_id=project_id,
            scene_id=scene_id,
            output_dir=frames_dir,
            fps=fps,
            width=width,
            height=height,
            transparent=transparent,
            base_url=base_url,
            progress_callback=_render_progress,
        )

        if progress_callback:
            progress_callback(0.75, f"Encoding {fmt.upper()} export...")

        output_file: Path
        token = uuid.uuid4().hex[:8]
        Paths.exports.mkdir(parents=True, exist_ok=True)

        if fmt in ("png_sequence", "png", "zip"):
            output_file = Paths.exports / f"motion_{project_id}_{token}.zip"
            with zipfile.ZipFile(output_file, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for frame_path in sorted(frames_dir.glob("frame_*.png")):
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
            _run(
                cmd,
                error_cls=AppError,
                error_message=f"Failed to encode GIF animation for project '{project_id}'",
            )

        else:  # mp4
            output_file = Paths.exports / f"motion_{project_id}_{token}.mp4"
            ffmpeg_path, _ = resolve_ffmpeg_binaries()
            cmd = [
                ffmpeg_path,
                "-y",
                "-framerate", str(fps),
                "-i", str(frames_dir / "frame_%06d.png"),
                *_video_encode_args("18"),
                "-vf", "format=yuv420p",
                str(output_file),
            ]
            _run(
                cmd,
                error_cls=AppError,
                error_message=f"Failed to stitch frame sequence into MP4 for project '{project_id}'",
            )

        if not output_file.exists() or output_file.stat().st_size == 0:
            raise AppError(f"Export produced an empty file for project '{project_id}'.")

        if progress_callback:
            progress_callback(1.0, "Export complete")

        return output_file
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
