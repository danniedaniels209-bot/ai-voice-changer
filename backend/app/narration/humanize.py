"""
Human expression pass — optional, off by default.

The planner gives every segment of the same type identical delivery: three
consecutive statements come out at exactly the same rate, pitch and energy.
That uniformity is the thing that still reads as synthetic even when the
voice itself is convincing — real speakers never repeat a delivery exactly,
and the ear notices the regularity long before it notices the timbre.

This adds the variation a person naturally has:

  micro-variation   small per-sentence differences in pace, pitch and volume
  declination       pitch and energy drift down through a paragraph, then
                    reset at the next one — the single most recognisable
                    feature of natural speech prosody
  emphasis          detected emphasis words get a real lift rather than the
                    flat token boost the planner applies
  breath            pause lengths vary instead of being metronomic

DETERMINISTIC BY DESIGN. The variation is derived from a hash of the
segment's own text and position, not from a random number generator. The
same script with the same settings always produces the same read. That
matters more than it might seem: narration gets regenerated constantly while
you tweak wording, and if every render sounded different you could never
tell whether a change you made was an improvement or just noise. It also
means a re-export months later matches the video you already cut.

Everything here is additive on top of the planner's values and scales with
the existing Expression control, so the two compose instead of fighting.
Turning this off restores the previous behaviour exactly.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

# Ranges are deliberately small. The goal is "a person read this", not
# "something is wrong with the audio" — past roughly these values it stops
# sounding natural and starts sounding unstable, which is worse than the
# flat delivery it replaces.
_RATE_JITTER_PCT = 3.0
_PITCH_JITTER_HZ = 4.0
_ENERGY_JITTER_PCT = 4.0
_PAUSE_JITTER = 0.18

# How far pitch/energy fall from the first sentence of a paragraph to the
# last. Real speakers reset high at a new topic and trail down through it.
_DECLINATION_PITCH_HZ = 6.0
_DECLINATION_ENERGY_PCT = 5.0

# Emphasis words get a genuine lift. The planner's existing emphasis_boost
# is capped at 2 words and worth +5 energy total, which is barely audible.
_EMPHASIS_PITCH_HZ = 3.5
_EMPHASIS_ENERGY_PCT = 6.0
_EMPHASIS_RATE_PCT = -2.0  # slowing slightly is what actually marks stress


def _unit(seed_text: str, salt: str) -> float:
    """Stable pseudo-random value in [-1, 1] for a given segment and channel.

    Hash-derived rather than random so the same input always yields the same
    output. Separate salts keep rate/pitch/energy from moving in lockstep,
    which would read as a systematic drift rather than natural variation.
    """
    digest = hashlib.sha256(f"{salt}:{seed_text}".encode("utf-8")).digest()
    # First two bytes -> [0, 1) -> [-1, 1]
    raw = int.from_bytes(digest[:2], "big") / 65535.0
    return raw * 2.0 - 1.0


@dataclass
class Delivery:
    """The subset of a planned segment this pass adjusts."""

    rate_pct: int
    pitch_hz: int
    energy_pct: int
    exaggeration: float
    pause_after: float


def humanize(
    delivery: Delivery,
    *,
    seed_text: str,
    position_in_paragraph: float,
    emphasis_word_count: int,
    expression: int,
) -> Delivery:
    """Return `delivery` with natural variation applied.

    position_in_paragraph is 0.0 for the first sentence of a paragraph and
    1.0 for the last, driving the declination curve. A single-sentence
    paragraph gets 0.0 — no drift, because there's nothing to drift across.

    expression is the existing 0..100 control. It scales everything here, so
    a user who has already dialled expression down doesn't suddenly get a
    livelier read just for enabling this.
    """
    scale = max(0.0, expression / 50.0)
    if scale == 0.0:
        return delivery

    rate = delivery.rate_pct + _unit(seed_text, "rate") * _RATE_JITTER_PCT * scale
    pitch = delivery.pitch_hz + _unit(seed_text, "pitch") * _PITCH_JITTER_HZ * scale
    energy = delivery.energy_pct + _unit(seed_text, "energy") * _ENERGY_JITTER_PCT * scale

    # Declination: start of a paragraph sits highest, end sits lowest.
    pitch -= position_in_paragraph * _DECLINATION_PITCH_HZ * scale
    energy -= position_in_paragraph * _DECLINATION_ENERGY_PCT * scale

    # Emphasis: a real stress is pitch up, volume up, and slightly SLOWER.
    # Capped at three words — beyond that the sentence is all emphasis and
    # therefore has none.
    if emphasis_word_count:
        weight = min(emphasis_word_count, 3) * scale
        pitch += _EMPHASIS_PITCH_HZ * weight
        energy += _EMPHASIS_ENERGY_PCT * weight
        rate += _EMPHASIS_RATE_PCT * weight

    pause = delivery.pause_after * (1.0 + _unit(seed_text, "pause") * _PAUSE_JITTER * scale)

    return Delivery(
        rate_pct=int(round(rate)),
        pitch_hz=int(round(pitch)),
        energy_pct=int(round(energy)),
        # Exaggeration (Chatterbox) is left alone: the planner already ties it
        # to sentence type and the Expression control, and pushing it further
        # per-sentence makes the voice's IDENTITY wobble rather than its
        # delivery, which is the one artefact users immediately dislike.
        exaggeration=delivery.exaggeration,
        pause_after=round(max(0.0, pause), 2),
    )
