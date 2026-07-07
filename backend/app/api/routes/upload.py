"""
POST /upload — the entry point of the pipeline: accept a video file, save it
to disk in streamed chunks (never buffering the whole file in memory),
validate it's a real video via ffprobe, and extract its audio track.

Later stages (Demucs separation, RVC conversion, mixing, final mux) are
triggered by /convert in a background job — this endpoint only covers
upload + validation + audio extraction, the first pipeline stage.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from app.core.config import Paths, get_settings
from app.core.errors import InvalidVideoError
from app.schemas.job import Job, JobStatus, PipelineStage
from app.services import ffmpeg_service
from app.utils import job_manager

router = APIRouter(tags=["upload"])

_CHUNK_SIZE = 1024 * 1024  # 1 MB per chunk while streaming to disk


@router.post("/upload", response_model=Job)
async def upload_video(video: UploadFile = File(...)) -> Job:
    settings = get_settings()

    if not video.filename:
        raise InvalidVideoError("Uploaded file has no filename.")

    suffix = Path(video.filename).suffix.lower()
    if suffix not in ffmpeg_service.SUPPORTED_INPUT_EXTENSIONS:
        raise InvalidVideoError(
            f"Unsupported video format '{suffix}'. "
            f"Supported formats: {', '.join(sorted(ffmpeg_service.SUPPORTED_INPUT_EXTENSIONS))}"
        )

    job = job_manager.create_job(original_filename=video.filename)
    job_dir = Paths.job_temp_dir(job.id)
    video_path = job_dir / f"input{suffix}"
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    bytes_written = 0
    try:
        with video_path.open("wb") as out_file:
            while chunk := await video.read(_CHUNK_SIZE):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    raise InvalidVideoError(
                        f"File exceeds the {settings.max_upload_size_mb} MB upload limit."
                    )
                out_file.write(chunk)
        await video.close()

        job_manager.append_log(job.id, f"Saved upload ({bytes_written / (1024 * 1024):.1f} MB)")

        metadata = ffmpeg_service.probe_video(video_path)

        job = job_manager.update_job(
            job.id,
            video_path=str(video_path),
            video_metadata=metadata,
        )
        job_manager.append_log(
            job.id,
            f"Probed video: {metadata.duration_seconds:.1f}s, "
            f"{metadata.width}x{metadata.height}, audio={metadata.audio_codec or 'none'}",
        )

        # A silent video is still usable in script-narration mode — voice
        # conversion modes check for an audio track at /convert time instead.
        if metadata.has_audio:
            job_manager.append_log(job.id, "Extracting audio track...")
            audio_path = job_dir / "audio_original.wav"
            ffmpeg_service.extract_audio(video_path, audio_path)
            job = job_manager.update_job(
                job.id, stage=PipelineStage.EXTRACTING_AUDIO, audio_path=str(audio_path)
            )
            job_manager.append_log(job.id, "Audio extraction complete.")
        else:
            job = job_manager.update_job(job.id, stage=PipelineStage.EXTRACTING_AUDIO)
            job_manager.append_log(
                job.id,
                "No audio track — usable with script narration; voice conversion modes need speech.",
            )

        return job

    except Exception as exc:
        code = getattr(exc, "code", "internal_error")
        message = getattr(exc, "message", str(exc))
        job_manager.mark_failed(job.id, code, message)
        # A failed upload can leave a large partial file behind (worst case:
        # one that just exceeded the size limit). Nothing later cleans up a
        # job that never succeeds, so delete everything except job.json now.
        for entry in job_dir.iterdir():
            if entry.name == "job.json":
                continue
            try:
                entry.unlink()
            except OSError:
                pass
        raise
