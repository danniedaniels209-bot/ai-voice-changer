"""
Motion Studio project CRUD. No AI involved — every project is built by the
user; this just persists/serves the scene JSON (see storage.py) so the
editor can save/load/autosave.
"""

from __future__ import annotations

import mimetypes
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.config import Paths
from app.core.errors import AppError, JobNotFoundError
from app.core.logging import get_logger
from app.motion_studio import export_service, storage
from app.motion_studio.models import MotionProject

logger = get_logger(__name__)
router = APIRouter(prefix="/motion", tags=["motion"])


@router.get("/projects")
def list_projects() -> list[dict]:
    return storage.list_projects()


@router.post("/projects")
def create_project(body: dict) -> MotionProject:
    name = (body or {}).get("name") or "Untitled Project"
    return storage.create_project(name)


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> MotionProject:
    return storage.load_project(project_id)


@router.put("/projects/{project_id}")
def put_project(project_id: str, project: MotionProject) -> MotionProject:
    # The URL is the source of truth for identity — ignore a mismatched
    # body id rather than let a stale client silently save under the wrong
    # file.
    project = project.model_copy(update={"id": project_id})
    return storage.save_project(project)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    storage.delete_project(project_id)
    return {"deleted": True}


# --- Motion Project Export Pipeline ---

_export_tasks: dict[str, dict] = {}
_export_lock = threading.Lock()


class ExportRequest(BaseModel):
    scene_id: str | None = None
    fps: int = 30
    width: int = 1920
    height: int = 1080
    format: str = "mp4"
    transparent: bool = False
    base_url: str | None = None


def _run_export(
    task_id: str,
    project_id: str,
    scene_id: str | None = None,
    fps: int = 30,
    width: int = 1920,
    height: int = 1080,
    format: str = "mp4",
    transparent: bool = False,
    base_url: str | None = None,
) -> None:
    def publish(**fields) -> None:
        with _export_lock:
            if task_id in _export_tasks:
                _export_tasks[task_id].update(fields)

    try:
        publish(status="rendering", progress=0.0)
        output_file = export_service.export_project(
            project_id=project_id,
            scene_id=scene_id,
            fps=fps,
            width=width,
            height=height,
            format=format,
            transparent=transparent,
            base_url=base_url,
            progress_callback=lambda p, msg: publish(progress=p, status=msg),
        )
        download_url = f"/motion/exports/download/{output_file.name}"
        publish(
            status="done",
            done=True,
            progress=1.0,
            export_path=str(output_file),
            download_path=download_url,
        )
    except Exception as exc:
        logger.exception("Export background task failed for project %s", project_id)
        publish(status="error", done=True, error=str(exc))


@router.post("/projects/{project_id}/export")
def export_project_endpoint(project_id: str, body: ExportRequest | None = None) -> dict:
    storage.load_project(project_id)

    req = body or ExportRequest()
    task_id = uuid.uuid4().hex

    with _export_lock:
        for stale in list(_export_tasks)[:-19]:
            _export_tasks.pop(stale, None)
        _export_tasks[task_id] = {
            "task_id": task_id,
            "project_id": project_id,
            "status": "queued",
            "done": False,
            "progress": 0.0,
            "export_path": None,
            "download_path": None,
            "error": None,
        }

    threading.Thread(
        target=_run_export,
        args=(
            task_id,
            project_id,
            req.scene_id,
            req.fps,
            req.width,
            req.height,
            req.format,
            req.transparent,
            req.base_url,
        ),
        daemon=True,
        name=f"motion-export-{task_id[:8]}",
    ).start()

    return {"task_id": task_id}


@router.get("/projects/export/{task_id}")
@router.get("/export/{task_id}")
def get_export_status(task_id: str) -> dict:
    with _export_lock:
        task = _export_tasks.get(task_id)
    if task is None:
        raise JobNotFoundError(f"Export task '{task_id}' not found.")
    return task


@router.get("/exports/download/{filename}")
def download_export(filename: str) -> FileResponse:
    file_path = Paths.exports / filename
    if not file_path.exists() or not file_path.is_file():
        raise JobNotFoundError(f"Exported video file '{filename}' was not found.")
    # Export can now produce mp4, gif, or a zip of PNG frames — serve each
    # with its real content type instead of a hardcoded "video/mp4" that
    # was only ever true before GIF/PNG-sequence export existed.
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(str(file_path), media_type=media_type, filename=filename)

