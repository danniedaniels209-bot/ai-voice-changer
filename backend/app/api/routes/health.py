"""
GET /health — used by the frontend on startup to show FFmpeg/CUDA status
before the user even tries to convert anything, and by developers to sanity
check the backend is up.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import Paths, get_settings
from app.core.hardware import get_hardware_info
from app.schemas.health import HardwareStatus, HealthResponse
from app.utils.settings_store import get_effective_device_mode, get_effective_ffmpeg_path

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    settings = get_settings()
    ffmpeg_path = get_effective_ffmpeg_path()
    hardware = get_hardware_info(get_effective_device_mode())

    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        ffmpeg_found=ffmpeg_path is not None,
        ffmpeg_path=ffmpeg_path,
        hardware=HardwareStatus(
            cuda_available=hardware.cuda_available,
            device_name=hardware.device_name,
            cuda_version=hardware.cuda_version,
            torch_version=hardware.torch_version,
            resolved_device=hardware.resolved_device,
        ),
        paths={
            "models": str(Paths.models),
            "temp": str(Paths.temp),
            "exports": str(Paths.exports),
            "ffmpeg_dir": str(Paths.ffmpeg_dir),
            "logs": str(Paths.logs),
        },
    )
