"""
AI Script Studio API — topic -> outline -> script -> assistant actions.
GPU-gated: /scriptgen/status tells the UI whether generation is available
on this machine (cloud sessions: yes; a CPU laptop: no, with the reason).
"""

from __future__ import annotations

import os
import threading
import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.errors import CudaUnavailableError, JobNotFoundError
from app.core.logging import get_logger
from app.scriptgen import generator, llm

logger = get_logger(__name__)
router = APIRouter(prefix="/scriptgen", tags=["scriptgen"])

# Generation runs on a worker thread (see /chat), so replies are bounded only
# by what the model wants to say. This ceiling exists because the generation
# API requires a number; it is not a product limit.
CHAT_MAX_TOKENS = int(os.environ.get("AVC_CHAT_MAX_TOKENS", 32768))

# Background chat runs, keyed by task id.
_chat_tasks: dict[str, dict] = {}
_chat_lock = threading.Lock()


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
    messages: list[ChatMessage] = Field(min_length=1, max_length=500)


_APP_OVERVIEW = """
The app you live in (so you can advise and ask the right questions about any of it):
- Conversion modes: "tts" re-voices existing speech with an AI narrator at the
  exact original timings; "script" narrates user-provided text over the video;
  "rvc" converts the voice's timbre with a trained model, keeping the original
  delivery (pitch/auto-pitch/index/protect settings, 'Preserve Speaking Style'
  option); "openvoice" clones expressively.
- Engines for tts/script: "edge" = fast cloud Microsoft voices (16 English
  voices across US/UK/AU/IE/IN accents); "chatterbox" = local human-like model
  with voice cloning and an expressiveness dial 0..1 (0 calm, 0.5 natural,
  1 dramatic). Custom voices: users can upload a sample and clone it
  (chatterbox engine only).
- Translation dubbing (tts mode, GPU): es fr de pt hi it ja ko ar ru, two
  voices per language, timing preserved.
- Precision word placement (tts): anchors each phrase exactly where the
  original words were spoken - best lip-sync, slightly less flow.
- Natural continuity: merges speech across brief pauses and keeps energy
  consistent (context window, stability, prosody, naturalness sliders).
- Merge modes: chain a second conversion (e.g. narrate with edge, then RVC).
- Background handling: music/effects are separated and preserved, with music
  ducking and loudness normalization options; separation can be skipped.
- Export: quality presets low/medium/high/lossless; video is stream-copied
  bit-exact unless captions are burned or "compress file size" is on
  (CRF 26 re-encode for big CapCut-style files); subtitles (.srt), burned or
  animated captions, vertical 9:16 variant for Shorts.
- Segment editor: after a tts/script conversion users (or you, via
  edit_segment) can rewrite any narration line, preview it, get a new take,
  and re-export - only changed lines re-render thanks to caching.
- Script Studio: topic -> outline -> full script, plus 18 assist actions
  (rewrite/summarize/titles/description/chapters/keywords/etc).
- Cloud GPU sessions (Colab) unlock you, Whisper large-v3, best separation.
""".strip()


def _chat_system() -> str:
    from app.scriptgen import tools

    return (
        "You are a helpful creative assistant inside a video voice-changer app. "
        "You help users write, rewrite, and brainstorm narration scripts, titles, "
        "descriptions, and other video content. Be concise and practical.\n\n"
        f"{_APP_OVERVIEW}\n\n"
        "You can use these tools to work with the user's conversions:\n"
        f"{tools.TOOL_SPECS}\n\n"
        "To use a tool, reply with ONLY this (no other text):\n"
        '<tool_call>{"tool": "tool_name", "args": {"arg": "value"}}</tool_call>\n'
        "The result comes back in the next message; then answer the user "
        "normally in plain text. Only call a tool when the user's request "
        "needs their actual content — otherwise just answer.\n\n"
        "You can run whole conversions for the user. When they upload a video "
        "in this chat it becomes a job (find it with list_jobs). Before "
        "calling start_conversion, ask short clarifying questions for any "
        "choice they haven't made yet — like an expert assistant would: "
        "which mode (re-voice / narrate a script / voice model), which "
        "engine ('edge' = fast cloud, 'chatterbox' = human-like local with "
        "expressiveness 0..1), which voice or dub language. One or two "
        "questions at a time, then act. If they already told you everything, "
        "don't re-ask — just start it and confirm. After starting, use "
        "get_job_status when they ask how it's going.\n\n"
        "You are also this app's built-in guide. You can READ the project's "
        "own source (search_project / read_project_file / list_project_files) "
        "but you can NEVER modify it — you have no edit tools, and must never "
        "claim to have changed the app. When someone asks where a feature is "
        "or how something works, search the source to be sure, then answer in "
        "plain user language — name the page, section and button (e.g. "
        "\"New Conversion → Subtitles → Add subtitles\"), not file paths, "
        "unless they explicitly ask about the code. The Guide page in the "
        "sidebar also documents every feature."
    )


class ModelSelectRequest(BaseModel):
    model: str


def _model_list() -> list[dict]:
    """Registry for the pickers, with per-model usability on THIS session."""
    out = []
    for key, info in llm.MODELS.items():
        supported, why = llm.architecture_supported(key)
        out.append({
            "key": key,
            "label": info["label"],
            "download": info["download"],
            "supported": supported,
            "reason": why,
        })
    return out


@router.get("/status")
def status() -> dict:
    ok, reason = llm.availability()
    return {
        "available": ok,
        "reason": reason,
        "model": llm.MODELS[llm.active_model()]["id"],
        "active_model": llm.active_model(),
        "models": _model_list(),
        "actions": list(generator.ACTIONS.keys()),
    }


@router.post("/model")
def select_model(request: ModelSelectRequest) -> dict:
    llm.set_model(request.model)
    return {"active_model": llm.active_model()}


def _run_chat(task_id: str, history: list[dict]) -> None:
    """The chat/agent loop on a worker thread. Because nothing here is bound
    to an HTTP request, generation length is limited only by the model."""
    from app.scriptgen import context_manager, tools

    messages = [{"role": "system", "content": _chat_system()}] + history
    tool_trace: list[dict] = []
    reply = ""

    def publish(**fields) -> None:
        with _chat_lock:
            _chat_tasks[task_id].update(fields)

    def cancelled() -> bool:
        with _chat_lock:
            return bool(_chat_tasks.get(task_id, {}).get("cancel"))

    llm.set_status_hook(lambda msg: publish(status=msg))
    llm.set_stream_hook(lambda text: publish(partial_reply=text))

    try:
        for _ in range(tools.MAX_TOOL_ROUNDS + 1):
            if cancelled():
                publish(status="stopped", done=True, reply="Stopped.", partial_reply="",
                        tool_calls=list(tool_trace))
                return
            messages = context_manager.compact_if_needed(messages)
            publish(status="thinking", partial_reply="")
            reply = llm.chat(messages, max_new_tokens=CHAT_MAX_TOKENS)
            call = tools.parse_tool_call(reply)
            if call is None or len(tool_trace) >= tools.MAX_TOOL_ROUNDS:
                break
            name, args = call
            publish(status=f"running {name}")
            result = tools.execute(name, args)
            tool_trace.append(
                {"tool": name, "args": args, "ok": not result.startswith("Error:")}
            )
            publish(tool_calls=list(tool_trace))
            messages.append({"role": "assistant", "content": reply})
            messages.append({
                "role": "user",
                "content": f"<tool_result>\n{result}\n</tool_result>\n"
                           "Now answer the user's request in plain text "
                           "(or call another tool if needed).",
            })

        final = tools.strip_tool_call(reply) or reply.strip()
        if not final:
            # Model burned its whole turn on reasoning/tool syntax — never
            # send an empty bubble back to the UI.
            final = (
                "(The model returned an empty reply — please try again or "
                "switch models above.)"
            )
        publish(status="done", done=True, reply=final, partial_reply="",
                tool_calls=list(tool_trace))
    except Exception as exc:  # noqa: BLE001 — a dead thread must still report
        logger.exception("Chat agent failed")
        publish(status="error", done=True, error=str(exc), partial_reply="",
                tool_calls=list(tool_trace))


@router.post("/chat")
def chat(request: ChatRequest) -> dict:
    """Start a chat turn. Returns a task id immediately — poll
    GET /scriptgen/chat/{task_id}. Running in the background means a long
    answer is never cut short by an HTTP or tunnel timeout."""
    ok, reason = llm.availability()
    if not ok:
        raise CudaUnavailableError(reason)

    task_id = uuid.uuid4().hex
    with _chat_lock:
        for stale in list(_chat_tasks)[:-9]:
            _chat_tasks.pop(stale, None)
        _chat_tasks[task_id] = {
            "status": "queued", "done": False, "reply": "", "partial_reply": "",
            "tool_calls": [], "error": None, "cancel": False,
        }

    history = [m.model_dump() for m in request.messages]
    threading.Thread(
        target=_run_chat, args=(task_id, history), daemon=True,
        name=f"chat-{task_id[:8]}",
    ).start()
    return {"task_id": task_id}


@router.post("/chat/{task_id}/stop")
def stop_chat(task_id: str) -> dict:
    with _chat_lock:
        task = _chat_tasks.get(task_id)
        if task is None:
            raise JobNotFoundError("That chat run is no longer available.")
        task["cancel"] = True
        task["status"] = "stopping"
    return {"stopping": True}


@router.get("/chat/{task_id}")
def chat_status(task_id: str) -> dict:
    with _chat_lock:
        task = _chat_tasks.get(task_id)
    if task is None:
        raise JobNotFoundError("That chat run is no longer available.")
    return {"task_id": task_id, **task}


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
