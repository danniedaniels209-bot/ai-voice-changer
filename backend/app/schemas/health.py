from __future__ import annotations

from pydantic import BaseModel


class HardwareStatus(BaseModel):
    cuda_available: bool
    device_name: str | None
    cuda_version: str | None
    torch_version: str | None
    resolved_device: str


class HealthResponse(BaseModel):
    status: str
    app_name: str
    ffmpeg_found: bool
    ffmpeg_path: str | None
    hardware: HardwareStatus
    paths: dict[str, str]
