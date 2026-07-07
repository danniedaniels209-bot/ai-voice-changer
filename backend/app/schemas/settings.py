from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DeviceMode = Literal["auto", "cuda", "cpu"]
ExportQuality = Literal["low", "medium", "high", "lossless"]

# CRF (lower = higher quality, larger file) and audio bitrate per export
# quality tier. Used by ffmpeg_service when muxing the final video.
EXPORT_QUALITY_PRESETS: dict[ExportQuality, dict[str, str]] = {
    "low": {"video_crf": "28", "audio_bitrate": "128k"},
    "medium": {"video_crf": "23", "audio_bitrate": "192k"},
    "high": {"video_crf": "18", "audio_bitrate": "256k"},
    "lossless": {"video_crf": "0", "audio_bitrate": "320k"},
}


class AppSettings(BaseModel):
    """
    User-editable runtime preferences, persisted as JSON in
    backend/app_settings.json (no database, per project requirements).
    """

    device_mode: DeviceMode = Field(
        default="auto",
        description="'auto' uses CUDA if available, else CPU. Can be forced either way.",
    )
    ffmpeg_path: str | None = Field(
        default=None,
        description="Explicit path to ffmpeg.exe. If null, resolved from ffmpeg/ folder or system PATH.",
    )
    temp_dir: str | None = Field(
        default=None,
        description="Override for the scratch/temp directory. If null, uses the project's temp/ folder.",
    )
    export_dir: str | None = Field(
        default=None,
        description="Override output folder for finished videos. If null, uses the project's exports/ folder.",
    )
    export_quality: ExportQuality = Field(default="high")
    delete_temp_on_success: bool = Field(
        default=True,
        description="Whether to delete a job's temp/<job_id>/ folder after a successful export.",
    )

    # --- Optional output features (toggled on the Settings page) ---
    generate_subtitles: bool = Field(
        default=True,
        description="Save a .srt subtitle file next to the export (TTS/script modes only).",
    )
    burn_captions: bool = Field(
        default=False,
        description="Burn captions into the video image (TTS/script modes only; re-encodes video).",
    )
    vertical_export: bool = Field(
        default=False,
        description="Also export a 9:16 center-cropped variant for Shorts/Reels.",
    )
    music_ducking: bool = Field(
        default=True,
        description="Automatically lower background audio while the voice is speaking.",
    )
    loudness_normalization: bool = Field(
        default=True,
        description="Normalize final audio to YouTube's -14 LUFS loudness standard.",
    )
    animated_captions: bool = Field(
        default=False,
        description=(
            "When burning captions, render them word-by-word (Shorts/TikTok "
            "style) instead of static lines. Requires 'Burn captions'."
        ),
    )
    custom_voices: bool = Field(
        default=True,
        description=(
            "Enable 'My Voices': clone a voice from a short audio sample and "
            "use it for narration (local Chatterbox/OpenVoice engines only)."
        ),
    )
    rename_duplicates: bool = Field(
        default=True,
        description=(
            "Never overwrite existing exports: save as 'name (1).mp4' etc. "
            "Also used as the fallback when a destination file is locked by "
            "another application. Off = overwrite existing files."
        ),
    )
    verify_exports: bool = Field(
        default=True,
        description=(
            "Verify every export before saving (openable, audio stream "
            "present, valid duration); failed verification aborts the job "
            "instead of publishing a corrupted file."
        ),
    )
    context_recognition: bool = Field(
        default=True,
        description=(
            "Context-aware technical recognition: protect uncertain technical "
            "terms (AI models, products, companies) from being treated as "
            "ordinary English, and normalize name capitalization."
        ),
    )
    default_narration_engine: Literal["edge", "chatterbox"] = Field(
        default="edge",
        description=(
            "Engine pre-selected on the Home page for narration modes. "
            "'edge' = fast cloud voices; 'chatterbox' = local human-like model."
        ),
    )


class AppSettingsUpdate(BaseModel):
    """All fields optional — PUT /settings only overwrites what's provided."""

    device_mode: DeviceMode | None = None
    ffmpeg_path: str | None = None
    temp_dir: str | None = None
    export_dir: str | None = None
    export_quality: ExportQuality | None = None
    delete_temp_on_success: bool | None = None
    generate_subtitles: bool | None = None
    burn_captions: bool | None = None
    vertical_export: bool | None = None
    music_ducking: bool | None = None
    loudness_normalization: bool | None = None
    animated_captions: bool | None = None
    custom_voices: bool | None = None
    rename_duplicates: bool | None = None
    verify_exports: bool | None = None
    context_recognition: bool | None = None
    default_narration_engine: Literal["edge", "chatterbox"] | None = None
