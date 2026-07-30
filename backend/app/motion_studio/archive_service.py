"""
Project archives (LT-PROJECTIO): get a project OUT of this app as a single
file, and back IN — on a different machine, in a different browser, in
Colab. Nothing else does this today; a project only exists as a JSON file
plus loose asset files on whatever machine created it.

Zip layout:
    project.json                  — the MotionProject, exactly as stored.
    assets/<asset_id>/<filename>  — every asset it references, laid out the
                                     same way motion_assets/ is on disk.

Import assigns a FRESH project id and FRESH asset ids and rewrites every
source_url/src in the imported project to match. An archive that kept the
exporting machine's ids would silently collide with (or overwrite) an
unrelated project or asset that happens to reuse the same id locally —
uuid4 ids are only unique per machine, not globally guaranteed distinct
the moment two exports get merged onto one.
"""

from __future__ import annotations

import re
import uuid
import zipfile
from pathlib import Path

from fastapi import UploadFile

from app.core.config import Paths, get_settings
from app.core.errors import AppError
from app.motion_studio import storage
from app.motion_studio.models import MotionProject

# Matches motion_assets.py's _ASSET_ID_RE / upload id scheme exactly, so an
# archive built by this module and one built by hand from a real
# motion_assets/ directory look identical.
_ASSET_URL_RE = re.compile(r"^/motion/assets/([a-f0-9]{32})/([^/]+)$")
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_ARCHIVE_ASSET_MEMBER_RE = re.compile(r"^assets/([a-f0-9]{32})/([^/\\]+)$")

_CHUNK_SIZE = 1024 * 1024


class InvalidArchiveError(AppError):
    code = "invalid_motion_archive"
    status_code = 400


def _safe_filename(filename: str) -> str:
    name = Path(filename).name.strip().replace(" ", "_")
    name = _SAFE_FILENAME_RE.sub("_", name)[:160]
    return name or "asset"


def _iter_asset_urls(project: MotionProject):
    """Every source_url/src on the project that points at a motion asset,
    in the exact form stored on the layer/track — duplicates included, the
    caller de-dupes by asset id."""
    for scene in project.scenes:
        for track in scene.audio_tracks:
            if track.source_url:
                yield track.source_url
        for layer in scene.layers:
            if layer.video and layer.video.source_url:
                yield layer.video.source_url
            if layer.image and layer.image.src:
                yield layer.image.src


def build_archive(project_id: str) -> Path:
    """Zip a project plus every asset it references. Returns the zip's path
    under Paths.exports, the same directory finished video exports already
    live in and are served from."""
    project = storage.load_project(project_id)

    # asset_id -> filename, de-duplicated so a video used on three layers is
    # only written into the zip once.
    referenced: dict[str, str] = {}
    for url in _iter_asset_urls(project):
        m = _ASSET_URL_RE.match(url)
        if m:
            referenced[m.group(1)] = m.group(2)

    Paths.exports.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(project.name or "project") or "project"
    zip_path = Paths.exports / f"{safe_name}-{project.id}.motionzip"

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("project.json", project.model_dump_json(indent=2))
        for asset_id, filename in referenced.items():
            asset_path = Paths.motion_assets / asset_id / filename
            if not asset_path.exists():
                # The project JSON references an asset that's since been
                # deleted from disk. That project is already broken in the
                # live app today (the layer would fail to load its video/
                # image right now, independent of archiving) — an archive
                # export shouldn't be the thing that first surfaces it, so
                # skip the file rather than fail the whole export.
                continue
            zf.write(asset_path, f"assets/{asset_id}/{filename}")

    return zip_path


def _rewrite_url(url: str, id_map: dict[str, str]) -> str:
    m = _ASSET_URL_RE.match(url)
    if not m or m.group(1) not in id_map:
        return url
    return f"/motion/assets/{id_map[m.group(1)]}/{m.group(2)}"


def _remap_project_assets(project: MotionProject, id_map: dict[str, str]) -> MotionProject:
    new_scenes = []
    for scene in project.scenes:
        new_tracks = [
            track.model_copy(update={"source_url": _rewrite_url(track.source_url, id_map)})
            if track.source_url
            else track
            for track in scene.audio_tracks
        ]
        new_layers = []
        for layer in scene.layers:
            patch: dict = {}
            if layer.video and layer.video.source_url:
                patch["video"] = layer.video.model_copy(
                    update={"source_url": _rewrite_url(layer.video.source_url, id_map)}
                )
            if layer.image and layer.image.src:
                patch["image"] = layer.image.model_copy(
                    update={"src": _rewrite_url(layer.image.src, id_map)}
                )
            new_layers.append(layer.model_copy(update=patch) if patch else layer)
        new_scenes.append(scene.model_copy(update={"layers": new_layers, "audio_tracks": new_tracks}))
    return project.model_copy(update={"scenes": new_scenes})


async def import_archive(file: UploadFile) -> MotionProject:
    """Read an uploaded .motionzip, validate it, and create a new project
    from it with fresh project/asset ids. Raises InvalidArchiveError for
    anything that doesn't look like an archive this module produced —
    not a zip, no project.json, a project.json that doesn't validate as a
    MotionProject, or a zip member that tries to escape motion_assets/ via
    a path-traversal name."""
    settings = get_settings()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    Paths.temp.mkdir(parents=True, exist_ok=True)
    tmp_zip = Paths.temp / f"import-{uuid.uuid4().hex}.zip"
    bytes_written = 0
    try:
        with tmp_zip.open("wb") as out:
            while chunk := await file.read(_CHUNK_SIZE):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    raise InvalidArchiveError(
                        f"Archive exceeds the {settings.max_upload_size_mb} MB upload limit."
                    )
                out.write(chunk)
    finally:
        await file.close()

    try:
        return _extract_and_create(tmp_zip)
    finally:
        tmp_zip.unlink(missing_ok=True)


def _extract_and_create(zip_path: Path) -> MotionProject:
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise InvalidArchiveError("This file is not a valid .motionzip archive.") from exc

    with zf:
        bad_name = zf.testzip()
        if bad_name is not None:
            raise InvalidArchiveError(f"Archive is corrupt: '{bad_name}' failed its CRC check.")

        try:
            raw_project = zf.read("project.json")
        except KeyError as exc:
            raise InvalidArchiveError("Archive has no project.json.") from exc

        try:
            project = MotionProject.model_validate_json(raw_project)
        except Exception as exc:  # pydantic ValidationError, JSON errors, etc.
            raise InvalidArchiveError(f"project.json in the archive is invalid: {exc}") from exc

        # Zip-slip guard: every member must either be exactly "project.json"
        # or match assets/<32-hex>/<filename with no path separators>. A
        # member like "assets/../../../etc/passwd" or an absolute path is
        # rejected outright rather than silently skipped, since a crafted
        # archive getting this far is itself the signal something's wrong.
        asset_members: dict[str, tuple[str, str]] = {}  # asset_id -> (member_name, filename)
        for name in zf.namelist():
            if name == "project.json":
                continue
            m = _ARCHIVE_ASSET_MEMBER_RE.match(name)
            if not m:
                raise InvalidArchiveError(f"Archive contains an unexpected entry: '{name}'.")
            asset_members[m.group(1)] = (name, m.group(2))

        # Every asset the project JSON actually references must be present
        # in the zip. Importing anyway would silently hand back a project
        # whose video/image layers point at ids that don't exist — exactly
        # the "looks fine, plays nothing" failure this feature exists to
        # prevent, just moved one step later.
        referenced_ids = set()
        for url in _iter_asset_urls(project):
            m = _ASSET_URL_RE.match(url)
            if m:
                referenced_ids.add(m.group(1))
        missing = referenced_ids - asset_members.keys()
        if missing:
            raise InvalidArchiveError(
                f"Archive is missing {len(missing)} referenced asset(s): {sorted(missing)}."
            )

        # Fresh ids for everything, then extract assets under their NEW id
        # before the project is written — a project file must never point
        # at an asset that doesn't exist on disk yet.
        id_map = {old: uuid.uuid4().hex for old in asset_members}
        for old_id, (member_name, filename) in asset_members.items():
            new_id = id_map[old_id]
            dest_dir = Paths.motion_assets / new_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            with zf.open(member_name) as src, (dest_dir / _safe_filename(filename)).open("wb") as dst:
                while chunk := src.read(_CHUNK_SIZE):
                    dst.write(chunk)

    remapped = _remap_project_assets(project, id_map)
    new_project = remapped.model_copy(update={"id": uuid.uuid4().hex[:12]})
    return storage.save_project(new_project)
