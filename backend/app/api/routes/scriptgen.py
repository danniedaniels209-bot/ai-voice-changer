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


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    content: str = Field(min_length=1, max_length=20000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class ModelSelectRequest(BaseModel):
    model: str


_CHAT_SYSTEM = (
    "You are a helpful creative assistant inside a video voice-changer app. "
    "You help users write, rewrite, and brainstorm narration scripts, titles, "
    "descriptions, and other video content. Be concise and practical."
)


@router.get("/status")
def status() -> dict:
    ok, reason = llm.availability()
    return {
        "available": ok,
        "reason": reason,
        "model": llm.MODELS[llm.active_model()]["id"],
        "active_model": llm.active_model(),
        "models": [
            {"key": key, "label": info["label"], "download": info["download"]}
            for key, info in llm.MODELS.items()
        ],
        "actions": list(generator.ACTIONS.keys()),
    }


@router.post("/model")
def select_model(request: ModelSelectRequest) -> dict:
    llm.set_model(request.model)
    return {"active_model": llm.active_model()}


@router.post("/chat")
def chat(request: ChatRequest) -> dict:
    messages = [{"role": "system", "content": _CHAT_SYSTEM}]
    messages += [m.model_dump() for m in request.messages]
    return {"reply": llm.chat(messages, max_new_tokens=1500)}


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
