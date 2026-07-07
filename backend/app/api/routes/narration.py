"""
AI Narration Studio API.

POST /narration/analyze          — script (text or txt/md/docx upload) -> plan
POST /narration/preview          — one planned segment -> audio (cached)
POST /narration/render           — full plan -> assembled narration + timestamps
GET  /narration/{id}/audio       — stream the assembled narration
GET  /narration/{id}/export      — download as wav/mp3/flac/aac/ogg (+srt/json)

The server is stateless between calls except for the per-studio work
directory (temp/narration/<id>/) holding cached segment audio — the plan
itself lives in the client, so editing text or controls is instant and only
changed segments re-render.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.config import Paths
from app.core.errors import AppError
from app.core.hardware import get_hardware_info
from app.narration import engine, exporter, script_analyzer
from app.narration.planner import Controls, PlannedSegment, plan as build_plan
from app.utils.settings_store import get_effective_device_mode

router = APIRouter(prefix="/narration", tags=["narration"])


class AnalyzeRequest(BaseModel):
    script: str
    mode: str = "professional"
    narrator_voice: str = "en-US-GuyNeural"
    quote_voice: str | None = None
    code_policy: str = "skip"  # skip | read | summarize | spell
    controls: dict = Field(default_factory=dict)


class SegmentSpec(BaseModel):
    id: int
    kind: str
    text: str
    speak_text: str
    voice: str
    rate_pct: int
    pitch_hz: int
    energy_pct: int
    exaggeration: float
    pause_after: float
    skipped: bool = False


class PreviewRequest(BaseModel):
    studio_id: str
    segment: SegmentSpec
    engine: str = "edge"
    stability: int = 70
    regenerate: bool = False
    seed: int = 0


class RenderRequest(BaseModel):
    studio_id: str
    segments: list[SegmentSpec]
    engine: str = "edge"
    stability: int = 70
    naturalness: int = 70


def _to_planned(s: SegmentSpec) -> PlannedSegment:
    return PlannedSegment(
        id=s.id, kind=s.kind, text=s.text, speak_text=s.speak_text, voice=s.voice,
        rate_pct=s.rate_pct, pitch_hz=s.pitch_hz, energy_pct=s.energy_pct,
        exaggeration=s.exaggeration, pause_after=s.pause_after, skipped=s.skipped,
    )


def _extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".docx"):
        import io

        from docx import Document

        return "\n\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)
    if name.endswith((".txt", ".md", ".markdown")):
        return data.decode("utf-8", errors="replace")
    raise AppError("Unsupported script file — use .txt, .md, or .docx.")


@router.post("/analyze")
async def analyze(request: AnalyzeRequest) -> dict:
    segments = script_analyzer.analyze(request.script)
    controls = Controls(**{k: v for k, v in request.controls.items() if hasattr(Controls, k)})
    planned = build_plan(
        segments,
        mode=request.mode,
        controls=controls,
        narrator_voice=request.narrator_voice,
        quote_voice=request.quote_voice,
        code_policy=request.code_policy,
    )
    return {
        "studio_id": uuid.uuid4().hex[:12],
        "stats": script_analyzer.script_stats(request.script, segments),
        "segments": [p.to_dict() for p in planned],
        "modes": list(__import__("app.narration.planner", fromlist=["MODES"]).MODES.keys()),
    }


@router.post("/upload-script")
async def upload_script(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise AppError("Script file exceeds the 2 MB limit.")
    return {"script": _extract_text(file.filename or "", data)}


@router.post("/preview")
def preview(request: PreviewRequest) -> FileResponse:
    device = get_hardware_info(get_effective_device_mode()).resolved_device
    wav = engine.render_segment(
        request.studio_id,
        _to_planned(request.segment),
        engine=request.engine,
        stability=request.stability / 100.0,
        device=device,
        force=request.regenerate,
        seed=request.seed,
    )
    return FileResponse(str(wav), media_type="audio/wav")


@router.post("/render")
def render(request: RenderRequest) -> dict:
    device = get_hardware_info(get_effective_device_mode()).resolved_device
    wav, timestamps = engine.assemble(
        request.studio_id,
        [_to_planned(s) for s in request.segments],
        engine=request.engine,
        stability=request.stability / 100.0,
        naturalness=request.naturalness,
        device=device,
    )
    (wav.parent / "timestamps.json").write_text(json.dumps(timestamps), encoding="utf-8")
    duration = timestamps[-1]["end"] if timestamps else 0.0
    return {"studio_id": request.studio_id, "duration": duration, "timestamps": timestamps}


def _studio_wav(studio_id: str) -> Path:
    wav = Paths.temp / "narration" / studio_id / "narration.wav"
    if not wav.exists():
        raise AppError("No rendered narration for this studio session — render first.")
    return wav


@router.get("/{studio_id}/audio")
def audio(studio_id: str) -> FileResponse:
    return FileResponse(str(_studio_wav(studio_id)), media_type="audio/wav")


@router.get("/{studio_id}/export")
def export(studio_id: str, format: str = "wav", subtitles: bool = False) -> FileResponse:
    wav = _studio_wav(studio_id)
    if subtitles:
        ts = json.loads((wav.parent / "timestamps.json").read_text(encoding="utf-8"))
        srt = exporter.export_subtitles(ts, wav.parent / "narration.srt")
        return FileResponse(str(srt), media_type="text/plain", filename="narration.srt")
    out = exporter.export_audio(wav, format)
    return FileResponse(str(out), media_type="application/octet-stream", filename=f"narration.{format}")
