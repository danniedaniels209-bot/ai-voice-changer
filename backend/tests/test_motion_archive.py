"""
LT-PROJECTIO: exporting a project (plus its assets) to a single .motionzip
and importing it back with fresh ids.

Round-trip tests, not behaviour-in-isolation tests, because the failure this
feature exists to prevent is specifically an id COLLISION or a stale
reference surviving the trip — those only show up when you actually export
then import and inspect what came out the other side.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.routes import motion, motion_assets
from app.core.errors import AppError


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "motion_projects", tmp_path / "motion_projects")
    monkeypatch.setattr(Paths, "motion_assets", tmp_path / "motion_assets")
    monkeypatch.setattr(Paths, "exports", tmp_path / "exports")
    monkeypatch.setattr(Paths, "temp", tmp_path / "temp")

    app = FastAPI()
    app.include_router(motion.router)
    app.include_router(motion_assets.router)

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        )

    with TestClient(app) as c:
        yield c


def _upload_fake_video(client) -> dict:
    # Real bytes, not a real video — motion_assets' validator only checks
    # extension + declared content-type, and the archive path never decodes
    # the file, so this exercises the same code paths a real clip would.
    fake_mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 512
    resp = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.mp4", io.BytesIO(fake_mp4), "video/mp4")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _project_with_video_layer(client) -> dict:
    asset = _upload_fake_video(client)
    project = client.post("/motion/projects", json={"name": "Archive Me"}).json()
    project["scenes"][0]["layers"] = [
        {
            "id": "vid1",
            "name": "Clip",
            "type": "video",
            "transform": {"x": 0, "y": 0, "width": 640, "height": 480, "rotation": 0, "opacity": 1, "blur": 0},
            "locked": False,
            "hidden": False,
            "rect": None,
            "ellipse": None,
            "text": None,
            "image": None,
            "video": {
                "source_url": asset["source_url"],
                "trim_start_ms": 0,
                "trim_end_ms": 0,
                "playback_rate": 1.0,
                "muted": False,
                "volume": 1.0,
                "fit": "contain",
            },
            "keyframes": [],
        }
    ]
    saved = client.put(f"/motion/projects/{project['id']}", json=project).json()
    return saved, asset


def test_archive_round_trips_a_project_with_a_video_asset(client):
    original, asset = _project_with_video_layer(client)

    zip_resp = client.get(f"/motion/projects/{original['id']}/archive")
    assert zip_resp.status_code == 200
    assert zip_resp.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(zip_resp.content))
    names = zf.namelist()
    assert "project.json" in names
    assert any(n.startswith(f"assets/{original_asset_id(asset)}/") for n in names)

    import_resp = client.post(
        "/motion/projects/import",
        files={"file": ("archive.motionzip", io.BytesIO(zip_resp.content), "application/zip")},
    )
    assert import_resp.status_code == 200, import_resp.text
    imported = import_resp.json()

    # A NEW project id — never the same as the source, on the same machine
    # or a different one.
    assert imported["id"] != original["id"]

    # Scene/layer content is otherwise identical.
    assert imported["scenes"][0]["layers"][0]["type"] == "video"
    assert imported["scenes"][0]["layers"][0]["video"]["fit"] == "contain"

    # The asset URL was rewritten to a NEW asset id, not the original one —
    # the whole point being that this project no longer depends on the
    # exporting machine's asset store.
    new_url = imported["scenes"][0]["layers"][0]["video"]["source_url"]
    old_url = original["scenes"][0]["layers"][0]["video"]["source_url"]
    assert new_url != old_url
    assert new_url.endswith("/clip.mp4")

    # And that new asset id actually resolves to real bytes on disk — an
    # import that rewrites the URL but doesn't extract the file is worse
    # than one that doesn't rewrite it at all, since it fails silently at
    # playback time instead of at import time.
    fetch = client.get(new_url)
    assert fetch.status_code == 200
    assert fetch.content == b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 512


def original_asset_id(asset: dict) -> str:
    # source_url is "/motion/assets/{asset_id}/{filename}"
    return asset["source_url"].split("/")[3]


def test_importing_twice_produces_two_independent_projects(client):
    """The scenario the fresh-id rule exists for: importing the same
    archive twice (e.g. two teammates downloading the same shared file)
    must not collide."""
    original, _ = _project_with_video_layer(client)
    zip_bytes = client.get(f"/motion/projects/{original['id']}/archive").content

    first = client.post(
        "/motion/projects/import",
        files={"file": ("a.motionzip", io.BytesIO(zip_bytes), "application/zip")},
    ).json()
    second = client.post(
        "/motion/projects/import",
        files={"file": ("a.motionzip", io.BytesIO(zip_bytes), "application/zip")},
    ).json()

    assert first["id"] != second["id"]
    url_a = first["scenes"][0]["layers"][0]["video"]["source_url"]
    url_b = second["scenes"][0]["layers"][0]["video"]["source_url"]
    assert url_a != url_b
    # Both must independently resolve — importing the second didn't
    # overwrite or invalidate the first's asset copy.
    assert client.get(url_a).status_code == 200
    assert client.get(url_b).status_code == 200


def test_archive_deduplicates_an_asset_used_by_two_layers(client):
    asset = _upload_fake_video(client)
    project = client.post("/motion/projects", json={"name": "Reused clip"}).json()
    layer = {
        "id": "vid1", "name": "A", "type": "video",
        "transform": {"x": 0, "y": 0, "width": 100, "height": 100, "rotation": 0, "opacity": 1, "blur": 0},
        "locked": False, "hidden": False,
        "rect": None, "ellipse": None, "text": None, "image": None,
        "video": {
            "source_url": asset["source_url"], "trim_start_ms": 0, "trim_end_ms": 0,
            "playback_rate": 1.0, "muted": False, "volume": 1.0, "fit": "contain",
        },
        "keyframes": [],
    }
    layer2 = {**layer, "id": "vid2", "name": "B"}
    project["scenes"][0]["layers"] = [layer, layer2]
    saved = client.put(f"/motion/projects/{project['id']}", json=project).json()

    zip_bytes = client.get(f"/motion/projects/{saved['id']}/archive").content
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    asset_members = [n for n in zf.namelist() if n.startswith("assets/")]
    assert len(asset_members) == 1, f"expected one deduplicated asset entry, got {asset_members}"

    imported = client.post(
        "/motion/projects/import",
        files={"file": ("d.motionzip", io.BytesIO(zip_bytes), "application/zip")},
    ).json()
    url_a = imported["scenes"][0]["layers"][0]["video"]["source_url"]
    url_b = imported["scenes"][0]["layers"][1]["video"]["source_url"]
    # Both layers point at the SAME new asset — not two separate copies.
    assert url_a == url_b


# --- malformed archives -------------------------------------------------


def test_importing_a_non_zip_file_is_rejected(client):
    resp = client.post(
        "/motion/projects/import",
        files={"file": ("archive.motionzip", io.BytesIO(b"not a zip at all"), "application/zip")},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_motion_archive"


def test_importing_a_zip_with_no_project_json_is_rejected(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "not a project archive")
    buf.seek(0)

    resp = client.post(
        "/motion/projects/import",
        files={"file": ("archive.motionzip", buf, "application/zip")},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_motion_archive"


def test_importing_a_zip_with_invalid_project_json_is_rejected(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("project.json", '{"not": "a valid project"}')
    buf.seek(0)

    resp = client.post(
        "/motion/projects/import",
        files={"file": ("archive.motionzip", buf, "application/zip")},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_motion_archive"


def test_importing_a_zip_with_a_path_traversal_member_is_rejected(client):
    """The zip-slip attack: a member name designed to write outside
    motion_assets/ when naively extracted.

    Includes the REAL referenced asset alongside the malicious extra member
    — otherwise this would also fail via the separate "missing referenced
    asset" check for an unrelated reason, and pass without the traversal
    guard actually having been exercised."""
    original, asset = _project_with_video_layer(client)
    zip_bytes = client.get(f"/motion/projects/{original['id']}/archive").content

    zf_in = zipfile.ZipFile(io.BytesIO(zip_bytes))
    project_json = zf_in.read("project.json")
    real_asset_member = next(n for n in zf_in.namelist() if n.startswith("assets/"))
    real_asset_bytes = zf_in.read(real_asset_member)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("project.json", project_json)
        zf.writestr(real_asset_member, real_asset_bytes)
        zf.writestr("assets/../../../evil.txt", b"escaped")
    buf.seek(0)

    resp = client.post(
        "/motion/projects/import",
        files={"file": ("archive.motionzip", buf, "application/zip")},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_motion_archive"


def test_importing_a_zip_missing_a_referenced_asset_is_rejected(client):
    """project.json references an asset the archive doesn't actually
    contain — a truncated or hand-edited archive. Importing anyway would
    hand back a project whose video layer points at nothing."""
    original, _ = _project_with_video_layer(client)
    zip_bytes = client.get(f"/motion/projects/{original['id']}/archive").content

    zf_in = zipfile.ZipFile(io.BytesIO(zip_bytes))
    project_json = zf_in.read("project.json")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("project.json", project_json)
        # deliberately omit the assets/ member
    buf.seek(0)

    resp = client.post(
        "/motion/projects/import",
        files={"file": ("archive.motionzip", buf, "application/zip")},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_motion_archive"


def test_exporting_a_scene_only_project_with_no_assets_still_works(client):
    """No video/image layers at all — the common case, and it must not
    require an assets/ entry to exist."""
    project = client.post("/motion/projects", json={"name": "Plain"}).json()
    zip_resp = client.get(f"/motion/projects/{project['id']}/archive")
    assert zip_resp.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(zip_resp.content))
    assert zf.namelist() == ["project.json"]

    imported = client.post(
        "/motion/projects/import",
        files={"file": ("p.motionzip", io.BytesIO(zip_resp.content), "application/zip")},
    ).json()
    assert imported["id"] != project["id"]
    assert imported["name"] == "Plain"
