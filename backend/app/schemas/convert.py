from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.rvc import VoiceConversionParams

ConversionMode = Literal["rvc", "tts", "script", "openvoice"]
VoiceStyle = Literal["standard", "preserve_prosody"]


class ContinuitySettings(BaseModel):
    """
    Natural-continuity processing: makes the converted output sound like one
    continuous performance instead of independently processed clips.
    Disabled by default — existing projects and settings behave exactly as
    before unless the user turns this on.
    """

    enabled: bool = Field(
        default=False,
        description="Master switch for all continuity processing.",
    )
    context_window: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description=(
            "How much previous speech is considered: 0 = short (small chunks, "
            "fast memory decay), 1 = long (large merged chunks, slow decay)."
        ),
    )
    voice_stability: int = Field(
        default=70,
        ge=0,
        le=100,
        description=(
            "Higher = more consistent voice identity between segments "
            "(Chatterbox: stronger reference guidance, lower sampling "
            "temperature, deterministic seed)."
        ),
    )
    prosody_preservation: int = Field(
        default=70,
        ge=0,
        le=100,
        description=(
            "How strongly the original speaking style is transferred in "
            "RVC preserve mode (weights the loudness-envelope transfer)."
        ),
    )
    naturalness: int = Field(
        default=70,
        ge=0,
        le=100,
        description=(
            "Strength of boundary smoothing: crossfade length between "
            "segments and loudness-discontinuity smoothing on the final track."
        ),
    )
    adaptive_segmentation: bool = Field(
        default=True,
        description=(
            "Merge speech across brief pauses into sentence/paragraph-sized "
            "chunks so prosody doesn't reset at every silence."
        ),
    )
    rolling_memory: bool = Field(
        default=True,
        description=(
            "Each segment inherits the energy trend of previous segments "
            "(exponential moving average with gradual decay)."
        ),
    )


class ChainStage(BaseModel):
    """
    Optional second conversion applied to the voice track produced by the
    primary mode — "merge modes". Examples: narrate a script with a TTS
    voice, then convert that narration with an RVC model; or re-voice speech
    with TTS, then run it through OpenVoice toward another voice's timbre.
    Timing is unchanged by either engine, so subtitles stay accurate.
    """

    mode: Literal["rvc", "openvoice"]
    model_name: str | None = Field(default=None, description="RVC model for mode='rvc'.")
    tts_voice: str = Field(
        default="en-US-GuyNeural", description="Target voice for mode='openvoice'."
    )


class ConvertRequest(BaseModel):
    mode: ConversionMode = Field(
        default="rvc",
        description=(
            "'rvc' converts the speaker's timbre with a voice model, keeping "
            "their original delivery. 'tts' transcribes the speech and "
            "re-synthesizes it with an AI narrator voice (the 'AI ad' sound) "
            "— requires internet for the synthesis step."
        ),
    )
    model_name: str | None = Field(
        default=None,
        description="Name of a voice model in models/. Required for mode='rvc'.",
    )
    tts_voice: str = Field(
        default="en-US-GuyNeural",
        description="Neural voice id for mode='tts' or 'script'. See GET /voices.",
    )
    narration_engine: Literal["edge", "chatterbox"] = Field(
        default="edge",
        description=(
            "Voice engine for tts/script modes. 'edge' = Microsoft neural "
            "voices (fast, needs internet). 'chatterbox' = local human-like "
            "model with voice cloning and an emotion dial (slower on CPU)."
        ),
    )
    exaggeration: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Chatterbox emotion intensity: 0 = monotone, 0.5 = neutral, 1 = dramatic.",
    )
    script: str | None = Field(
        default=None,
        description=(
            "Narration text for mode='script': the video keeps its original "
            "audio as a background bed and this text is spoken over it by "
            "the chosen voice. Required for mode='script'."
        ),
    )
    chain: ChainStage | None = Field(
        default=None,
        description="Optional second conversion stage applied to the primary mode's voice track.",
    )
    continuity: ContinuitySettings = Field(
        default_factory=ContinuitySettings,
        description="Natural-continuity processing (off by default).",
    )
    dub_language: str | None = Field(
        default=None,
        description=(
            "Translation dubbing (tts mode): translate the transcript into "
            "this language code (es/fr/de/pt/hi/it/ja/ko/ar/ru) and narrate "
            "it with a matching voice. Needs a GPU session (uses the local "
            "LLM for translation). None = no translation."
        ),
    )
    precision_alignment: bool = Field(
        default=False,
        description=(
            "Anchor synthesized speech to the exact word timings of the "
            "original (tts mode): phrases are split at natural speech "
            "boundaries and placed precisely where the words were spoken. "
            "Trades a little flow for word-accurate placement. Off = "
            "previous behavior, unchanged."
        ),
    )
    voice_style: VoiceStyle = Field(
        default="standard",
        description=(
            "'preserve_prosody' keeps the original speaker's delivery "
            "(emphasis, intonation, rhythm, pauses, loudness dynamics) and "
            "changes only the voice identity. Supported by RVC mode; TTS mode "
            "re-synthesizes speech from text and cannot preserve delivery."
        ),
    )
    params: VoiceConversionParams = Field(default_factory=VoiceConversionParams)
    skip_separation: bool = Field(
        default=False,
        description=(
            "Skip Demucs speech/background separation and mixing, feeding the "
            "extracted audio straight into RVC. Use for videos with no "
            "background music — faster, since there's nothing to separate "
            "or re-mix. If the audio does have music, that music gets "
            "converted along with the voice rather than preserved untouched."
        ),
    )
    subtitle_language: str | None = Field(
        default=None,
        description=(
            "Also export a translated .srt subtitle file in this language "
            "(es/fr/de/pt/hi/it/ja/ko/ar/ru) next to the English one — the "
            "audio is untouched. Needs a GPU session (uses the local LLM). "
            "tts/script modes only (RVC keeps the original words)."
        ),
    )
    compress_output: bool = Field(
        default=False,
        description=(
            "Re-encode the video at export (CRF 23, visually transparent) for "
            "a much smaller file — useful for high-bitrate editor exports "
            "(CapCut etc. often produce 200 MB+ files). Off (default) "
            "stream-copies the video bit-exact."
        ),
    )
