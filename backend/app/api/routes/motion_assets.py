"""Persistent media assets for Motion Studio projects."""

from __future__ import annotations

import mimetypes
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse

from app.core.config import Paths, get_settings
from app.core.errors import AppError, JobNotFoundError
from app.motion_studio import storage

router = APIRouter(prefix="/motion/assets", tags=["motion"])

_CHUNK_SIZE = 1024 * 1024
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_ASSET_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_VIDEO_SUFFIXES = {
    ".mp4",
    ".mov",
    ".m4v",
    ".webm",
    ".avi",
    ".mkv",
}
_IMAGE_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
}
_ALLOWED_SUFFIXES = _VIDEO_SUFFIXES | _IMAGE_SUFFIXES


class InvalidMotionAssetError(AppError):
    code = "invalid_motion_asset"
    status_code = 400


class MotionAssetInUseError(AppError):
    code = "motion_asset_in_use"
    status_code = 409


def _safe_filename(filename: str) -> str:
    raw = filename.strip()
    if "/" in raw or "\\" in raw:
        raise InvalidMotionAssetError("Asset filename must not contain path separators.")

    name = Path(raw).name.strip().replace(" ", "_")
    name = _SAFE_FILENAME_RE.sub("_", name)
    name = name[:160]
    if not name or name in {".", ".."}:
        raise InvalidMotionAssetError("Asset filename is invalid.")
    return name


def _validate_media_type(filename: str, content_type: str | None) -> str:
    suffix = Path(filename).suffix.lower()
    media_kind = (content_type or "").split(";", 1)[0].lower()

    if suffix not in _ALLOWED_SUFFIXES:
        raise InvalidMotionAssetError(
            "Unsupported Motion Studio asset format.",
            details={"suffix": suffix, "allowed": sorted(_ALLOWED_SUFFIXES)},
        )
    if suffix in _VIDEO_SUFFIXES and not media_kind.startswith("video/"):
        raise InvalidMotionAssetError(
            "Uploaded video asset must have a video/* content type.",
            details={"content_type": content_type, "suffix": suffix},
        )
    if suffix in _IMAGE_SUFFIXES and not media_kind.startswith("image/"):
        raise InvalidMotionAssetError(
            "Uploaded image asset must have an image/* content type.",
            details={"content_type": content_type, "suffix": suffix},
        )
    return media_kind


def _asset_file(asset_id: str, filename: str) -> Path:
    if not _ASSET_ID_RE.match(asset_id):
        raise JobNotFoundError("Motion asset was not found.")
    safe_name = _safe_filename(filename)
    asset_path = (Paths.motion_assets / asset_id / safe_name).resolve()
    asset_root = (Paths.motion_assets / asset_id).resolve()
    if asset_root not in asset_path.parents:
        raise JobNotFoundError("Motion asset was not found.")
    return asset_path


def _asset_dir(asset_id: str) -> Path:
    if not _ASSET_ID_RE.match(asset_id):
        raise JobNotFoundError("Motion asset was not found.")
    return (Paths.motion_assets / asset_id).resolve()


def _iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def _asset_references(asset_id: str) -> list[dict]:
    prefix = f"/motion/assets/{asset_id}/"
    references = []
    for summary in storage.list_projects():
        project_id = summary["id"]
        try:
            project = storage.load_project(project_id)
        except AppError:
            continue
        for scene in project.scenes:
            for track in scene.audio_tracks:
                if track.source_url.startswith(prefix):
                    references.append({
                        "project_id": project.id,
                        "project_name": project.name,
                        "scene_id": scene.id,
                        "scene_name": scene.name,
                        "kind": "audio",
                        "id": track.id,
                        "name": track.name,
                    })
            for layer in scene.layers:
                source_url = None
                if layer.video and layer.video.source_url:
                    source_url = layer.video.source_url
                elif layer.image and layer.image.src:
                    source_url = layer.image.src
                if source_url and source_url.startswith(prefix):
                    references.append({
                        "project_id": project.id,
                        "project_name": project.name,
                        "scene_id": scene.id,
                        "scene_name": scene.name,
                        "kind": "layer",
                        "id": layer.id,
                        "name": layer.name,
                    })
    return references


@router.get("")
def list_motion_assets() -> list[dict]:
    assets = []
    if not Paths.motion_assets.exists():
        return assets

    for asset_dir in sorted(Paths.motion_assets.iterdir()):
        if not asset_dir.is_dir() or not _ASSET_ID_RE.match(asset_dir.name):
            continue
        for asset_path in sorted(asset_dir.iterdir()):
            if not asset_path.is_file():
                continue
            stat = asset_path.stat()
            assets.append({
                "asset_id": asset_dir.name,
                "filename": asset_path.name,
                "source_url": f"/motion/assets/{asset_dir.name}/{asset_path.name}",
                "content_type": mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream",
                "size_bytes": stat.st_size,
                "created": _iso_from_timestamp(stat.st_ctime),
            })
    assets.sort(key=lambda asset: asset["created"], reverse=True)
    return assets


@router.post("/upload")
async def upload_motion_asset(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise InvalidMotionAssetError("Uploaded asset has no filename.")

    safe_name = _safe_filename(file.filename)
    media_type = _validate_media_type(safe_name, file.content_type)

    asset_id = uuid.uuid4().hex
    asset_dir = Paths.motion_assets / asset_id
    asset_dir.mkdir(parents=True, exist_ok=True)
    asset_path = asset_dir / safe_name
    settings = get_settings()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    bytes_written = 0
    too_large = False
    try:
        with asset_path.open("wb") as out_file:
            while chunk := await file.read(_CHUNK_SIZE):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    too_large = True
                    break
                out_file.write(chunk)
    finally:
        await file.close()

    if too_large:
        asset_path.unlink(missing_ok=True)
        raise InvalidMotionAssetError(
            f"File exceeds the {settings.max_upload_size_mb} MB upload limit."
        )

    source_url = f"/motion/assets/{asset_id}/{safe_name}"
    return {
        "asset_id": asset_id,
        "filename": safe_name,
        "source_url": source_url,
        "content_type": media_type or mimetypes.guess_type(safe_name)[0],
        "size_bytes": bytes_written,
    }


@router.get("/{asset_id}/{filename}", response_model=None)
def get_motion_asset(asset_id: str, filename: str) -> FileResponse:
    asset_path = _asset_file(asset_id, filename)
    if not asset_path.exists() or not asset_path.is_file():
        raise JobNotFoundError("Motion asset was not found.")
    media_type = mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream"
    return FileResponse(str(asset_path), media_type=media_type, filename=asset_path.name)


@router.delete("/{asset_id}")
def delete_motion_asset(asset_id: str) -> dict:
    asset_dir = _asset_dir(asset_id)
    if not asset_dir.exists() or not asset_dir.is_dir():
        raise JobNotFoundError("Motion asset was not found.")

    references = _asset_references(asset_id)
    if references:
        raise MotionAssetInUseError(
            "Motion asset is still referenced by one or more projects.",
            details={"asset_id": asset_id, "references": references},
        )

    shutil.rmtree(asset_dir)
    return {"deleted": True, "asset_id": asset_id}
