"""
"AI narrator" voice synthesis via Microsoft Edge neural voices (edge-tts).

These are the polished TTS voices heard in short-form video ads. Each
transcribed segment is synthesized separately, then placed back on the
original timeline at its source timestamps so the new narration stays in
sync with the video. Segments that come out longer than the gap they must
fit are sped up with ffmpeg's atempo filter (pitch-preserving).

Note: edge-tts calls Microsoft's service over the network — this is the one
pipeline stage that needs internet at runtime. Everything else stays local.
"""

from __future__ import annotations

import asyncio
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from app.core.errors import SynthesisError
from app.core.logging import get_logger
from app.services.ffmpeg_service import resolve_ffmpeg_binaries
from app.services.transcribe_service import SpeechSegment

logger = get_logger(__name__)

# Sample rate the timeline is assembled at. Edge voices are 24 kHz mono;
# the mixer resamples to match the background bed later if needed.
TIMELINE_SR = 24000

# How much a segment may be sped up to fit its slot before we give up and
# let it overlap slightly. Beyond ~1.35x, speech starts to sound rushed.
MAX_TEMPO = 1.35


@dataclass(frozen=True)
class TTSVoice:
    id: str  # edge-tts voice short name
    label: str  # human-readable description for the UI
    gender: str  # "male" | "female"
    accent: str  # UI grouping label, e.g. "US English"


# Curated set, grouped by accent. en-US-GuyNeural is the classic
# short-form-ad narrator; Christopher/Andrew are the deeper "movie trailer"
# style ones. Accent only applies to TTS mode — RVC keeps the original
# speaker's pronunciation.
CURATED_VOICES: list[TTSVoice] = [
    # US English
    TTSVoice("en-US-GuyNeural", "Guy — the classic AI ad narrator", "male", "US English"),
    TTSVoice("en-US-AndrewNeural", "Andrew — warm, confident male", "male", "US English"),
    TTSVoice("en-US-ChristopherNeural", "Christopher — deep, authoritative male", "male", "US English"),
    TTSVoice("en-US-BrianNeural", "Brian — casual, friendly male", "male", "US English"),
    TTSVoice("en-US-RogerNeural", "Roger — mature, measured male", "male", "US English"),
    TTSVoice("en-US-JennyNeural", "Jenny — friendly female", "female", "US English"),
    TTSVoice("en-US-AriaNeural", "Aria — expressive female", "female", "US English"),
    TTSVoice("en-US-MichelleNeural", "Michelle — clear, professional female", "female", "US English"),
    # UK English
    TTSVoice("en-GB-RyanNeural", "Ryan — confident British male", "male", "UK English"),
    TTSVoice("en-GB-ThomasNeural", "Thomas — refined British male", "male", "UK English"),
    TTSVoice("en-GB-SoniaNeural", "Sonia — warm British female", "female", "UK English"),
    TTSVoice("en-GB-LibbyNeural", "Libby — bright British female", "female", "UK English"),
    # Australian English
    TTSVoice("en-AU-WilliamMultilingualNeural", "William — Australian male", "male", "Australian English"),
    TTSVoice("en-AU-NatashaNeural", "Natasha — Australian female", "female", "Australian English"),
    # Other accents
    TTSVoice("en-IE-ConnorNeural", "Connor — Irish male", "male", "Irish English"),
    TTSVoice("en-IN-PrabhatNeural", "Prabhat — Indian male", "male", "Indian English"),
]

DEFAULT_VOICE = "en-US-GuyNeural"


def is_known_voice(voice_id: str) -> bool:
    return any(v.id == voice_id for v in CURATED_VOICES)


def _synthesize_one(text: str, voice: str, mp3_path: Path, rate_pct: int = 0) -> None:
    """Synthesize one segment to mp3. Runs edge-tts' async API to completion.
    `rate_pct` speaks natively faster/slower — natural-sounding, unlike
    post-hoc time-stretching."""
    import edge_tts

    async def _run() -> None:
        rate = f"{'+' if rate_pct >= 0 else ''}{rate_pct}%"
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        await communicate.save(str(mp3_path))

    try:
        asyncio.run(_run())
    except Exception as exc:
        raise SynthesisError(
            f"Voice synthesis failed (voice '{voice}'): {exc}. "
            "edge-tts needs an internet connection — check you are online."
        ) from exc

    if not mp3_path.exists() or mp3_path.stat().st_size == 0:
        raise SynthesisError(
            f"Voice synthesis produced no audio for segment text: '{text[:60]}...'"
        )


def _atempo_chain(tempo: float) -> str:
    """
    ffmpeg's atempo filter only accepts 0.5-2.0 per instance, but instances
    chain multiplicatively — atempo=2.0,atempo=1.5 gives 3.0x. Unbounded
    stretching means overrunning audio is FITTED to its slot, never cut:
    per the master-timeline requirement, dropping words is worse than a
    fast sentence.
    """
    parts = []
    remaining = tempo
    while remaining > 2.0:
        parts.append("atempo=2.0")
        remaining /= 2.0
    parts.append(f"atempo={remaining:.4f}")
    return ",".join(parts)


def _mp3_to_wav(mp3_path: Path, wav_path: Path, tempo: float = 1.0) -> None:
    """Decode mp3 -> mono wav at TIMELINE_SR, optionally speeding it up."""
    ffmpeg_path, _ = resolve_ffmpeg_binaries()
    cmd = [ffmpeg_path, "-y", "-i", str(mp3_path)]
    if tempo > 1.001:
        cmd += ["-af", _atempo_chain(tempo)]
    cmd += ["-ar", str(TIMELINE_SR), "-ac", "1", str(wav_path)]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
    )
    if result.returncode != 0:
        tail = "\n".join(result.stderr.strip().splitlines()[-10:])
        raise SynthesisError(f"Could not decode synthesized audio: {tail}")


def _allowed_end_seconds(
    seg_end: float,
    next_start: float | None,
    borrow_frac: float = 0.5,
    borrow_cap: float = 1.2,
) -> float:
    """
    How far a segment's audio may extend: past its ORIGINAL end into at most
    `borrow_frac` of its own trailing pause (capped at `borrow_cap`), and
    never past the next segment's start. Slightly shortening a pause is
    inaudible; time-stretching speech is not - so pauses absorb overruns
    before tempo does. Precision alignment passes a tiny cap so word
    placement stays exact.
    """
    if next_start is None:
        return seg_end + borrow_cap
    gap = max(0.0, next_start - seg_end)
    return min(next_start, seg_end + min(gap * borrow_frac, borrow_cap))


def _validate_reconstruction(
    fitted: list, master: list, fade_samples: int,
    borrow_frac: float = 0.5, borrow_cap: float = 1.2,
) -> None:
    """
    Master-timeline validation, run before any audio is written. `master`
    is the immutable snapshot (index, start, end, text) taken BEFORE
    processing; `fitted` is what conversion produced. Verifies:

      - every master segment exists exactly once (none missing, none
        duplicated),
      - order is identical to the original sequence,
      - every placement starts at its ORIGINAL timestamp,
      - no placement extends past its original end beyond the crossfade,
      - no empty audio.

    On any failure the export is aborted with a diagnostic naming the exact
    segment, instead of publishing a misaligned result.
    """
    problems: list[str] = []

    def _describe(entry) -> str:
        m_index, m_start, m_end, m_text = entry
        snippet = (m_text[:40] + "...") if len(m_text) > 40 else m_text
        return f"segment #{m_index} [{m_start:.2f}s-{m_end:.2f}s] \"{snippet}\""

    if len(fitted) != len(master):
        problems.append(
            f"segment count mismatch: {len(fitted)} reconstructed, {len(master)} in the master timeline"
        )

    fitted_by_index = {}
    for index, seg, audio, start_idx in fitted:
        if index in fitted_by_index:
            problems.append(f"duplicate reconstruction of segment #{index}")
        fitted_by_index[index] = (seg, audio, start_idx)

    prev_start = -1
    for entry in master:
        m_index, m_start, m_end, m_text = entry
        got = fitted_by_index.get(m_index)
        if got is None:
            problems.append(f"MISSING: {_describe(entry)} was never reconstructed")
            continue
        seg, audio, start_idx = got

        if len(audio) == 0:
            problems.append(f"EMPTY AUDIO: {_describe(entry)}")

        expected_start = int(m_start * TIMELINE_SR)
        if start_idx != expected_start:
            problems.append(
                f"SHIFTED: {_describe(entry)} placed at {start_idx / TIMELINE_SR:.2f}s "
                f"instead of its original {m_start:.2f}s"
            )
        if start_idx <= prev_start:
            problems.append(f"OUT OF ORDER: {_describe(entry)}")
        prev_start = start_idx

        next_start = master[master.index(entry) + 1][1] if master.index(entry) + 1 < len(master) else None
        max_end = int(
            _allowed_end_seconds(m_end, next_start, borrow_frac, borrow_cap) * TIMELINE_SR
        ) + fade_samples + 4
        if start_idx + len(audio) > max_end:
            problems.append(
                f"OVERRUN: {_describe(entry)} extends "
                f"{(start_idx + len(audio) - max_end) / TIMELINE_SR:.2f}s past its original end"
            )

    if problems:
        raise SynthesisError(
            "Timeline validation failed - export aborted to protect synchronization: "
            + "; ".join(problems)
        )


def _render_cached(
    work_dir: Path,
    text: str,
    voice: str,
    engine: str,
    exaggeration: float,
    stability: float | None,
    seed: int,
    device: str,
    reference_wav: Path | None,
) -> Path:
    """
    Renders one utterance to a normalized wav, cached by a content hash of
    everything that affects the sound. Unedited segments therefore cost
    nothing on re-export, and editor previews reuse the exact audio that
    will land in the final track. Tempo-fitting never touches this cache -
    fitted copies are written separately, because fit depends on neighbors.
    """
    import hashlib

    key = hashlib.sha1(
        f"{engine}|{voice}|{text}|{exaggeration}|{stability}|{seed}".encode("utf-8")
    ).hexdigest()[:16]
    wav = work_dir / f"seg_{key}.wav"
    if wav.exists():
        return wav

    raw = work_dir / f"seg_{key}.raw"
    if engine == "chatterbox":
        from app.services.chatterbox_service import synthesize as chatterbox_synthesize

        chatterbox_synthesize(
            text, raw, reference_wav, exaggeration, device=device,
            stability=stability, seed=seed,
        )
    else:
        _synthesize_one(text, voice, raw)
    _mp3_to_wav(raw, wav)
    raw.unlink(missing_ok=True)
    return wav


def synthesize_single(
    work_dir: Path,
    text: str,
    voice: str,
    engine: str = "edge",
    exaggeration: float = 0.5,
    stability: float | None = None,
    seed: int = 0,
    device: str = "cpu",
) -> Path:
    """Segment-editor previews: render exactly one utterance (cached)."""
    reference_wav = None
    if engine == "chatterbox":
        from app.services.expressive_service import ensure_reference_audio

        reference_wav = ensure_reference_audio(voice)
    work_dir.mkdir(parents=True, exist_ok=True)
    return _render_cached(
        work_dir, text, voice, engine, exaggeration, stability, seed, device, reference_wav
    )


def synthesize_timeline(
    segments: list[SpeechSegment],
    voice: str,
    total_duration: float,
    work_dir: Path,
    output_path: Path,
    progress_callback=None,
    engine: str = "edge",
    exaggeration: float = 0.5,
    device: str = "cpu",
    continuity=None,
    strict_fit: bool = False,
    seeds: dict[int, int] | None = None,
) -> tuple[Path, list[SpeechSegment]]:
    """
    Synthesizes every segment with the chosen voice and assembles them into
    one wav of `total_duration` seconds, each segment starting at its
    original timestamp. Returns (output_path, placements) where placements
    are the segments with their FINAL timing in the assembled track (after
    any tempo fitting) — the right timestamps for subtitles.
    """
    if not segments:
        raise SynthesisError("No speech segments to synthesize.")

    work_dir.mkdir(parents=True, exist_ok=True)
    timeline = np.zeros(int(total_duration * TIMELINE_SR) + TIMELINE_SR, dtype=np.float32)
    placements: list[SpeechSegment] = []

    stability = None
    if continuity is not None and continuity.enabled:
        stability = continuity.voice_stability / 100.0

    seeds = seeds or {}
    # Precision alignment: words must land exactly where they were spoken -
    # borrow only a hair of trailing silence before tempo-fitting kicks in.
    borrow_frac = 1.0 if strict_fit else 0.5
    borrow_cap = 0.15 if strict_fit else 1.2

    reference_wav = None
    if engine == "chatterbox":
        # Chatterbox clones the target voice from reference audio — reuse the
        # per-voice reference clips cached for OpenVoice.
        from app.services.expressive_service import ensure_reference_audio

        reference_wav = ensure_reference_audio(voice)

    def _synthesize_raw_refit(seg, raw_path: Path, rate_boost: int) -> None:
        _synthesize_one(seg.text, voice, raw_path, rate_pct=rate_boost)

    # Continuity assembly helpers: crossfaded placement + rolling energy
    # memory so consecutive chunks sound like one performance.
    fade_samples = 0
    memory = None
    if continuity is not None and continuity.enabled:
        from app.services import continuity_service

        fade_samples = continuity_service.crossfade_length_samples(
            continuity.naturalness, TIMELINE_SR
        )
        if continuity.rolling_memory:
            memory = continuity_service.RollingEnergyMemory(
                continuity.context_window, strength=0.5 * continuity.naturalness / 100.0
            )

    # ---- Phase 0: freeze the master timeline -------------------------------
    # An immutable snapshot of every segment's identity and ORIGINAL
    # position, taken before any processing. Nothing may modify it; every
    # later stage is checked against it. Reconstruction never depends on
    # completion or worker order - only on these records.
    ordered = sorted(enumerate(segments), key=lambda pair: pair[1].start)
    master: list[tuple[int, float, float, str]] = [
        (index, seg.start, seg.end, seg.text) for index, seg in ordered
    ]

    # ---- Phase 1: synthesize + duration-fit, strictly chronological -------
    fitted: list[tuple[int, SpeechSegment, np.ndarray, int]] = []
    for pos, (index, seg) in enumerate(ordered):
        cached_wav = _render_cached(
            work_dir, seg.text, voice, engine, exaggeration, stability,
            seeds.get(index, 0), device, reference_wav,
        )
        # Scratch names for fit products (refit takes, tempo-fitted copies):
        # index-named so they never collide with the content-hash cache.
        mp3_path = work_dir / f"fit_{index:04d}.mp3"
        wav_path = work_dir / f"fit_{index:04d}.wav"
        import shutil as _shutil

        _shutil.copyfile(cached_wav, mp3_path)  # ffmpeg sniffs real format
        audio, _sr = sf.read(str(cached_wav), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        # Master-timeline fit, three escalating strategies:
        #   1. borrow the trailing pause (inaudible - see _allowed_end_seconds)
        #   2. edge engine: RE-SYNTHESIZE natively faster (sounds human,
        #      unlike post-hoc stretching)
        #   3. time-stretch the remainder (last resort, unbounded chain so
        #      words are never dropped; trim only guards >4x pathology)
        next_start = ordered[pos + 1][1].start if pos + 1 < len(ordered) else None
        target_seconds = max(
            _allowed_end_seconds(seg.end, next_start, borrow_frac, borrow_cap) - seg.start, 0.2
        )
        grace_seconds = fade_samples / TIMELINE_SR
        seg_seconds = len(audio) / TIMELINE_SR

        if seg_seconds > target_seconds + grace_seconds and engine == "edge":
            ratio = seg_seconds / target_seconds
            if 1.0 < ratio <= 1.8:
                rate_boost = min(int((ratio - 1.0) * 100) + 3, 60)
                logger.info(
                    "Segment %d: re-synthesizing %d%% faster natively (%.2fs -> %.2fs target)",
                    index, rate_boost, seg_seconds, target_seconds,
                )
                _synthesize_raw_refit(seg, mp3_path, rate_boost)
                _mp3_to_wav(mp3_path, wav_path)
                audio, _sr = sf.read(str(wav_path), dtype="float32")
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)
                seg_seconds = len(audio) / TIMELINE_SR

        if seg_seconds > target_seconds + grace_seconds:
            ratio = seg_seconds / target_seconds
            tempo = min(ratio, 4.0)
            if ratio > MAX_TEMPO:
                logger.warning(
                    "Segment %d overruns its slot (%.2fs audio, %.2fs allowed) - atempo %.2f",
                    index, seg_seconds, target_seconds, tempo,
                )
            _mp3_to_wav(mp3_path, wav_path, tempo=tempo)
            audio, _sr = sf.read(str(wav_path), dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)

        # Hard clamp to the ORIGINAL end (+crossfade only): later segments
        # can never be shifted, and cumulative drift is impossible because
        # every placement is anchored to absolute original timestamps.
        max_len = int(target_seconds * TIMELINE_SR) + fade_samples
        if len(audio) > max_len:
            logger.warning(
                "Segment %d still exceeds its original duration after tempo fit - trimming %.2fs",
                index, (len(audio) - max_len) / TIMELINE_SR,
            )
            audio = audio[:max_len].copy()
            tail = min(len(audio), max(fade_samples, int(0.02 * TIMELINE_SR)))
            audio[-tail:] *= np.linspace(1.0, 0.0, tail, dtype=np.float32)

        if memory is not None:
            audio = memory.adapt(audio)
        if fade_samples > 0:
            from app.services.continuity_service import apply_edge_fades

            audio = apply_edge_fades(audio, fade_samples)

        fitted.append((index, seg, audio, int(seg.start * TIMELINE_SR)))

        if progress_callback:
            progress_callback((pos + 1) / len(ordered) * 100.0)

    # ---- Phase 2: validation against the master timeline ------------------
    _validate_reconstruction(fitted, master, fade_samples, borrow_frac, borrow_cap)

    # ---- Phase 3: overlap-add reconstruction in chronological order -------
    for index, seg, audio, start_idx in fitted:
        end_idx = min(start_idx + len(audio), len(timeline))
        # += so crossfade regions blend; validation guarantees any overlap
        # is confined to the fade region.
        timeline[start_idx:end_idx] += audio[: end_idx - start_idx]
        placements.append(
            SpeechSegment(start=seg.start, end=seg.start + (end_idx - start_idx) / TIMELINE_SR, text=seg.text)
        )

    peak = np.abs(timeline).max()
    if peak > 1.0:
        timeline = timeline / peak * 0.99

    # Trim the safety tail back to the real duration.
    timeline = timeline[: int(total_duration * TIMELINE_SR)]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), timeline, TIMELINE_SR, subtype="PCM_16")
    logger.info("Synthesized narration written to %s (%d segments)", output_path, len(segments))
    return output_path, placements


def split_script_into_segments(script: str, total_duration: float) -> list[SpeechSegment]:
    """
    Turns a user-written narration script into speech segments spread evenly
    across the video: split into sentences, then allocate each a slice of the
    timeline proportional to its length (with a short lead-in). The tempo
    fitting in synthesize_timeline handles any slices the voice can't fit.
    """
    import re

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", script) if s.strip()]
    if not sentences:
        raise SynthesisError("The narration script is empty.")

    lead_in = min(0.5, total_duration * 0.05)
    usable = max(total_duration - lead_in, 1.0)
    total_chars = sum(len(s) for s in sentences)

    segments: list[SpeechSegment] = []
    cursor = lead_in
    for sentence in sentences:
        slice_seconds = usable * (len(sentence) / total_chars)
        segments.append(SpeechSegment(start=cursor, end=cursor + slice_seconds, text=sentence))
        cursor += slice_seconds
    return segments
