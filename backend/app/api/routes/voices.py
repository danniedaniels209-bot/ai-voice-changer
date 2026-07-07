"""
GET /voices — the curated list of neural narrator voices available for
TTS-mode conversion (mode='tts' on POST /convert).
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.config import Paths
from app.core.errors import AppError
from app.services.tts_service import CURATED_VOICES, DEFAULT_VOICE, _synthesize_one

router = APIRouter(tags=["voices"])

_PREVIEW_TEXT = "This is how your videos will sound with this voice."


class VoiceInfo(BaseModel):
    id: str
    label: str
    gender: str
    accent: str
    is_default: bool


@router.get("/voices", response_model=list[VoiceInfo])
def list_voices() -> list[VoiceInfo]:
    return [
        VoiceInfo(
            id=v.id, label=v.label, gender=v.gender, accent=v.accent, is_default=v.id == DEFAULT_VOICE
        )
        for v in CURATED_VOICES
    ]


class CustomVoiceInfo(BaseModel):
    id: str
    name: str
    size_mb: float


@router.get("/voices/custom", response_model=list[CustomVoiceInfo])
def list_custom_voices() -> list[CustomVoiceInfo]:
    from app.utils import custom_voices

    return [CustomVoiceInfo(**v) for v in custom_voices.list_voices()]


@router.post("/voices/custom", response_model=CustomVoiceInfo)
async def upload_custom_voice(name: str = Form(...), sample: UploadFile = File(...)) -> CustomVoiceInfo:
    from app.utils import custom_voices

    return CustomVoiceInfo(**custom_voices.save_voice(name, sample))


@router.delete("/voices/custom/{name}")
def delete_custom_voice(name: str) -> dict:
    from app.utils import custom_voices

    custom_voices.delete_voice(name)
    return {"deleted": name}


@router.get("/voices/custom/{name}/preview")
def custom_voice_preview(name: str) -> FileResponse:
    from app.utils import custom_voices

    path = custom_voices.voice_path(f"custom:{name}")
    return FileResponse(str(path), media_type="audio/wav", filename=path.name)


@router.get("/voices/{voice_id}/preview")
def voice_preview(voice_id: str) -> FileResponse:
    """
    A short spoken sample of the voice, synthesized once and cached on disk
    so repeat listens (and offline sessions after the first) are instant.
    """
    from app.utils import custom_voices

    if custom_voices.is_custom_voice(voice_id):
        # A custom voice's preview is its own sample.
        path = custom_voices.voice_path(voice_id)
        return FileResponse(str(path), media_type="audio/wav", filename=path.name)

    if not any(v.id == voice_id for v in CURATED_VOICES):
        raise AppError(f"Unknown voice '{voice_id}'.", details={"voice_id": voice_id})

    cache_dir = Paths.temp / "voice_previews"
    cache_dir.mkdir(parents=True, exist_ok=True)
    sample_path = cache_dir / f"{voice_id}.mp3"

    if not sample_path.exists():
        _synthesize_one(_PREVIEW_TEXT, voice_id, sample_path)

    return FileResponse(str(sample_path), media_type="audio/mpeg", filename=sample_path.name)
