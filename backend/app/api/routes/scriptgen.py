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


def _chat_system() -> str:
    from app.scriptgen import tools

    return (
        "You are a helpful creative assistant inside a video voice-changer app. "
        "You help users write, rewrite, and brainstorm narration scripts, titles, "
        "descriptions, and other video content. Be concise and practical.\n\n"
        "You can use these tools to work with the user's conversions:\n"
        f"{tools.TOOL_SPECS}\n\n"
        "To use a tool, reply with ONLY this (no other text):\n"
        '<tool_call>{"tool": "tool_name", "args": {"arg": "value"}}</tool_call>\n'
        "The result comes back in the next message; then answer the user "
        "normally in plain text. Only call a tool when the user's request "
        "needs their actual content — otherwise just answer."
    )


@router.get("/status")
def status() -> dict:
    ok, reason = llm.availability()
    return {"available": ok, "reason": reason, "model": llm.MODEL_ID,
            "actions": list(generator.ACTIONS.keys())}


@router.post("/chat")
def chat(request: ChatRequest) -> dict:
    from app.scriptgen import tools

    messages = [{"role": "system", "content": _chat_system()}]
    messages += [m.model_dump() for m in request.messages]

    tool_trace: list[dict] = []
    reply = ""
    for _ in range(tools.MAX_TOOL_ROUNDS + 1):
        reply = llm.chat(messages, max_new_tokens=1500)
        call = tools.parse_tool_call(reply)
        if call is None or len(tool_trace) >= tools.MAX_TOOL_ROUNDS:
            break
        name, args = call
        result = tools.execute(name, args)
        tool_trace.append({"tool": name, "args": args, "ok": not result.startswith("Error:")})
        messages.append({"role": "assistant", "content": reply})
        messages.append({
            "role": "user",
            "content": f"<tool_result>\n{result}\n</tool_result>\n"
                       "Now answer the user's request in plain text "
                       "(or call another tool if needed).",
        })

    return {"reply": tools.strip_tool_call(reply) or reply, "tool_calls": tool_trace}


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
