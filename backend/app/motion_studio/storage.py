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

from pydantic import ValidationError

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


def _first_scene_for_thumbnail(data: dict) -> dict | None:
    """The project's first scene, validated + defaulted via MotionScene, for
    the project list's thumbnail preview (LT-PROJECTTHUMBNAILS).

    list_projects() already parses the FULL raw JSON of every project file
    below (json.loads on the whole thing) — the "lightweight" it avoids is
    validating every layer of EVERY scene through MotionProject's full
    model, not the file read itself. So pulling one scene's dict out of
    that already-parsed data and validating just THAT one scene is real
    work but bounded per project (one scene, not all of them), not an added
    file read — no N+1 introduced here.

    Returns None (never raises) for a project with zero scenes or a first
    scene that fails to validate, so one corrupt project degrades to "no
    thumbnail" for itself rather than breaking the whole list — same
    per-project fault isolation the JSONDecodeError guard below already
    gives the rest of this function.
    """
    scenes = data.get("scenes") or []
    if not scenes:
        return None
    try:
        scene = MotionScene.model_validate(scenes[0])
    except ValidationError:
        return None
    dump = scene.model_dump()
    # Thumbnails only ever draw layers/connectors — audio never renders.
    # Zeroed rather than omitted so the shape still matches MotionScene
    # (the frontend type isn't Partial<MotionScene>), just with nothing to
    # ship: no reason to send voiceover URLs/keyframes to a list page.
    dump["audio_tracks"] = []
    return dump


def list_projects() -> list[dict]:
    """Lightweight summaries (id/name/updated_at/first_scene) for a project
    picker — avoids VALIDATING every layer of every scene (the expensive
    part) just to show a list. See _first_scene_for_thumbnail for why
    including one scene doesn't reintroduce that cost."""
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
            "first_scene": _first_scene_for_thumbnail(data),
        })
    summaries.sort(key=lambda s: s["updated_at"], reverse=True)
    return summaries
