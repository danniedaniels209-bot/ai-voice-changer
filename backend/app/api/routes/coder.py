"""
Coder workspace API — upload files/folders, browse them, and let the AI
read, write, and run them in an isolated sandbox (see scriptgen/workspace).

Separate from /scriptgen/chat: that assistant runs the video pipeline and
can only READ the app's source. This one can write and execute, but only
inside temp/coder_workspace — it has no path to the application's own code.
"""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.core.errors import AppError
from app.scriptgen import llm, workspace

router = APIRouter(prefix="/coder", tags=["coder"])

MAX_TOOL_ROUNDS = 12  # coding needs more steps than a normal chat turn


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=40000)


class CoderChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=500)


class WriteRequest(BaseModel):
    path: str
    content: str


def _system_prompt() -> str:
    files = workspace.list_files()
    listing = "\n".join(files[:200]) if files else "(empty)"
    return (
        "You are a coding assistant working inside an isolated workspace. "
        "The user uploads files and asks you to build, fix, refactor, explain "
        "or test them.\n\n"
        "Tools available to you:\n"
        f"{workspace.TOOL_SPECS}\n\n"
        "To use a tool, reply with ONLY this (no other text):\n"
        '<tool_call>{"tool": "tool_name", "args": {"arg": "value"}}</tool_call>\n'
        "The result comes back in the next message. Work step by step: read "
        "before you edit, write complete files, and run the code to verify it "
        "when you can. When you are done, explain briefly what you changed.\n\n"
        "You can only touch this workspace — you cannot see or modify the "
        "host application's own source.\n\n"
        f"Files currently in the workspace:\n{listing}"
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
            {"key": k, "label": v["label"], "download": v["download"]}
            for k, v in llm.MODELS.items()
        ],
        "files": workspace.list_files(),
    }


@router.post("/upload")
async def upload(files: list[UploadFile] = File(...)) -> dict:
    """Accept files (or a whole folder — the browser sends relative paths as
    each part's filename) into the workspace."""
    saved: list[str] = []
    for item in files:
        if not item.filename:
            continue
        target = workspace.resolve(item.filename)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("wb") as out:
            while chunk := await item.read(1024 * 1024):
                out.write(chunk)
        await item.close()
        saved.append(item.filename)
    if not saved:
        raise AppError("No files were uploaded.")
    return {"saved": saved, "files": workspace.list_files()}


@router.get("/files")
def files() -> dict:
    return {"files": workspace.list_files()}


@router.get("/file", response_class=PlainTextResponse)
def read_file(path: str) -> str:
    try:
        return workspace.read_file(path)
    except ValueError as exc:
        raise AppError(str(exc)) from exc


@router.post("/file")
def write_file(request: WriteRequest) -> dict:
    try:
        message = workspace.write_file(request.path, request.content)
    except ValueError as exc:
        raise AppError(str(exc)) from exc
    return {"message": message, "files": workspace.list_files()}


@router.delete("/file")
def delete_file(path: str) -> dict:
    try:
        message = workspace.delete_file(path)
    except ValueError as exc:
        raise AppError(str(exc)) from exc
    return {"message": message, "files": workspace.list_files()}


@router.get("/download")
def download(path: str) -> FileResponse:
    try:
        target = workspace.resolve(path, must_exist=True)
    except ValueError as exc:
        raise AppError(str(exc)) from exc
    return FileResponse(str(target), filename=target.name)


@router.delete("/workspace")
def clear() -> dict:
    workspace.clear_workspace()
    return {"files": []}


@router.post("/chat")
def chat(request: CoderChatRequest) -> dict:
    from app.scriptgen import tools as chat_tools

    messages = [{"role": "system", "content": _system_prompt()}]
    messages += [m.model_dump() for m in request.messages]

    trace: list[dict] = []
    reply = ""
    for _ in range(MAX_TOOL_ROUNDS + 1):
        reply = llm.chat(messages, max_new_tokens=4096)
        call = chat_tools.parse_tool_call(reply)
        # parse_tool_call only knows the video-chat registry; re-parse against
        # the workspace registry so coder tools are recognised too.
        if call is None:
            call = _parse_workspace_call(reply)
        if call is None or len(trace) >= MAX_TOOL_ROUNDS:
            break
        name, args = call
        result = workspace.execute(name, args)
        trace.append(
            {"tool": name, "args": {k: v for k, v in args.items() if k != "content"},
             "ok": not result.startswith("Error:")}
        )
        messages.append({"role": "assistant", "content": reply})
        messages.append({
            "role": "user",
            "content": f"<tool_result>\n{result}\n</tool_result>\n"
                       "Continue, or reply in plain text if you are done.",
        })

    final = chat_tools.strip_tool_call(reply) or reply.strip()
    if not final:
        final = "(The model returned an empty reply — try again or switch models.)"
    return {"reply": final, "tool_calls": trace, "files": workspace.list_files()}


def _parse_workspace_call(reply: str):
    """Same <tool_call> protocol, matched against the workspace registry."""
    import json
    import re

    m = re.search(r"<tool_call>\s*(\{.*?\})\s*(?:</tool_call>|$)", reply, re.DOTALL)
    if not m:
        return None
    try:
        payload = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    name = payload.get("tool") or payload.get("name")
    if name not in workspace.TOOLS:
        return None
    args = payload.get("args") or payload.get("arguments") or {}
    return name, args if isinstance(args, dict) else {}
