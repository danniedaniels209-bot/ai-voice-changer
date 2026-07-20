"""
Content tools the AI Chat can call — a small, safe registry scoped to the
app's own data: list conversions, read a job's transcript, edit narration
lines (persisted to the segment-editor recipe, re-exported from the UI),
and list available voices. Nothing here starts processing, touches exports,
or reaches outside the app's job/temp directories.
"""

from __future__ import annotations

import json
import re

from app.core.config import Paths

MAX_TOOL_ROUNDS = 4  # ceiling on tool calls per chat message

TOOL_SPECS = """
list_jobs()
  -> Your recent conversions: id, filename, status, mode.

get_transcript(job_id: str)
  -> The narration lines of a finished tts/script conversion, with segment
     ids and timings. Needs the segment editor (Settings) to have been on.

edit_segment(job_id: str, segment_id: int, new_text: str)
  -> Rewrites one narration line. The change is saved to the job's editing
     data; the user re-exports from the job page to hear it.

list_voices()
  -> Available narrator voices: id, description, gender, accent.
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


def _tool_list_voices(args: dict) -> str:
    from app.services.tts_service import CURATED_VOICES

    return "\n".join(
        f"- {v.id}: {v.label} ({v.gender}, {v.accent})" for v in CURATED_VOICES
    )


_TOOLS = {
    "list_jobs": _tool_list_jobs,
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
