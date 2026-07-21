"""
Content tools the AI Chat can call — a registry scoped to the app's own
data and pipeline: list conversions, start a conversion on an uploaded job
(same validation path as POST /convert), follow its progress, read a job's
transcript, edit narration lines (persisted to the segment-editor recipe),
and list available voices. Nothing here deletes data, touches exports
directly, or reaches outside the app's job/temp directories.
"""

from __future__ import annotations

import json
import re

from app.core.config import Paths

MAX_TOOL_ROUNDS = 8  # ceiling on tool calls per chat message

TOOL_SPECS = """
list_jobs()
  -> Recent jobs: id, filename, status, mode. Videos uploaded in this chat
     appear here as jobs waiting to be converted.

get_job_status(job_id: str)
  -> Live status of one job: stage, progress percent, latest log line,
     error message if it failed.

start_conversion(job_id: str, mode: str, voice?: str, engine?: str,
                 expressiveness?: float, dub_language?: str, script?: str,
                 model_name?: str, precision?: bool, compress?: bool,
                 subtitle_language?: str)
  -> Starts converting an uploaded job. mode: "tts" (re-voice the speech),
     "script" (narrate the given script text), "rvc" (voice model,
     needs model_name), "openvoice" (expressive clone).
     engine: "edge" (fast cloud) or "chatterbox" (human-like local,
     supports expressiveness 0..1). dub_language: es/fr/de/pt/hi/it/ja/ko/
     ar/ru translates the speech before narrating (tts mode only; a
     matching dub voice is picked automatically if none is given).

get_transcript(job_id: str)
  -> The narration lines of a finished tts/script conversion, with segment
     ids and timings. Needs the segment editor (Settings) to have been on.

edit_segment(job_id: str, segment_id: int, new_text: str)
  -> Rewrites one narration line. The change is saved to the job's editing
     data; the user re-exports from the job page to hear it.

list_voices()
  -> Available narrator voices: id, description, gender, accent.

create_tool(name: str, purpose: str)
  -> Build yourself a NEW tool: an LLM writes a small Python program
     (stdlib only) for the given purpose, it is tested in a sandbox, and
     only registered if its self-test passes. Use when the user asks for
     something no existing tool covers (e.g. "word frequency counter",
     "timestamp math", "title case fixer").

run_custom_tool(name: str, args: dict)
  -> Run a tool previously built with create_tool.

list_custom_tools()
  -> Names + descriptions of the tools you have built so far.
""".strip()


def _recipe_path(job_id: str):
    return Paths.job_temp_dir(job_id) / "edit_recipe.json"


def _load_recipe(job_id: str) -> dict:
    path = _recipe_path(job_id)
    if not path.exists():
        raise ValueError(
            f"Job {job_id} has no editing data (segment editor was off, the "
            "job isn't a tts/script conversion, or temp files were cleaned)."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _tool_list_jobs(args: dict) -> str:
    from app.utils import job_manager

    jobs = job_manager.list_jobs()[:10]
    if not jobs:
        return "No jobs yet."
    lines = [
        f"- {j.id}: {j.original_filename or '?'} [{j.status}] mode={j.mode or '?'}"
        for j in jobs
    ]
    return "\n".join(lines)


def _tool_get_transcript(args: dict) -> str:
    job_id = str(args.get("job_id", "")).strip()
    if not job_id:
        raise ValueError("get_transcript needs job_id.")
    recipe = _load_recipe(job_id)
    lines = [
        f"[{s['id']}] {s['start']:.1f}-{s['end']:.1f}s: {s['text']}"
        for s in recipe.get("segments", [])
    ]
    return "\n".join(lines) or "The transcript is empty."


def _tool_edit_segment(args: dict) -> str:
    job_id = str(args.get("job_id", "")).strip()
    new_text = str(args.get("new_text", "")).strip()
    try:
        segment_id = int(args.get("segment_id"))
    except (TypeError, ValueError):
        raise ValueError("edit_segment needs a numeric segment_id.")
    if not job_id or not new_text:
        raise ValueError("edit_segment needs job_id, segment_id and new_text.")

    recipe = _load_recipe(job_id)
    for seg in recipe.get("segments", []):
        if seg["id"] == segment_id:
            old = seg["text"]
            seg["text"] = new_text
            _recipe_path(job_id).write_text(
                json.dumps(recipe, indent=2), encoding="utf-8"
            )
            return (
                f"Segment {segment_id} updated.\nWas: {old}\nNow: {new_text}\n"
                "Tell the user to open the job page and press "
                "'Apply changes & re-export' to hear it."
            )
    raise ValueError(f"Job {job_id} has no segment with id {segment_id}.")


def _tool_get_job_status(args: dict) -> str:
    from app.utils import job_manager

    job_id = str(args.get("job_id", "")).strip()
    if not job_id:
        raise ValueError("get_job_status needs job_id.")
    job = job_manager.get_job(job_id)
    last_log = job.log[-1].message if job.log else ""
    lines = [
        f"{job.original_filename or job.id}: {job.status} ({job.stage}, "
        f"{job.progress_percent:.0f}%)",
    ]
    if last_log:
        lines.append(f"Latest: {last_log}")
    if job.error_message:
        lines.append(f"Error: {job.error_message}")
    if job.output_path:
        lines.append(f"Exported to: {job.output_path}")
    return "\n".join(lines)


def _tool_start_conversion(args: dict) -> str:
    from app.api.routes.convert import start_conversion as _start
    from app.schemas.convert import ConvertRequest
    from app.services import tts_service

    job_id = str(args.get("job_id", "")).strip()
    if not job_id:
        raise ValueError("start_conversion needs job_id (see list_jobs).")
    mode = str(args.get("mode", "tts")).strip().lower()
    if mode not in ("tts", "script", "rvc", "openvoice"):
        raise ValueError("mode must be one of: tts, script, rvc, openvoice.")

    engine = str(args.get("engine", "edge")).strip().lower()
    if engine not in ("edge", "chatterbox"):
        engine = "edge"

    dub_language = (str(args.get("dub_language") or "").strip().lower()) or None
    voice = (str(args.get("voice") or "").strip()) or tts_service.DEFAULT_VOICE
    if dub_language and mode == "tts" and not tts_service.is_dub_voice(voice, dub_language):
        # A 3B model rarely knows the dub-voice catalog — pick the language's
        # default rather than failing the whole request.
        dub_voices = tts_service.DUB_VOICES.get(dub_language, [])
        if not dub_voices:
            raise ValueError(
                f"Unsupported dub language '{dub_language}'. "
                "Available: es fr de pt hi it ja ko ar ru."
            )
        voice = dub_voices[0][0]

    try:
        expressiveness = min(1.0, max(0.0, float(args.get("expressiveness", 0.5))))
    except (TypeError, ValueError):
        expressiveness = 0.5

    request = ConvertRequest(
        mode=mode,  # type: ignore[arg-type]
        model_name=(str(args.get("model_name") or "").strip()) or None,
        tts_voice=voice,
        narration_engine=engine,  # type: ignore[arg-type]
        exaggeration=expressiveness,
        script=(str(args.get("script") or "").strip()) or None,
        dub_language=dub_language,
        subtitle_language=(str(args.get("subtitle_language") or "").strip().lower()) or None,
        precision_alignment=bool(args.get("precision", False)),
        compress_output=bool(args.get("compress", False)),
    )
    job = _start(job_id, request)
    return (
        f"Conversion started for {job.original_filename or job_id} "
        f"(mode={mode}, voice={voice}, engine={engine}"
        + (f", dubbed into {dub_language}" if dub_language else "")
        + "). Use get_job_status to follow progress."
    )


def _tool_list_voices(args: dict) -> str:
    from app.services.tts_service import CURATED_VOICES

    return "\n".join(
        f"- {v.id}: {v.label} ({v.gender}, {v.accent})" for v in CURATED_VOICES
    )


def _tool_create_tool(args: dict) -> str:
    from app.scriptgen import toolforge

    return toolforge.create_tool(
        str(args.get("name", "")), str(args.get("purpose", ""))
    )


def _tool_run_custom_tool(args: dict) -> str:
    from app.scriptgen import toolforge

    tool_args = args.get("args")
    return toolforge.run_tool(
        str(args.get("name", "")), tool_args if isinstance(tool_args, dict) else {}
    )


def _tool_list_custom_tools(args: dict) -> str:
    from app.scriptgen import toolforge

    return toolforge.list_tools()


_TOOLS = {
    "create_tool": _tool_create_tool,
    "run_custom_tool": _tool_run_custom_tool,
    "list_custom_tools": _tool_list_custom_tools,
    "list_jobs": _tool_list_jobs,
    "get_job_status": _tool_get_job_status,
    "start_conversion": _tool_start_conversion,
    "get_transcript": _tool_get_transcript,
    "edit_segment": _tool_edit_segment,
    "list_voices": _tool_list_voices,
}

# <tool_call>{"tool": "...", "args": {...}}</tool_call> — accepts whitespace
# and a missing closing tag (small models often truncate it).
_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*(?:</tool_call>|$)", re.DOTALL)


def parse_tool_call(reply: str) -> tuple[str, dict] | None:
    """Extract a tool call from a model reply, or None for a normal answer."""
    m = _CALL_RE.search(reply)
    if not m:
        return None
    try:
        payload = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    name = payload.get("tool") or payload.get("name")
    if name not in _TOOLS:
        return None
    args = payload.get("args") or payload.get("arguments") or {}
    return name, args if isinstance(args, dict) else {}


def strip_tool_call(reply: str) -> str:
    return _CALL_RE.sub("", reply).strip()


def execute(name: str, args: dict) -> str:
    """Run one tool; errors come back as text so the model can recover."""
    try:
        return _TOOLS[name](args)
    except ValueError as exc:
        return f"Error: {exc}"
    except Exception as exc:  # noqa: BLE001 — surface anything to the model
        return f"Error: {type(exc).__name__}: {exc}"
