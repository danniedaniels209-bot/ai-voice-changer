"""
Project persistence: one JSON file per project under Paths.motion_projects,
no database — same convention as app_settings.json. A project is small
(shape/text data, no media blobs — images/video reference uploaded asset
paths, not embedded bytes), so a full-file read/write per save is cheap
and keeps this dead simple to reason about and back up.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import Paths
from app.core.errors import MotionProjectNotFoundError
from app.motion_studio.models import MotionProject, MotionScene

_last_timestamp_lock = threading.Lock()
_last_timestamp: datetime | None = None


def _now() -> str:
    """Strictly increasing even across back-to-back calls — the OS clock's
    real resolution isn't always finer than isoformat's microseconds, so
    two saves a few instructions apart could otherwise stamp identically,
    which breaks anything (like MARK_SAVED's dirty-check) that relies on
    updated_at actually changing on every save.

    Collisions are resolved by advancing a microsecond rather than by
    decorating the string: the result has to stay parseable by JS's
    `new Date(...)` (the project list renders it), and anything that isn't
    strict ISO-8601 there comes out as "Invalid Date"."""
    global _last_timestamp
    with _last_timestamp_lock:
        now = datetime.now(timezone.utc)
        if _last_timestamp is not None and now <= _last_timestamp:
            now = _last_timestamp + timedelta(microseconds=1)
        _last_timestamp = now
        return now.isoformat()


def _project_path(project_id: str) -> Path:
    return Paths.motion_projects / f"{project_id}.json"


def create_project(name: str = "Untitled Project") -> MotionProject:
    project_id = uuid.uuid4().hex[:12]
    now = _now()
    project = MotionProject(
        id=project_id,
        name=name,
        scenes=[MotionScene(id=uuid.uuid4().hex[:12], name="Scene 1")],
        created_at=now,
        updated_at=now,
    )
    save_project(project)
    return project


def save_project(project: MotionProject) -> MotionProject:
    project = project.model_copy(update={"updated_at": _now()})
    path = _project_path(project.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(project.model_dump_json(indent=2), encoding="utf-8")
    return project


def load_project(project_id: str) -> MotionProject:
    path = _project_path(project_id)
    if not path.exists():
        raise MotionProjectNotFoundError(f"No Motion Studio project with id '{project_id}'.")
    return MotionProject.model_validate_json(path.read_text(encoding="utf-8"))


def delete_project(project_id: str) -> None:
    path = _project_path(project_id)
    if not path.exists():
        raise MotionProjectNotFoundError(f"No Motion Studio project with id '{project_id}'.")
    path.unlink()


def list_projects() -> list[dict]:
    """Lightweight summaries (id/name/updated_at) for a project picker —
    avoids parsing every layer of every scene just to show a list."""
    summaries = []
    for path in sorted(Paths.motion_projects.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        summaries.append({
            "id": data.get("id", path.stem),
            "name": data.get("name", "Untitled Project"),
            "updated_at": data.get("updated_at", ""),
            "scene_count": len(data.get("scenes", [])),
        })
    summaries.sort(key=lambda s: s["updated_at"], reverse=True)
    return summaries
