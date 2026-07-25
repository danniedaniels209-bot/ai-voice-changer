"""
Coder workspace API — upload files/folders, browse them, and let the AI
read, write, and run them in an isolated sandbox (see scriptgen/workspace).

Separate from /scriptgen/chat: that assistant runs the video pipeline and
can only READ the app's source. This one can write and execute, but only
inside temp/coder_workspace — it has no path to the application's own code.
"""

from __future__ import annotations

import os
import threading
import uuid

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.core.errors import AppError, CudaUnavailableError, JobNotFoundError
from app.core.logging import get_logger
from app.scriptgen import llm, workspace

logger = get_logger(__name__)
router = APIRouter(prefix="/coder", tags=["coder"])

# A build can legitimately take dozens of steps. This is only a runaway-loop
# backstop, set far above any real task, and overridable.
MAX_TOOL_ROUNDS = int(os.environ.get("AVC_CODER_MAX_ROUNDS", 200))
MAX_REPLY_TOKENS = int(os.environ.get("AVC_CODER_MAX_TOKENS", 16384))
# Loop guard: identical action repeated this many times = no progress.
LOOP_REPEAT_LIMIT = int(os.environ.get("AVC_CODER_LOOP_LIMIT", 3))
# Runtime completion check: ask the model whether it's actually finished
# every N tool calls, rather than trusting it to remember to stop.
COMPLETION_CHECK_EVERY = int(os.environ.get("AVC_CODER_COMPLETION_CHECK", 5))

_STATUS_QUESTION = (
    "Pause. Answer in exactly this format and nothing else:\n"
    "STATUS: continue|completed|blocked\n"
    "SUMMARY: <one paragraph — if completed, what you built and how to run "
    "it; if blocked, what is stopping you; if continue, what is still left>"
)

# Background runs, keyed by task id: the agent works for as long as it needs
# while the browser polls — no HTTP request (or tunnel) can time it out.
_tasks: dict[str, dict] = {}
_tasks_lock = threading.Lock()


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1)


class CoderChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)


class WriteRequest(BaseModel):
    path: str
    content: str


def _system_prompt(task_context: str = "") -> str:
    import shutil as _shutil

    files = workspace.list_files()
    listing = "\n".join(files[:200]) if files else "(empty)"
    runtimes = ["Python " + ".".join(map(str, __import__("sys").version_info[:3]))]
    if _shutil.which("node"):
        runtimes.append("Node.js")
    if _shutil.which("git"):
        runtimes.append("git")

    from app.scriptgen import engineering_protocol

    protocol_text, protocol_headings = engineering_protocol.build_prompt(task_context, files)
    logger.info("Coder system prompt: %d protocol section(s) — %s",
                len(protocol_headings), ", ".join(protocol_headings))

    return (
        f"{protocol_text}\n\n"
        "You are working in an isolated project workspace with a real "
        "terminal. You can build complete applications from scratch: create "
        "folders and files, install dependencies, run builds and tests, and "
        "iterate until the code actually works.\n\n"
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
        "zip.\n"
        "- STOP WHEN DONE. After each tool result ask yourself: is the "
        "request fulfilled, are the files written, is another call actually "
        "needed? If not, stop calling tools and write your final answer. "
        "Never rewrite an identical file, re-read a file you already have, "
        "recreate an existing folder, or re-run a command that already "
        "succeeded — repeating an action without new information is a failed "
        "reasoning loop, not progress. The best run is the shortest one that "
        "correctly finishes the job.\n"
        "- If you are blocked (missing information, permission, or an error "
        "you cannot fix), stop calling tools and say exactly what is "
        "blocking you.\n"
        "- If the user comes back reporting a problem ('it crashes', 'the "
        "button does nothing', or a pasted error), treat it as a bug report "
        "on the project that is already in this workspace: read the relevant "
        "files, reproduce it with run_command/run_file where you can, fix the "
        "cause, re-run to confirm, and tell them what was wrong and what you "
        "changed. Keep iterating until they're happy — the workspace persists "
        "between messages, so never start over unless asked.\n\n"
        f"Available in this environment: {', '.join(runtimes)}.\n"
        "You can only touch this workspace — never the host application's "
        "own source, and never its own system prompt (this document). "
        "Commands that try will be refused.\n\n"
        f"Files currently in the workspace:\n{listing}"
    )


@router.get("/status")
def status() -> dict:
    from app.api.routes.scriptgen import _model_list

    ok, reason = llm.availability()
    return {
        "available": ok,
        "reason": reason,
        "model": llm.MODELS[llm.active_model()]["id"],
        "active_model": llm.active_model(),
        "models": _model_list(),
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


def _describe_step(name: str, args: dict) -> str:
    """One human-readable line per action, for the live activity feed."""
    path = str(args.get("path", ""))
    if name == "write_file":
        lines = str(args.get("content", "")).count("\n") + 1
        return f"Writing {path} ({lines} lines)"
    if name == "read_file":
        return f"Reading {path}"
    if name == "create_folder":
        return f"Creating folder {path}"
    if name == "delete_file":
        return f"Deleting {path}"
    if name == "run_command":
        return f"$ {args.get('command', '')}"
    if name == "run_file":
        return f"Running {path}"
    if name == "list_files":
        return "Listing the workspace"
    return name


def _signature(name: str, args: dict) -> str:
    """Identity of an action, for spotting repeats. Content is hashed rather
    than compared in full so a big file rewrite is still cheap to detect."""
    import hashlib
    import json as _json

    payload = _json.dumps(args, sort_keys=True, default=str)[:4000]
    return f"{name}:{hashlib.sha1(payload.encode()).hexdigest()[:12]}"


def _parse_status(raw: str) -> tuple[str, str]:
    """Read the model's STATUS/SUMMARY answer. Anything unparseable means
    'keep going' — a malformed check must never end a healthy run."""
    import re

    status = "continue"
    m = re.search(r"STATUS:\s*(continue|completed|blocked)", raw, re.IGNORECASE)
    if m:
        status = m.group(1).lower()
    summary = ""
    m2 = re.search(r"SUMMARY:\s*(.+)", raw, re.IGNORECASE | re.DOTALL)
    if m2:
        summary = m2.group(1).strip()
    return status, summary


def _ask_status(messages: list[dict]) -> tuple[str, str]:
    """Ask the model, out of band, whether the job is actually finished.
    The question is not added to the conversation, so it can't derail the
    run; a failure here is treated as 'continue'."""
    try:
        raw = llm.chat(
            messages + [{"role": "user", "content": _STATUS_QUESTION}],
            max_new_tokens=800,
        )
        return _parse_status(raw)
    except Exception as exc:  # noqa: BLE001 — never fail a run on the check
        logger.warning("Completion check failed: %s", exc)
        return "continue", ""


def _run_agent(task_id: str, history: list[dict]) -> None:
    """The agent loop, run on a worker thread so it can take as long as the
    job actually needs. Progress is published into _tasks for polling."""
    from app.scriptgen import context_manager, tools as chat_tools

    latest_user_msg = next(
        (m["content"] for m in reversed(history) if m.get("role") == "user"), ""
    )
    messages = [{"role": "system", "content": _system_prompt(latest_user_msg)}] + history
    trace: list[dict] = []
    reply = ""
    signatures: list[str] = []

    def publish(**fields) -> None:
        with _tasks_lock:
            _tasks[task_id].update(fields)

    def cancelled() -> bool:
        with _tasks_lock:
            return bool(_tasks.get(task_id, {}).get("cancel"))

    # First reply after switching models can take minutes (multi-GB
    # download) — without this, that looks exactly like a hang.
    llm.set_status_hook(lambda msg: publish(status=msg))
    # Live token streaming: the reply grows in the task state as the model
    # writes it, instead of only appearing once the whole thing is done.
    llm.set_stream_hook(lambda text: publish(partial_reply=text))

    def finish_stopped() -> None:
        publish(
            status="stopped", done=True, partial_reply="",
            reply=(
                "Stopped. The files written so far are in the workspace — tell "
                "me what to do next."
            ),
            tool_calls=list(trace), files=workspace.list_files(),
        )

    try:
        for _ in range(MAX_TOOL_ROUNDS + 1):
            if cancelled():
                finish_stopped()
                return
            # A long build appends a tool-call + tool-result pair every
            # round — left unchecked, the prompt grows every iteration until
            # it exhausts VRAM on its own. Compact before every generation.
            messages = context_manager.compact_if_needed(messages)
            publish(status="thinking", partial_reply="")
            reply = llm.chat(messages, max_new_tokens=MAX_REPLY_TOKENS)
            if cancelled():
                finish_stopped()
                return
            call = chat_tools.parse_tool_call(reply) or _parse_workspace_call(reply)
            if call is None or len(trace) >= MAX_TOOL_ROUNDS:
                break

            name, args = call
            # Publish the step BEFORE running it, so the UI shows what the
            # agent is doing right now (not only once it has finished).
            step = {
                "tool": name,
                "target": str(args.get("path") or args.get("command") or ""),
                "args": {k: v for k, v in args.items() if k != "content"},
                "note": _describe_step(name, args),
                "running": True,
                "ok": None,
                "output": "",
            }
            trace.append(step)
            publish(status=f"running {name}", tool_calls=list(trace))

            result = workspace.execute(name, args)
            step.update(
                running=False,
                ok=not result.startswith("Error:"),
                # Enough to follow along without flooding the browser.
                output=result[:4000],
            )
            publish(tool_calls=list(trace), files=workspace.list_files())

            messages.append({"role": "assistant", "content": reply})
            messages.append({
                "role": "user",
                "content": f"<tool_result>\n{result}\n</tool_result>\n"
                           "Continue, or reply in plain text if you are done.",
            })

            # --- Loop guard: the same action, over and over, is not progress.
            signatures.append(_signature(name, args))
            recent = signatures[-LOOP_REPEAT_LIMIT:]
            if len(recent) == LOOP_REPEAT_LIMIT and len(set(recent)) == 1:
                logger.warning("Coder loop detected on %s — pausing", name)
                status, summary = _ask_status(messages)
                publish(
                    status="needs_input", done=True,
                    reply=(
                        f"I repeated the same action ({name}) "
                        f"{LOOP_REPEAT_LIMIT} times without making progress, "
                        "so I paused rather than spinning.\n\n"
                        f"{summary or 'Nothing new was accomplished by the repeats.'}\n\n"
                        "Your files are safe in the workspace. Tell me to "
                        "continue, or point me at what to do differently."
                    ),
                    tool_calls=list(trace), files=workspace.list_files(),
                )
                return

            # --- Completion check: verify with the model that work remains,
            # instead of trusting it to remember to stop on its own.
            if COMPLETION_CHECK_EVERY and len(trace) % COMPLETION_CHECK_EVERY == 0:
                status, summary = _ask_status(messages)
                if status in ("completed", "blocked") and summary:
                    publish(
                        status="done" if status == "completed" else "blocked",
                        done=True, reply=summary, partial_reply="",
                        tool_calls=list(trace), files=workspace.list_files(),
                    )
                    return

        final = chat_tools.strip_tool_call(reply) or reply.strip()
        if not final:
            final = "(The model returned an empty reply — try again or switch models.)"
        publish(status="done", done=True, reply=final, partial_reply="",
                tool_calls=list(trace), files=workspace.list_files())
    except Exception as exc:  # noqa: BLE001 — a dead thread must still report
        logger.exception("Coder agent failed")
        publish(status="error", done=True, error=str(exc), partial_reply="",
                tool_calls=list(trace), files=workspace.list_files())


@router.post("/chat")
def chat(request: CoderChatRequest) -> dict:
    """Start an agent run. Returns immediately with a task id — poll
    GET /coder/chat/{task_id} for progress and the final reply."""
    ok, reason = llm.availability()
    if not ok:
        raise CudaUnavailableError(reason)

    task_id = uuid.uuid4().hex
    with _tasks_lock:
        # Keep the last few runs only; each holds just text.
        for stale in list(_tasks)[:-9]:
            _tasks.pop(stale, None)
        _tasks[task_id] = {
            "status": "queued", "done": False, "reply": "", "partial_reply": "",
            "tool_calls": [], "files": workspace.list_files(), "error": None,
            "cancel": False,
        }

    history = [m.model_dump() for m in request.messages]
    threading.Thread(
        target=_run_agent, args=(task_id, history), daemon=True,
        name=f"coder-{task_id[:8]}",
    ).start()
    return {"task_id": task_id}


@router.post("/chat/{task_id}/stop")
def stop_chat(task_id: str) -> dict:
    """Ask a running agent to stop. It finishes the step it's on (a command
    already running can't be interrupted mid-flight) and then reports back —
    whatever it wrote so far stays in the workspace."""
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None:
            raise JobNotFoundError("That coder run is no longer available.")
        task["cancel"] = True
        task["status"] = "stopping"
    return {"stopping": True}


@router.get("/chat/{task_id}")
def chat_status(task_id: str) -> dict:
    with _tasks_lock:
        task = _tasks.get(task_id)
    if task is None:
        raise JobNotFoundError("That coder run is no longer available.")
    return {"task_id": task_id, **task}


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
