"""
Typed exceptions for every documented failure mode. FastAPI exception
handlers (registered in main.py) catch these and turn them into structured
JSON errors — the frontend gets a stable `code` to branch on instead of
having to parse a message string, and the user never sees a raw traceback.
"""

from __future__ import annotations


class AppError(Exception):
    """Base class for all handled application errors."""

    code: str = "internal_error"
    status_code: int = 500

    def __init__(self, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class FFmpegNotFoundError(AppError):
    code = "ffmpeg_not_found"
    status_code = 424  # Failed Dependency


class ModelNotFoundError(AppError):
    code = "model_not_found"
    status_code = 404


class DuplicateModelError(AppError):
    code = "duplicate_model"
    status_code = 409


class InvalidModelFileError(AppError):
    code = "invalid_model_file"
    status_code = 400


class InvalidVideoError(AppError):
    code = "invalid_video"
    status_code = 400


class CorruptAudioError(AppError):
    code = "corrupt_audio"
    status_code = 422


class TranscriptionError(AppError):
    code = "transcription_failed"
    status_code = 422


class SynthesisError(AppError):
    code = "synthesis_failed"
    status_code = 502  # edge-tts is a remote service; failures are usually network-side


class CudaUnavailableError(AppError):
    code = "cuda_unavailable"
    status_code = 424


class OutOfMemoryError(AppError):
    code = "out_of_memory"
    status_code = 507


class JobInterruptedError(AppError):
    code = "job_interrupted"
    status_code = 409


class JobNotFoundError(AppError):
    code = "job_not_found"
    status_code = 404


class InsufficientDiskSpaceError(AppError):
    code = "insufficient_disk_space"
    status_code = 507


class InvalidSettingsError(AppError):
    code = "invalid_settings"
    status_code = 400
