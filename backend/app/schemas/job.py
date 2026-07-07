from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class JobStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PipelineStage(StrEnum):
    UPLOADED = "uploaded"
    EXTRACTING_AUDIO = "extracting_audio"
    SEPARATING_SPEECH = "separating_speech"
    TRANSCRIBING = "transcribing"
    SYNTHESIZING = "synthesizing"
    CONVERTING_VOICE = "converting_voice"
    MIXING_AUDIO = "mixing_audio"
    MUXING_VIDEO = "muxing_video"
    DONE = "done"


class VideoMetadata(BaseModel):
    duration_seconds: float
    width: int | None = None
    height: int | None = None
    video_codec: str | None = None
    has_audio: bool
    audio_codec: str | None = None
    audio_sample_rate: int | None = None


class LogEntry(BaseModel):
    timestamp: str
    message: str


class Job(BaseModel):
    id: str
    status: JobStatus = JobStatus.PENDING
    stage: PipelineStage = PipelineStage.UPLOADED
    progress_percent: float = 0.0
    created_at: str
    updated_at: str

    original_filename: str | None = None
    video_path: str | None = None
    video_metadata: VideoMetadata | None = None
    audio_path: str | None = None

    model_name: str | None = None
    mode: str | None = None  # "rvc" | "tts" | "script" | "openvoice", set when conversion starts
    # Human-readable snapshot of what the user selected for this conversion
    # (mode, engine, voice, toggles) — shown on the job pages so a running
    # job is never a mystery.
    request_summary: dict[str, str] = Field(default_factory=dict)
    output_path: str | None = None
    subtitle_path: str | None = None
    extra_outputs: list[str] = Field(default_factory=list)  # e.g. vertical variant

    error_code: str | None = None
    error_message: str | None = None

    cancel_requested: bool = False

    log: list[LogEntry] = Field(default_factory=list)

    def to_public_dict(self) -> dict[str, Any]:
        """Same shape as model_dump(), kept as a hook for redacting internal paths later."""
        return self.model_dump()
