"""
Built-in style presets. Each one exercises a distinct combination of
word_mode + animation + background so the 5 together prove out every engine
capability (line/word/karaoke/highlight rendering, fade/pop/karaoke-sweep
animation, plain vs. boxed background). Adding one of the other named
styles from the product brief (Netflix, CapCut, TikTok, Neon, Comic, ...)
later is just a new entry here — no renderer changes needed unless it
introduces a genuinely new word_mode or animation primitive.

Mirrored in frontend/src/subtitle/presets.ts — keep both in sync when
editing.
"""

from __future__ import annotations

from app.subtitle_engine.models import (
    AnimationSpec,
    BackgroundStyle,
    PositionConfig,
    StrokeStyle,
    SubtitleStyle,
    TextStyle,
)

CLASSIC = SubtitleStyle(
    id="classic",
    name="Classic",
    word_mode="line",
    text=TextStyle(font_family="Arial", font_weight=700, font_size=64, color="#FFFFFF"),
    stroke=StrokeStyle(color="#000000", width=3.0),
    position=PositionConfig(anchor="bottom", margin=80),
    animation=AnimationSpec(type="fade", duration_ms=150),
)

KARAOKE = SubtitleStyle(
    id="karaoke",
    name="Karaoke",
    word_mode="karaoke",
    text=TextStyle(
        font_family="Arial", font_weight=700, font_size=60,
        color="#FFFFFF", active_color="#FFD200",
    ),
    stroke=StrokeStyle(color="#000000", width=2.5),
    position=PositionConfig(anchor="bottom", margin=90),
    animation=AnimationSpec(type="karaoke_sweep", duration_ms=0),
)

WORD_POP = SubtitleStyle(
    id="word_pop",
    name="Word Pop",
    word_mode="word",
    text=TextStyle(font_family="Arial", font_weight=800, font_size=88, color="#FFFFFF"),
    stroke=StrokeStyle(color="#000000", width=5.0),
    position=PositionConfig(anchor="center", margin=0),
    animation=AnimationSpec(type="pop", duration_ms=180),
)

HIGHLIGHT = SubtitleStyle(
    id="highlight",
    name="Highlight",
    word_mode="highlight",
    text=TextStyle(
        font_family="Arial", font_weight=700, font_size=60,
        color="#CCCCCC", active_color="#39FF88",
    ),
    stroke=StrokeStyle(color="#000000", width=2.0),
    position=PositionConfig(anchor="bottom", margin=90),
    animation=AnimationSpec(type="none", duration_ms=0),
)

CAPCUT = SubtitleStyle(
    id="capcut",
    name="CapCut",
    word_mode="word",
    text=TextStyle(font_family="Arial", font_weight=800, font_size=70, color="#FFFFFF"),
    stroke=StrokeStyle(color="#000000", width=0.0),
    background=BackgroundStyle(shape="box", color="#000000", opacity=0.75, corner_radius=16),
    position=PositionConfig(anchor="bottom", margin=100),
    animation=AnimationSpec(type="pop", duration_ms=160),
)

BUILTIN_PRESETS: list[SubtitleStyle] = [CLASSIC, KARAOKE, WORD_POP, HIGHLIGHT, CAPCUT]
PRESETS_BY_ID: dict[str, SubtitleStyle] = {p.id: p for p in BUILTIN_PRESETS}

DEFAULT_PRESET_ID = "classic"


def get_preset(preset_id: str | None) -> SubtitleStyle:
    """Look up a built-in preset by id, falling back to Classic for an
    unknown/empty id rather than raising — a caller passing a stale or
    not-yet-synced id should still get a working export, not a 500."""
    if preset_id and preset_id in PRESETS_BY_ID:
        return PRESETS_BY_ID[preset_id]
    return PRESETS_BY_ID[DEFAULT_PRESET_ID]
