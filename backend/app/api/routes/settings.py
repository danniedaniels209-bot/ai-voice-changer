"""
GET/PUT /settings — device mode, ffmpeg path, temp/export folder overrides,
and export quality. Backs the Settings page in the frontend.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.settings import AppSettings, AppSettingsUpdate
from app.utils.settings_store import load_settings, update_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettings)
def get_settings_endpoint() -> AppSettings:
    return load_settings()


@router.put("", response_model=AppSettings)
def put_settings_endpoint(patch: AppSettingsUpdate) -> AppSettings:
    return update_settings(patch)
