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
    app = FastAPI()
    app.include_router(motion.router)
    app.include_router(motion_assets.router)

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            },
        )

    with TestClient(app) as c:
        yield c


def test_create_then_get_project(client):
    created = client.post("/motion/projects", json={"name": "My Explainer"}).json()
    assert created["name"] == "My Explainer"
    assert len(created["scenes"]) == 1

    fetched = client.get(f"/motion/projects/{created['id']}").json()
    assert fetched["id"] == created["id"]
    assert fetched["name"] == created["name"]
    assert fetched["scenes"] == created["scenes"]


def test_list_projects_returns_summaries(client):
    client.post("/motion/projects", json={"name": "A"})
    client.post("/motion/projects", json={"name": "B"})

    listing = client.get("/motion/projects").json()
    assert {p["name"] for p in listing} == {"A", "B"}
    assert all("scene_count" in p for p in listing)


def test_put_saves_scene_edits(client):
    created = client.post("/motion/projects", json={"name": "Edit me"}).json()
    created["scenes"][0]["background_color"] = "#123456"

    saved = client.put(f"/motion/projects/{created['id']}", json=created).json()
    assert saved["scenes"][0]["background_color"] == "#123456"
    assert saved["updated_at"] != created["updated_at"]

    refetched = client.get(f"/motion/projects/{created['id']}").json()
    assert refetched["scenes"][0]["background_color"] == "#123456"


def test_put_ignores_mismatched_body_id(client):
    """PUT targets the URL's project id, not whatever id the body claims —
    a stale client must never be able to save under the wrong file."""
    url_id = client.post("/motion/projects", json={"name": "Real"}).json()["id"]
    body = client.get(f"/motion/projects/{url_id}").json()
    body["id"] = "spoofed"

    resp = client.put(f"/motion/projects/{url_id}", json=body).json()
    assert resp["id"] == url_id


def test_delete_then_get_is_not_found(client):
    created = client.post("/motion/projects", json={"name": "Temp"}).json()
    client.delete(f"/motion/projects/{created['id']}")

    resp = client.get(f"/motion/projects/{created['id']}")
    assert resp.status_code == 404


def test_get_unknown_project_is_not_found(client):
    resp = client.get("/motion/projects/does-not-exist")
    assert resp.status_code == 404


def test_export_unknown_project_returns_404(client):
    resp = client.post("/motion/projects/does-not-exist/export")
    assert resp.status_code == 404


def test_export_project_creates_task_and_polls_status(client, tmp_path, monkeypatch):
    import time
    from pathlib import Path
    from app.core.config import Paths

    exports_dir = tmp_path / "exports"
    monkeypatch.setattr(Paths, "exports", exports_dir)

    dummy_mp4 = exports_dir / "test_export.mp4"

    def mock_export_project(*args, **kwargs):
        exports_dir.mkdir(parents=True, exist_ok=True)
        dummy_mp4.write_bytes(b"dummy mp4 content")
        cb = kwargs.get("progress_callback")
        if cb:
            cb(0.5, "Rendering")
            cb(1.0, "Done")
        return dummy_mp4

    monkeypatch.setattr("app.motion_studio.export_service.export_project", mock_export_project)

    created = client.post("/motion/projects", json={"name": "Export Test Project"}).json()
    project_id = created["id"]

    resp = client.post(f"/motion/projects/{project_id}/export", json={"fps": 30, "width": 1920, "height": 1080})
    assert resp.status_code == 200
    data = resp.json()
    assert "task_id" in data
    task_id = data["task_id"]

    # Poll status until done or timeout
    for _ in range(20):
        status_resp = client.get(f"/motion/projects/export/{task_id}").json()
        if status_resp.get("done"):
            break
        time.sleep(0.1)

    status_resp = client.get(f"/motion/projects/export/{task_id}").json()
    assert status_resp["task_id"] == task_id
    assert status_resp["project_id"] == project_id
    assert status_resp["done"] is True
    assert status_resp["status"] == "done"
    assert status_resp["export_path"] == str(dummy_mp4)
    assert status_resp["download_path"] == f"/motion/exports/download/{dummy_mp4.name}"

    # Also check /motion/export/{task_id} alias
    alias_resp = client.get(f"/motion/export/{task_id}").json()
    assert alias_resp["task_id"] == task_id


def test_export_task_can_be_cancelled_mid_run(client, monkeypatch):
    import time
    from app.motion_studio import export_service

    def mock_export_project(*args, **kwargs):
        cancel_event = kwargs["cancel_event"]
        status_cb = kwargs.get("status_callback")
        if status_cb:
            status_cb("rendering")
        deadline = time.time() + 5
        while time.time() < deadline:
            if cancel_event.is_set():
                raise export_service.ExportCancelled("Motion export was cancelled.")
            time.sleep(0.01)
        raise AssertionError("cancel_event was not set")

    monkeypatch.setattr("app.motion_studio.export_service.export_project", mock_export_project)

    created = client.post("/motion/projects", json={"name": "Cancel Export"}).json()
    task_id = client.post(f"/motion/projects/{created['id']}/export", json={}).json()["task_id"]

    for _ in range(50):
        status = client.get(f"/motion/export/{task_id}").json()
        if status["status"] == "rendering":
            break
        time.sleep(0.02)

    cancelled = client.delete(f"/motion/exports/{task_id}")

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["done"] is True
    assert "_cancel_event" not in cancelled.json()

    for _ in range(50):
        status = client.get(f"/motion/export/{task_id}").json()
        if status["done"]:
            break
        time.sleep(0.02)
    assert status["status"] == "cancelled"


def test_export_status_unknown_task_returns_404(client):
    resp = client.get("/motion/export/unknown-task-id-12345")
    assert resp.status_code == 404


def test_download_export(client, tmp_path, monkeypatch):
    from app.core.config import Paths

    exports_dir = tmp_path / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(Paths, "exports", exports_dir)

    target_file = exports_dir / "sample.mp4"
    target_file.write_bytes(b"mp4 stream content")

    resp = client.get(f"/motion/exports/download/{target_file.name}")
    assert resp.status_code == 200
    assert resp.content == b"mp4 stream content"

    resp_404 = client.get("/motion/exports/download/nonexistent.mp4")
    assert resp_404.status_code == 404


def test_motion_asset_upload_returns_relative_url_and_serves_file(client):
    resp = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.mp4", b"fake video bytes", "video/mp4")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["source_url"].startswith("/motion/assets/")
    assert data["source_url"].endswith("/clip.mp4")
    assert not data["source_url"].startswith("http")
    assert data["size_bytes"] == len(b"fake video bytes")

    asset_resp = client.get(data["source_url"])
    assert asset_resp.status_code == 200
    assert asset_resp.content == b"fake video bytes"


def test_motion_asset_list_returns_uploaded_assets(client):
    upload = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.mp4", b"fake video bytes", "video/mp4")},
    ).json()

    resp = client.get("/motion/assets")

    assert resp.status_code == 200
    assets = resp.json()
    assert len(assets) == 1
    assert assets[0]["asset_id"] == upload["asset_id"]
    assert assets[0]["filename"] == "clip.mp4"
    assert assets[0]["source_url"] == upload["source_url"]
    assert assets[0]["content_type"] == "video/mp4"
    assert assets[0]["size_bytes"] == len(b"fake video bytes")
    assert assets[0]["created"]


def test_motion_asset_delete_removes_unused_asset(client):
    upload = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.mp4", b"fake video bytes", "video/mp4")},
    ).json()

    resp = client.delete(f"/motion/assets/{upload['asset_id']}")

    assert resp.status_code == 200
    assert resp.json() == {"deleted": True, "asset_id": upload["asset_id"]}
    assert client.get(upload["source_url"]).status_code == 404
    assert client.get("/motion/assets").json() == []


def test_motion_asset_delete_refuses_asset_used_by_project(client):
    upload = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.mp4", b"fake video bytes", "video/mp4")},
    ).json()
    project = client.post("/motion/projects", json={"name": "Uses Asset"}).json()
    scene = project["scenes"][0]
    scene["layers"].append({
        "id": "video-layer",
        "name": "Clip",
        "type": "video",
        "transform": {"x": 0, "y": 0, "width": 320, "height": 180, "rotation": 0, "opacity": 1},
        "video": {"source_url": upload["source_url"]},
    })
    save_resp = client.put(f"/motion/projects/{project['id']}", json=project)
    assert save_resp.status_code == 200

    resp = client.delete(f"/motion/assets/{upload['asset_id']}")

    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["code"] == "motion_asset_in_use"
    assert error["details"]["asset_id"] == upload["asset_id"]
    assert error["details"]["references"][0]["project_id"] == project["id"]
    assert error["details"]["references"][0]["kind"] == "layer"
    assert client.get(upload["source_url"]).status_code == 200


def test_motion_asset_upload_rejects_unknown_extension(client):
    resp = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.exe", b"not media", "application/octet-stream")},
    )

    assert resp.status_code == 400


def test_motion_asset_upload_rejects_mismatched_content_type(client):
    resp = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.mp4", b"fake video bytes", "image/png")},
    )

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_motion_asset"


def test_motion_asset_upload_rejects_file_over_size_cap(client, monkeypatch):
    class TinySettings:
        max_upload_size_mb = 0

    monkeypatch.setattr(motion_assets, "get_settings", lambda: TinySettings())

    resp = client.post(
        "/motion/assets/upload",
        files={"file": ("clip.mp4", b"x", "video/mp4")},
    )

    assert resp.status_code == 400
    assert "exceeds" in resp.json()["error"]["message"]


def test_motion_asset_upload_rejects_path_traversal_filename(client):
    resp = client.post(
        "/motion/assets/upload",
        files={"file": ("../clip.mp4", b"fake video bytes", "video/mp4")},
    )

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_motion_asset"


def test_motion_asset_get_rejects_path_traversal_filename(client):
    asset_id = "a" * 32
    resp = client.get(f"/motion/assets/{asset_id}/%2E%2E")

    assert resp.status_code in {400, 404}


def test_render_frames_single_navigation(client, tmp_path, monkeypatch):
    """Verify render_frames navigates once via page.goto and drives time forward with page.evaluate."""
    from unittest.mock import MagicMock
    from app.motion_studio import render_service, storage

    project = client.post("/motion/projects", json={"name": "Perf Test"}).json()

    mock_page = MagicMock()
    mock_browser = MagicMock()
    mock_context = MagicMock()
    mock_playwright = MagicMock()

    mock_playwright.chromium.launch.return_value = mock_browser
    mock_browser.new_context.return_value = mock_context
    mock_context.new_page.return_value = mock_page

    class MockSyncPlaywright:
        def __enter__(self):
            return mock_playwright
        def __exit__(self, *args):
            pass

    monkeypatch.setattr("playwright.sync_api.sync_playwright", MockSyncPlaywright)

    output_dir = tmp_path / "frames"
    frames = render_service.render_frames(
        project_id=project["id"],
        output_dir=output_dir,
        fps=30,
    )

    # page.goto should be called exactly ONCE (initial navigation at t=0)
    assert mock_page.goto.call_count == 1
    initial_url = mock_page.goto.call_args[0][0]
    assert f"/render/{project['id']}" in initial_url
    assert "t=0" in initial_url

    # page.evaluate should be called per frame to set window.__setRenderTime
    assert mock_page.evaluate.call_count >= 1
    assert "window.__setRenderTime" in mock_page.evaluate.call_args_list[0][0][0]

    # page.wait_for_selector should be called with data-render-ready and data-render-time
    selectors = [call.args[0] for call in mock_page.wait_for_selector.call_args_list]
    assert any('[data-render-ready="true"]' in s for s in selectors)
    assert any("[data-render-time=" in s for s in selectors)


def test_render_frames_transparent_and_4k(client, tmp_path, monkeypatch):
    """Verify render_frames supports transparent background URL param and 4K viewport dimensions."""
    from unittest.mock import MagicMock
    from app.motion_studio import render_service

    project = client.post("/motion/projects", json={"name": "4K Transparent Test"}).json()

    mock_page = MagicMock()
    mock_browser = MagicMock()
    mock_context = MagicMock()
    mock_playwright = MagicMock()

    mock_playwright.chromium.launch.return_value = mock_browser
    mock_browser.new_context.return_value = mock_context
    mock_context.new_page.return_value = mock_page

    class MockSyncPlaywright:
        def __enter__(self):
            return mock_playwright
        def __exit__(self, *args):
            pass

    monkeypatch.setattr("playwright.sync_api.sync_playwright", MockSyncPlaywright)

    output_dir = tmp_path / "frames_4k"
    render_service.render_frames(
        project_id=project["id"],
        output_dir=output_dir,
        fps=30,
        width=3840,
        height=2160,
        transparent=True,
    )

    # Check viewport is set to 3840x2160
    viewport_arg = mock_browser.new_context.call_args[1]["viewport"]
    assert viewport_arg == {"width": 3840, "height": 2160}

    # Check transparent=true URL param is present
    initial_url = mock_page.goto.call_args[0][0]
    assert "transparent=true" in initial_url

    # Check screenshot is called with omit_background=True
    screenshot_kwargs = mock_page.screenshot.call_args[1]
    assert screenshot_kwargs.get("omit_background") is True


def test_export_service_gif_and_png_sequence_zip(client, tmp_path, monkeypatch):
    """Test export_service with GIF and PNG sequence ZIP output formats."""
    import zipfile
    from unittest.mock import MagicMock
    from app.core.config import Paths
    from app.motion_studio import export_service

    exports_dir = tmp_path / "exports"
    monkeypatch.setattr(Paths, "exports", exports_dir)

    project = client.post("/motion/projects", json={"name": "Format Test"}).json()

    # Mock render_frames to create dummy frame PNGs
    def mock_render_frames(project_id, output_dir, **kwargs):
        output_dir.mkdir(parents=True, exist_ok=True)
        fps = kwargs.get("fps", 30)
        start_index = kwargs.get("start_index", 0)
        suffix = "jpg" if kwargs.get("output_format") == "jpeg" else "png"
        total = 5 * fps
        frames = []
        for i in range(total):
            frame = output_dir / f"frame_{start_index + i:06d}.{suffix}"
            frame.write_bytes(b"\x89PNG fake png data")
            frames.append(frame)
        return frames

    monkeypatch.setattr("app.motion_studio.render_service.render_frames", mock_render_frames)

    # 1. Test PNG sequence zip export
    zip_path = export_service.export_project(
        project_id=project["id"],
        format="png_sequence",
        transparent=True,
    )
    assert zip_path.suffix == ".zip"
    assert zip_path.exists()
    with zipfile.ZipFile(zip_path, "r") as zf:
        assert "frame_000000.png" in zf.namelist()

    # 2. Test GIF export with mock ffmpeg runner
    def mock_ffmpeg_run(cmd, **kwargs):
        from pathlib import Path
        gif_file = Path(cmd[-1])
        gif_file.parent.mkdir(parents=True, exist_ok=True)
        gif_file.write_bytes(b"GIF89a fake gif data")
        return MagicMock(returncode=0)

    monkeypatch.setattr("app.motion_studio.export_service._run_cancellable", mock_ffmpeg_run)
    monkeypatch.setattr("app.motion_studio.export_service.resolve_ffmpeg_binaries", lambda: ("ffmpeg", "ffprobe"))

    gif_path = export_service.export_project(
        project_id=project["id"],
        format="gif",
    )
    assert gif_path.suffix == ".gif"
    assert gif_path.exists()


def test_export_service_invalid_format_raises_error(client):
    from app.core.errors import AppError
    from app.motion_studio import export_service

    with pytest.raises(AppError) as exc_info:
        export_service.export_project(
            project_id="any-id",
            format="unsupported_format",
        )
    assert "Unsupported export format" in str(exc_info.value)
