"""
FastAPI application entry point.

Run with:  uvicorn app.main:app --reload --port 8000   (from the backend/ dir)
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import ws
from app.api.routes import (
    convert, health, jobs, models, motion, motion_assets, motion_transcribe, narration, scriptgen, subtitles, upload, voices,
)
from app.api.routes import settings as settings_routes
from app.core.config import Paths, get_settings
from app.core.errors import AppError
from app.core.hardware import get_hardware_info
from app.core.logging import get_logger, setup_logging

setup_logging()
logger = get_logger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description="Local-only backend for AI video voice conversion.",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if settings.auth_token:
        # Personal-use access gate for cloud/tunnel deployments: every HTTP
        # request must carry the token (header set by the frontend, or a
        # one-time ?token= in the URL). Without AVC_AUTH_TOKEN set, local
        # behavior is completely unchanged.
        @app.middleware("http")
        async def _auth_gate(request: Request, call_next):
            supplied = (
                request.headers.get("x-avc-token")
                or request.query_params.get("token")
                or request.cookies.get("avc_token")
            )
            if supplied != settings.auth_token:
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": {
                            "code": "unauthorized",
                            "message": "Missing or wrong access token. Open the app with "
                            "?token=<your token> once (a cookie keeps you signed in).",
                            "details": {},
                        }
                    },
                )
            response = await call_next(request)
            # A correct ?token= visit sets a cookie so page assets and later
            # requests authenticate automatically.
            if request.query_params.get("token") == settings.auth_token:
                response.set_cookie("avc_token", settings.auth_token, httponly=False, max_age=30 * 86400)
            return response

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        logger.error("%s: %s (%s)", exc.code, exc.message, exc.details)
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

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        # Last-resort catch-all: an unexpected exception must still return a
        # clean JSON error, never a raw 500 stack trace or a crashed process.
        logger.exception("Unhandled exception while processing %s %s", request.method, request.url)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred. See backend logs for details.",
                    "details": {},
                }
            },
        )

    @app.on_event("startup")
    def on_startup() -> None:
        from app.utils.cleanup import prune_stale_temp_dirs, start_upload_sweeper

        Paths.ensure_all()
        prune_stale_temp_dirs()
        start_upload_sweeper()
        hardware = get_hardware_info(settings.default_device_mode)
        ffmpeg_path = settings.resolve_ffmpeg_path()

        logger.info("=== %s starting ===", settings.app_name)
        logger.info("Project root: %s", Paths.root)
        logger.info(
            "Device: %s (CUDA available: %s%s)",
            hardware.resolved_device,
            hardware.cuda_available,
            f", {hardware.device_name}" if hardware.device_name else "",
        )
        if ffmpeg_path:
            logger.info("FFmpeg found at: %s", ffmpeg_path)
        else:
            logger.warning(
                "FFmpeg was NOT found (checked ffmpeg/ folder and system PATH). "
                "Video/audio processing will fail until it is configured in Settings."
            )

    app.include_router(health.router)
    app.include_router(settings_routes.router)
    app.include_router(models.router)
    app.include_router(voices.router)
    app.include_router(narration.router)
    app.include_router(scriptgen.router)
    app.include_router(subtitles.router)
    app.include_router(motion.router)
    app.include_router(motion_assets.router)
    app.include_router(motion_transcribe.router)
    app.include_router(upload.router)
    app.include_router(jobs.router)
    app.include_router(convert.router)
    app.include_router(ws.router)

    # Single-server mode: when the frontend has been built (npm run build),
    # serve it directly — one process, one port, one URL. API routes above
    # take precedence (registered first — Starlette matches in registration
    # order); everything else falls through to here.
    #
    # StaticFiles(html=True) alone only serves index.html for a path that
    # IS a directory on disk — it does NOT fall back to index.html for a
    # client-side route like /settings or /motion/<id> that has no matching
    # file, so direct navigation (typing the URL, refreshing, or a
    # non-browser client like Playwright's page.goto) 404s even though
    # clicking there from within the app works fine (React Router handles
    # it client-side once index.html has already loaded). Serving assets
    # from their own mount and explicitly falling back to index.html for
    # everything else fixes that.
    frontend_dist = Paths.frontend / "dist"
    if frontend_dist.exists():
        from fastapi.responses import FileResponse
        from fastapi.staticfiles import StaticFiles

        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

        index_file = frontend_dist / "index.html"

        # include_in_schema=False: this catch-all matches every path, so it
        # would otherwise appear in the API docs as a route that serves
        # everything, which is noise. response_model=None because this module
        # uses `from __future__ import annotations` — the `-> FileResponse`
        # annotation reaches FastAPI as a string it then tries to build a
        # response schema from, which 500s /openapi.json and takes /docs with
        # it. The annotation stays for readers; FastAPI just ignores it.
        @app.get("/{full_path:path}", response_model=None, include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            candidate = frontend_dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(str(candidate))
            return FileResponse(str(index_file))

        logger.info("Serving frontend from %s", frontend_dist)

    return app


app = create_app()
