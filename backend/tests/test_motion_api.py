import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.routes import motion
from app.core.errors import AppError


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "motion_projects", tmp_path / "motion_projects")
    app = FastAPI()
    app.include_router(motion.router)

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
        f1 = output_dir / "frame_000000.png"
        f1.write_bytes(b"\x89PNG fake png data")
        return [f1]

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

    # 2. Test GIF export with mock ffmpeg _run
    def mock_ffmpeg_run(cmd, **kwargs):
        from pathlib import Path
        gif_file = Path(cmd[-1])
        gif_file.parent.mkdir(parents=True, exist_ok=True)
        gif_file.write_bytes(b"GIF89a fake gif data")
        return MagicMock(returncode=0)

    monkeypatch.setattr("app.motion_studio.export_service._run", mock_ffmpeg_run)
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



