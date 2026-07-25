"""
Data model for the subtitle engine. Field names deliberately match
frontend/src/types/subtitle.ts one-for-one (snake_case here, camelCase
there) so a style dict round-trips through the API without translation, and
the frontend's live CSS preview renders the exact style the backend's ASS
renderer burns into the export.

WordMode is the one field every renderer (frontend + ASS) branches on:
  - "line":      the whole cue appears and disappears as one unit.
  - "word":      one word on screen at a time (Shorts/TikTok "pop" style).
  - "karaoke":   the whole line is shown, words sweep from base to active
                 color in sync with speech (native ASS \\kf karaoke tags).
  - "highlight": the whole line is shown, the current word is recolored
                 while the rest stay at the base color (no sweep/animation,
                 just a color swap per word).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

WordMode = Literal["line", "word", "karaoke", "highlight"]
BackgroundShape = Literal["none", "box"]
PositionAnchor = Literal["top", "center", "bottom"]

# Deliberately a small, fully-implemented set rather than a large list of
# half-supported ones — see ass_renderer.py for what each one actually does.
AnimationType = Literal["none", "fade", "pop", "karaoke_sweep", "typewriter"]


class SubtitleWord(BaseModel):
    text: str
    start: float  # seconds
    end: float


class SubtitleCue(BaseModel):
    id: str
    start: float  # seconds
    end: float
    text: str
    # Populated by word_align.align_words() when real per-word timing is
    # available; empty means renderers fall back to a proportional split.
    words: list[SubtitleWord] = Field(default_factory=list)


class TextStyle(BaseModel):
    font_family: str = "Arial"
    font_weight: int = 700
    italic: bool = False
    underline: bool = False
    letter_spacing: float = 0.0
    font_size: int = 64  # px, at the 1920x1080 reference canvas
    color: str = "#FFFFFF"  # base / not-yet-spoken color
    # Used by karaoke (post-sweep color) and highlight (current-word color).
    # None means "reuse color" (no visible highlight distinction).
    active_color: str | None = None
    opacity: float = 1.0


class StrokeStyle(BaseModel):
    color: str = "#000000"
    width: float = 0.0  # px; 0 = no stroke


class ShadowStyle(BaseModel):
    color: str = "#000000"
    blur: float = 0.0
    offset_x: float = 0.0
    offset_y: float = 2.0
    opacity: float = 0.6


class BackgroundStyle(BaseModel):
    # "box" maps to ASS BorderStyle=3 (opaque box auto-sized to the text by
    # the renderer) — true rounded corners aren't expressible in ASS without
    # per-glyph-width vector drawing, so this is a square/rect box only.
    # The frontend preview CAN render real rounded corners (CSS border-radius)
    # since it isn't limited by libass; corner_radius is honored there and
    # ignored by the ASS renderer.
    shape: BackgroundShape = "none"
    color: str = "#000000"
    opacity: float = 0.6
    padding_x: float = 16.0
    padding_y: float = 8.0
    corner_radius: float = 12.0


class PositionConfig(BaseModel):
    anchor: PositionAnchor = "bottom"
    margin: float = 80.0  # px from the anchored edge, at 1080p reference


class AnimationSpec(BaseModel):
    type: AnimationType = "fade"
    duration_ms: int = 200


class SubtitleStyle(BaseModel):
    id: str
    name: str
    word_mode: WordMode = "line"
    text: TextStyle = Field(default_factory=TextStyle)
    stroke: StrokeStyle = Field(default_factory=StrokeStyle)
    shadow: ShadowStyle = Field(default_factory=ShadowStyle)
    background: BackgroundStyle = Field(default_factory=BackgroundStyle)
    position: PositionConfig = Field(default_factory=PositionConfig)
    animation: AnimationSpec = Field(default_factory=AnimationSpec)
