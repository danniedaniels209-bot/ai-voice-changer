"""
POST /upload — the entry point of the pipeline: accept a video file, save it
to disk in streamed chunks (never buffering the whole file in memory),
validate it's a real video via ffprobe, and extract its audio track.

Later stages (Demucs separation, RVC conversion, mixing, final mux) are
triggered by /convert in a background job — this endpoint only covers
upload + validation + audio extraction, the first pipeline stage.
"""

from __future__ import annotations

import re
import shutil
import threading
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

from app.core.config import Paths, get_settings
from app.core.errors import InvalidVideoError
from app.schemas.job import Job, JobStatus, PipelineStage
from app.services import ffmpeg_service
from app.utils import job_manager

router = APIRouter(tags=["upload"])

_CHUNK_SIZE = 1024 * 1024  # 1 MB per chunk while streaming to disk

# --- Chunked uploads ---------------------------------------------------------
# Cloudflare quick tunnels cap a single request body at ~100 MB, so big videos
# can't arrive in one POST when running as a cloud session. The client splits
# the file into <100 MB parts (POST /upload/chunk, sequential) and then
# POST /upload/finalize assembles the same job the one-shot /upload creates.
_UPLOAD_ID_RE = re.compile(r"^[a-f0-9-]{8,64}$")
_chunk_lock = threading.Lock()
_chunk_state: dict[str, int] = {}  # upload_id -> next expected index


def _chunk_dir() -> Path:
    d = Paths.temp / "chunked_uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _part_path(upload_id: str) -> Path:
    return _chunk_dir() / f"{upload_id}.part"


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
        return _ingest_saved_video(job, job_dir, video_path)

    except Exception as exc:
        _fail_and_clean(job.id, job_dir, exc)
        raise


def _ingest_saved_video(job: Job, job_dir: Path, video_path: Path) -> Job:
    """Probe + audio-extract a video already saved into its job dir —
    shared by the one-shot upload and the chunked finalize."""
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


def _fail_and_clean(job_id: str, job_dir: Path, exc: Exception) -> None:
    code = getattr(exc, "code", "internal_error")
    message = getattr(exc, "message", str(exc))
    job_manager.mark_failed(job_id, code, message)
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


@router.post("/upload/chunk")
async def upload_chunk(
    upload_id: str = Form(...),
    index: int = Form(...),
    chunk: UploadFile = File(...),
) -> dict:
    settings = get_settings()
    if not _UPLOAD_ID_RE.match(upload_id):
        raise InvalidVideoError("Invalid upload id.")

    part = _part_path(upload_id)
    with _chunk_lock:
        expected = _chunk_state.get(upload_id, 0)
        if index != expected:
            # Out-of-order or retried chunk — tell the client where we are so
            # it can resume instead of corrupting the file.
            raise InvalidVideoError(
                f"Chunk {index} out of order (expected {expected}).",
            )
        _chunk_state[upload_id] = expected + 1

    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    written = part.stat().st_size if part.exists() else 0
    try:
        with part.open("ab") as out_file:
            while piece := await chunk.read(_CHUNK_SIZE):
                written += len(piece)
                if written > max_bytes:
                    raise InvalidVideoError(
                        f"File exceeds the {settings.max_upload_size_mb} MB upload limit."
                    )
                out_file.write(piece)
        await chunk.close()
    except Exception:
        with _chunk_lock:
            _chunk_state.pop(upload_id, None)
        part.unlink(missing_ok=True)
        raise

    return {"received": index + 1, "bytes": written}


class FinalizeRequest(BaseModel):
    upload_id: str
    filename: str
    total_chunks: int


@router.post("/upload/finalize", response_model=Job)
def finalize_upload(request: FinalizeRequest) -> Job:
    if not _UPLOAD_ID_RE.match(request.upload_id):
        raise InvalidVideoError("Invalid upload id.")

    part = _part_path(request.upload_id)
    with _chunk_lock:
        received = _chunk_state.pop(request.upload_id, 0)
    if not part.exists() or received == 0:
        raise InvalidVideoError("No uploaded data found for this upload id.")
    if received != request.total_chunks:
        part.unlink(missing_ok=True)
        raise InvalidVideoError(
            f"Upload incomplete: {received} of {request.total_chunks} chunks arrived."
        )

    suffix = Path(request.filename).suffix.lower()
    if suffix not in ffmpeg_service.SUPPORTED_INPUT_EXTENSIONS:
        part.unlink(missing_ok=True)
        raise InvalidVideoError(
            f"Unsupported video format '{suffix}'. "
            f"Supported formats: {', '.join(sorted(ffmpeg_service.SUPPORTED_INPUT_EXTENSIONS))}"
        )

    job = job_manager.create_job(original_filename=request.filename)
    job_dir = Paths.job_temp_dir(job.id)
    video_path = job_dir / f"input{suffix}"
    try:
        shutil.move(str(part), str(video_path))
        size_mb = video_path.stat().st_size / (1024 * 1024)
        job_manager.append_log(
            job.id, f"Saved upload ({size_mb:.1f} MB, {request.total_chunks} chunks)"
        )
        return _ingest_saved_video(job, job_dir, video_path)
    except Exception as exc:
        _fail_and_clean(job.id, job_dir, exc)
        raise
