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

MAX_TOOL_ROUNDS = 24  # building a whole app takes many steps


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=40000)


class CoderChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=500)


class WriteRequest(BaseModel):
    path: str
    content: str


def _system_prompt() -> str:
    import shutil as _shutil

    files = workspace.list_files()
    listing = "\n".join(files[:200]) if files else "(empty)"
    runtimes = ["Python " + ".".join(map(str, __import__("sys").version_info[:3]))]
    if _shutil.which("node"):
        runtimes.append("Node.js")
    if _shutil.which("git"):
        runtimes.append("git")

    return (
        "You are a software engineer with a real terminal, working in an "
        "isolated project workspace. You can build complete applications "
        "from scratch: create folders and files, install dependencies, run "
        "builds and tests, and iterate until the code actually works.\n\n"
        "Tools available to you:\n"
        f"{workspace.TOOL_SPECS}\n\n"
        "To use a tool, reply with ONLY this (no other text):\n"
        '<tool_call>{"tool": "tool_name", "args": {"arg": "value"}}</tool_call>\n'
        "The result comes back in the next message, then you continue.\n\n"
        "How to work:\n"
        "- When asked to build an app, create a sensible project folder and "
        "scaffold the whole thing — source files, config, README, and a way "
        "to run it. Don't just describe it; write the files.\n"
        "- Read a file before editing it, and always write the COMPLETE new "
        "content.\n"
        "- If something is missing (a package, a tool), install it with "
        "run_command — e.g. 'pip install flask' or 'npm install'.\n"
        "- Actually RUN what you build to prove it works, and fix what "
        "breaks. Read the error, then correct it.\n"
        "- When you're finished, summarise what you built, list the key "
        "files, and say how to run it. The user can download everything as a "
        "zip.\n\n"
        f"Available in this environment: {', '.join(runtimes)}.\n"
        "You can only touch this workspace — never the host application's "
        "own source.\n\n"
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


@router.get("/download-all")
def download_all() -> FileResponse:
    """Everything the assistant built, as a single zip."""
    if not workspace.list_files():
        raise AppError("The workspace is empty — nothing to download yet.")
    archive = workspace.zip_workspace()
    return FileResponse(
        str(archive), media_type="application/zip", filename="workspace.zip"
    )


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
