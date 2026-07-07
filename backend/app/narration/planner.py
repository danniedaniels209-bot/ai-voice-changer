"""
Narration + Prosody Planner — the "voice director". Combines the analyzed
segments, the chosen narration mode, and the user's advanced controls into a
concrete per-segment delivery plan: WHAT to say (speakable text, code policy
applied), HOW to say it (rate/pitch/energy/expressiveness per segment type),
WITH WHICH voice (multi-voice for quotes/dialogue), and the pause after it.

Delivery is inferred from context — questions lean inquisitive (slight pitch
lift, gentler pace), commands land firmer and slower, exclamations get more
energy/expressiveness, headings slow down and breathe afterwards — scaled on
top of the mode's baseline. No manual tags required.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.narration.pronunciation import to_speakable
from app.narration.script_analyzer import Segment

# Mode baselines: rate/pitch offsets in percent/Hz (edge-tts semantics),
# energy in percent volume, exaggeration/stability for Chatterbox, and a
# pause multiplier. Values are deliberately moderate — modes should color
# the read, not caricature it.
MODES: dict[str, dict] = {
    "professional": {"rate": 0, "pitch": 0, "energy": 0, "exaggeration": 0.45, "pause": 1.0},
    "educational": {"rate": -8, "pitch": 0, "energy": 0, "exaggeration": 0.5, "pause": 1.25},
    "youtube": {"rate": +6, "pitch": +5, "energy": +10, "exaggeration": 0.65, "pause": 0.9},
    "podcast": {"rate": -4, "pitch": -2, "energy": 0, "exaggeration": 0.5, "pause": 1.15},
    "documentary": {"rate": -10, "pitch": -5, "energy": -5, "exaggeration": 0.45, "pause": 1.35},
    "news": {"rate": +4, "pitch": 0, "energy": +5, "exaggeration": 0.4, "pause": 0.85},
    "storytelling": {"rate": -6, "pitch": 0, "energy": +5, "exaggeration": 0.7, "pause": 1.3},
    "cinematic": {"rate": -12, "pitch": -8, "energy": +5, "exaggeration": 0.75, "pause": 1.5},
    "conversational": {"rate": 0, "pitch": +2, "energy": 0, "exaggeration": 0.55, "pause": 1.0},
    "tutorial": {"rate": -8, "pitch": 0, "energy": 0, "exaggeration": 0.45, "pause": 1.2},
}

# Pause after a segment, in seconds (before the pause multiplier).
_PAUSES = {
    "sentence": 0.15,
    "paragraph_end": 0.65,
    "heading": 0.9,
    "list_item": 0.35,
    "quote": 0.5,
    "dialogue": 0.4,
    "code": 0.5,
}

# Per-sentence-type deltas applied on top of the mode baseline.
_TYPE_DELTAS = {
    "question": {"rate": -4, "pitch": +12, "energy": 0, "exaggeration": +0.08},
    "exclamation": {"rate": +4, "pitch": +6, "energy": +12, "exaggeration": +0.18},
    "command": {"rate": -8, "pitch": -4, "energy": +8, "exaggeration": +0.1},
    "statement": {"rate": 0, "pitch": 0, "energy": 0, "exaggeration": 0.0},
}


@dataclass
class Controls:
    """Advanced controls (all neutral by default)."""

    speed: int = 0  # -50..+50 percent
    pitch: int = 0  # -50..+50 Hz-ish
    energy: int = 0  # -50..+50 percent
    expression: int = 50  # 0..100 -> scales exaggeration & type deltas
    stability: int = 70  # 0..100 (chatterbox identity consistency)
    naturalness: int = 70  # 0..100 -> crossfades/pause easing at assembly
    pause_scale: int = 100  # 50..200 percent


@dataclass
class PlannedSegment:
    id: int
    kind: str
    text: str  # original, for display/subtitles
    speak_text: str  # pronunciation-engine output actually sent to TTS
    voice: str
    rate_pct: int
    pitch_hz: int
    energy_pct: int
    exaggeration: float
    pause_after: float
    skipped: bool = False
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return self.__dict__ | {"meta": dict(self.meta)}


def _code_text(seg: Segment, policy: str) -> tuple[str, bool]:
    lines = seg.text.strip().split("\n")
    if policy == "skip":
        return "", True
    if policy == "summarize":
        return f"Here, the script includes a code block of {len(lines)} lines.", False
    if policy == "spell":
        snippet = seg.text.strip()[:120]
        return " ".join(snippet), False
    return seg.text, False  # "read"


def plan(
    segments: list[Segment],
    mode: str,
    controls: Controls,
    narrator_voice: str,
    quote_voice: str | None = None,
    code_policy: str = "skip",
) -> list[PlannedSegment]:
    base = MODES.get(mode, MODES["professional"])
    expression_scale = controls.expression / 50.0  # 50 = as designed
    planned: list[PlannedSegment] = []

    for seg in segments:
        deltas = _TYPE_DELTAS.get(seg.sentence_type, _TYPE_DELTAS["statement"])
        # Emphasis words present -> a measured energy/expression lift.
        emphasis_boost = min(len(seg.emphasis_words), 2)

        if seg.kind == "code":
            speak, skipped = _code_text(seg, code_policy)
        else:
            speak, skipped = to_speakable(seg.text), False

        pause_key = "paragraph_end" if seg.is_paragraph_end and seg.kind == "sentence" else seg.kind
        pause = _PAUSES.get(pause_key, _PAUSES["sentence"]) * base["pause"] * (controls.pause_scale / 100.0)

        voice = quote_voice if (quote_voice and seg.kind in ("quote", "dialogue")) else narrator_voice

        exaggeration = base["exaggeration"] + deltas["exaggeration"] * expression_scale + emphasis_boost * 0.06
        planned.append(
            PlannedSegment(
                id=seg.id,
                kind=seg.kind,
                text=seg.text,
                speak_text=speak,
                voice=voice,
                rate_pct=int(base["rate"] + deltas["rate"] * expression_scale + controls.speed
                             + (-10 if seg.kind == "heading" else 0)),
                pitch_hz=int(base["pitch"] + deltas["pitch"] * expression_scale + controls.pitch),
                energy_pct=int(base["energy"] + deltas["energy"] * expression_scale
                               + controls.energy + emphasis_boost * 5),
                exaggeration=round(max(0.0, min(1.0, exaggeration)), 2),
                pause_after=round(pause, 2),
                skipped=skipped or not speak.strip(),
                meta={
                    "sentence_type": seg.sentence_type,
                    "emphasis_words": seg.emphasis_words,
                    "tech_terms": seg.tech_terms,
                },
            )
        )
    return planned
