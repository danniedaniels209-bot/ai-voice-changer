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
        "get_job_status when they ask how it's going."
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
        # Effectively uncapped: generation stops at the model's natural end;
        # this ceiling only exists because HF generate() requires one.
        reply = llm.chat(messages, max_new_tokens=16384)
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
