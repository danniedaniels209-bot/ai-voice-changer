"""
WebSocket /ws/jobs/{job_id} — pushes job state (stage, progress, log) to the
Processing page as it changes. Implemented as server-side polling of the
in-memory job registry (no pub/sub broker, per the "no database/no extra
infra" constraints) rather than true event-driven push — simple and correct
at this app's scale (one user, a handful of concurrent jobs at most).
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.errors import JobNotFoundError
from app.core.logging import get_logger
from app.schemas.job import JobStatus
from app.utils import job_manager

logger = get_logger(__name__)
router = APIRouter(tags=["websocket"])

_POLL_INTERVAL_SECONDS = 0.5
_TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


@router.websocket("/ws/jobs/{job_id}")
async def job_progress_ws(websocket: WebSocket, job_id: str) -> None:
    # HTTP middleware doesn't cover WebSockets — enforce the same access
    # token here (query param or cookie) when one is configured.
    from app.core.config import get_settings

    token = get_settings().auth_token
    if token:
        supplied = websocket.query_params.get("token") or websocket.cookies.get("avc_token")
        if supplied != token:
            await websocket.close(code=4401)
            return

    await websocket.accept()

    try:
        job_manager.get_job(job_id)
    except JobNotFoundError:
        await websocket.send_json({"error": {"code": "job_not_found", "message": f"No job '{job_id}'"}})
        await websocket.close()
        return

    last_sent_at: str | None = None
    try:
        while True:
            job = job_manager.get_job(job_id)
            if job.updated_at != last_sent_at:
                await websocket.send_json(job.to_public_dict())
                last_sent_at = job.updated_at

            if job.status in _TERMINAL_STATUSES:
                break

            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        logger.debug("Client disconnected from job %s progress stream", job_id)
    except JobNotFoundError:
        pass
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass  # already closed
