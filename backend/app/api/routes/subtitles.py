"""
Serves the subtitle engine's built-in style presets so the frontend's live
CSS preview renders the exact same style data the backend's ASS renderer
burns into the export — one source of truth, no hand-duplicated styling.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.subtitle_engine.models import SubtitleStyle
from app.subtitle_engine.presets import BUILTIN_PRESETS

router = APIRouter(prefix="/subtitles", tags=["subtitles"])


@router.get("/presets", response_model=list[SubtitleStyle])
def list_presets() -> list[SubtitleStyle]:
    return BUILTIN_PRESETS
