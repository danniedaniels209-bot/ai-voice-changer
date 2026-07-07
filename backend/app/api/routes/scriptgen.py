"""
AI Script Studio API — topic -> outline -> script -> assistant actions.
GPU-gated: /scriptgen/status tells the UI whether generation is available
on this machine (cloud sessions: yes; a CPU laptop: no, with the reason).
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.scriptgen import generator, llm

router = APIRouter(prefix="/scriptgen", tags=["scriptgen"])


class GenSettings(BaseModel):
    content_type: str = "YouTube"
    audience: str = "general audience"
    length: str = "3m"
    tone: str = "professional"


class OutlineRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=300)
    settings: GenSettings = Field(default_factory=GenSettings)


class ScriptRequest(BaseModel):
    topic: str
    outline: list[str] = Field(min_length=1, max_length=12)
    settings: GenSettings = Field(default_factory=GenSettings)


class AssistRequest(BaseModel):
    action: str
    text: str = Field(min_length=1, max_length=20000)
    tone: str | None = None
    settings: GenSettings = Field(default_factory=GenSettings)


@router.get("/status")
def status() -> dict:
    ok, reason = llm.availability()
    return {"available": ok, "reason": reason, "model": llm.MODEL_ID,
            "actions": list(generator.ACTIONS.keys())}


@router.post("/outline")
def outline(request: OutlineRequest) -> dict:
    return {"outline": generator.outline(request.topic, request.settings.model_dump())}


@router.post("/script")
def script(request: ScriptRequest) -> dict:
    return {
        "script": generator.script(
            request.topic, request.outline, request.settings.model_dump()
        )
    }


@router.post("/assist")
def assist(request: AssistRequest) -> dict:
    return {
        "result": generator.assist(
            request.action, request.text, request.settings.model_dump(), request.tone
        )
    }
