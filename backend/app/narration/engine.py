"""
Speech Generator — renders a narration plan to audio, one segment at a time.

Per-segment caching (keyed by a hash of everything that affects the sound)
is what makes the Studio interactive: previewing one paragraph renders one
paragraph; regenerating a section re-renders only that section; the final
"generate all" reuses every segment already previewed.

Engines are pluggable: `_render_edge` and `_render_chatterbox` share one
tiny contract (plan segment in, wav path out) — a future engine is one more
function and one dispatch line.
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

import numpy as np
import soundfile as sf

from app.core.config import Paths
from app.core.errors import SynthesisError
from app.core.logging import get_logger
from app.narration.planner import PlannedSegment

logger = get_logger(__name__)

SR = 24000


def _work_dir(studio_id: str) -> Path:
    d = Paths.temp / "narration" / studio_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _segment_key(seg: PlannedSegment, engine: str, seed: int) -> str:
    raw = f"{engine}|{seg.voice}|{seg.speak_text}|{seg.rate_pct}|{seg.pitch_hz}|{seg.energy_pct}|{seg.exaggeration}|{seed}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def _signed_pct(v: int) -> str:
    return f"{'+' if v >= 0 else ''}{v}%"


def _render_edge(seg: PlannedSegment, out_mp3: Path) -> None:
    import edge_tts

    async def _run() -> None:
        communicate = edge_tts.Communicate(
            seg.speak_text,
            seg.voice,
            rate=_signed_pct(seg.rate_pct),
            volume=_signed_pct(seg.energy_pct),
            pitch=f"{'+' if seg.pitch_hz >= 0 else ''}{seg.pitch_hz}Hz",
        )
        await communicate.save(str(out_mp3))

    try:
        asyncio.run(_run())
    except Exception as exc:
        raise SynthesisError(f"Narration synthesis failed (edge, '{seg.voice}'): {exc}") from exc


def _render_chatterbox(seg: PlannedSegment, out_wav: Path, stability: float, device: str) -> None:
    from app.services.chatterbox_service import synthesize
    from app.services.expressive_service import ensure_reference_audio

    reference = ensure_reference_audio(seg.voice)
    synthesize(
        seg.speak_text,
        out_wav,
        reference_wav=reference,
        exaggeration=seg.exaggeration,
        device=device,
        stability=stability,
    )


def render_segment(
    studio_id: str,
    seg: PlannedSegment,
    engine: str = "edge",
    stability: float = 0.7,
    device: str = "cpu",
    force: bool = False,
    seed: int = 0,
) -> Path:
    """
    Renders one plan segment to a mono wav at SR, cached. `force=True`
    (with a new seed) is section regeneration: a fresh take of just this
    segment, leaving everything else untouched.
    """
    from app.services.tts_service import _mp3_to_wav

    work = _work_dir(studio_id)
    key = _segment_key(seg, engine, seed)
    wav = work / f"{key}.wav"
    if wav.exists() and not force:
        return wav

    raw = work / f"{key}.raw"
    if engine == "chatterbox":
        _render_chatterbox(seg, raw, stability, device)
    else:
        _render_edge(seg, raw)
    _mp3_to_wav(raw, wav)  # ffmpeg sniffs actual format; normalizes to SR mono
    raw.unlink(missing_ok=True)
    return wav


def assemble(
    studio_id: str,
    plan: list[PlannedSegment],
    engine: str,
    stability: float,
    naturalness: int,
    device: str = "cpu",
    progress_callback=None,
) -> tuple[Path, list[dict]]:
    """
    Renders every non-skipped segment (cache-aware) and concatenates them
    with the planned pauses. Short raised-cosine edge fades (scaled by
    Naturalness) keep joins seamless. Returns (wav_path, timestamps) where
    timestamps carry each segment's start/end for subtitles and highlighting.
    """
    fade = max(2, int(SR * (0.01 + 0.04 * naturalness / 100)))
    pieces: list[np.ndarray] = []
    timestamps: list[dict] = []
    cursor = 0.0

    active = [s for s in plan if not s.skipped]
    for i, seg in enumerate(active):
        wav = render_segment(studio_id, seg, engine=engine, stability=stability, device=device)
        audio, _ = sf.read(str(wav), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        ramp = 0.5 * (1 - np.cos(np.linspace(0, np.pi, min(fade, len(audio) // 2))))
        if len(ramp) > 1:
            audio = audio.copy()
            audio[: len(ramp)] *= ramp
            audio[-len(ramp):] *= ramp[::-1]

        timestamps.append({
            "id": seg.id,
            "text": seg.text,
            "start": round(cursor, 3),
            "end": round(cursor + len(audio) / SR, 3),
        })
        pieces.append(audio)
        cursor += len(audio) / SR

        pause = np.zeros(int(seg.pause_after * SR), dtype=np.float32)
        pieces.append(pause)
        cursor += len(pause) / SR

        if progress_callback:
            progress_callback((i + 1) / len(active) * 100.0)

    if not pieces:
        raise SynthesisError("Nothing to narrate — every segment was skipped or empty.")

    narration = np.concatenate(pieces)
    peak = np.abs(narration).max()
    if peak > 1.0:
        narration = narration / peak * 0.99

    out = _work_dir(studio_id) / "narration.wav"
    sf.write(str(out), narration, SR, subtype="PCM_16")
    logger.info("Narration assembled: %.1fs, %d segments", cursor, len(active))
    return out, timestamps
