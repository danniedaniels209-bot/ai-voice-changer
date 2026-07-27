"""
Frame rendering service for Motion Studio projects.

Uses Playwright in a headless Chromium browser to navigate to the frontend's
/render/:projectId route ONCE, then drives time forward via window.__setRenderTime(ms)
and screenshots each frame to PNG files. Supports transparent background rendering and 4K resolutions.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Callable

from app.core.config import Paths, get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.motion_studio import storage

logger = get_logger(__name__)


def render_frames(
    project_id: str,
    scene_id: str | None = None,
    output_dir: Path | None = None,
    fps: int = 30,
    width: int = 1920,
    height: int = 1080,
    transparent: bool = False,
    base_url: str | None = None,
    progress_callback: Callable[[float], None] | None = None,
) -> list[Path]:
    """
    Loads a MotionStudio project, navigates headless Playwright browser to the
    /render/:projectId route ONCE, drives time forward via window.__setRenderTime(ms),
    screenshots each frame to PNG files, and returns the list of generated PNG paths.
    """
    project = storage.load_project(project_id)
    scene = None
    if scene_id:
        scene = next((s for s in project.scenes if s.id == scene_id), None)
    if scene is None:
        if not project.scenes:
            raise AppError(f"Project '{project_id}' contains no scenes.")
        scene = project.scenes[0]

    duration_ms = max(1, scene.duration_ms)
    total_frames = max(1, int((duration_ms / 1000.0) * fps))

    if output_dir is None:
        output_dir = Paths.temp / f"motion_render_{project_id}_{uuid.uuid4().hex[:8]}"
    output_dir.mkdir(parents=True, exist_ok=True)

    if not base_url:
        settings = get_settings()
        base_url = (
            os.environ.get("AVC_FRONTEND_URL")
            or os.environ.get("AVC_FRONTEND_ORIGIN")
            or f"http://{settings.host}:{settings.port}"
        )
    base_url = base_url.rstrip("/")

    logger.info(
        "Rendering project '%s' scene '%s' (%d frames at %d fps, %dx%d, transparent=%s) via %s",
        project_id,
        scene.id,
        total_frames,
        fps,
        width,
        height,
        transparent,
        base_url,
    )

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise AppError(
            "Playwright is not installed in the Python environment. "
            "Please run: pip install playwright && playwright install chromium"
        ) from exc

    frame_paths: list[Path] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()

            # Load page ONCE at t=0
            initial_url = f"{base_url}/render/{project_id}?scene={scene.id}&t=0"
            if transparent:
                initial_url += "&transparent=true"
            page.goto(initial_url)
            page.wait_for_selector('[data-render-ready="true"]', timeout=10000)

            for i in range(total_frames):
                t_ms = int(round((i * 1000.0) / fps))
                page.evaluate("(ms) => { if (window.__setRenderTime) { window.__setRenderTime(ms); } }", t_ms)
                page.wait_for_selector(f'[data-render-time="{t_ms}"]', timeout=10000)

                frame_path = output_dir / f"frame_{i:06d}.png"
                page.screenshot(path=str(frame_path), full_page=True, omit_background=transparent)
                frame_paths.append(frame_path)

                if progress_callback:
                    progress_callback((i + 1) / total_frames)

            browser.close()
    except AppError:
        raise
    except Exception as exc:
        logger.exception("Playwright frame rendering failed for project %s", project_id)
        raise AppError(f"Playwright rendering failed: {exc}") from exc

    return frame_paths
