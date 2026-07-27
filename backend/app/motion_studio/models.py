from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

LayerType = Literal["rect", "ellipse", "text", "image", "video"]
AnimatableProperty = Literal["x", "y", "width", "height", "rotation", "opacity"]
EasingType = Literal["linear", "ease_in", "ease_out", "ease_in_out", "bounce", "elastic"]


class Keyframe(BaseModel):
    id: str
    time_ms: int
    property: AnimatableProperty
    value: float
    easing: EasingType = "ease_in_out"


class Transform(BaseModel):
    x: float = 0.0
    y: float = 0.0
    width: float = 200.0
    height: float = 200.0
    rotation: float = 0.0  # degrees
    opacity: float = 1.0  # 0-1


class RectLayerProps(BaseModel):
    fill: str = "#4F46E5"
    corner_radius: float = 0.0
    stroke_color: str = "#000000"
    stroke_width: float = 0.0


class EllipseLayerProps(BaseModel):
    fill: str = "#4F46E5"
    stroke_color: str = "#000000"
    stroke_width: float = 0.0


class TextLayerProps(BaseModel):
    text: str = "Text"
    font_family: str = "Inter, Arial, sans-serif"
    font_size: float = 48.0
    font_weight: int = 600
    color: str = "#FFFFFF"
    align: Literal["left", "center", "right"] = "left"


class ImageLayerProps(BaseModel):
    src: str
    fit: Literal["contain", "cover", "fill"] = "contain"


class VideoLayerProps(BaseModel):
    source_url: str = ""
    trim_start_ms: int = 0
    trim_end_ms: int = 0
    playback_rate: float = 1.0
    muted: bool = False
    volume: float = 1.0
    fit: Literal["contain", "cover", "fill"] = "contain"


AudioTrackKind = Literal["voiceover", "music", "sfx"]


class AudioKeyframe(BaseModel):
    id: str
    time_ms: int
    value: float  # 0.0-1.0 volume
    easing: EasingType = "ease_in_out"


class AudioTrack(BaseModel):
    id: str
    name: str
    kind: AudioTrackKind = "voiceover"
    source_url: str = ""
    start_time_ms: int = 0
    duration_ms: int = 1000
    volume: float = 1.0
    volume_keyframes: list[AudioKeyframe] = Field(default_factory=list)
    fade_in_ms: int = 0
    fade_out_ms: int = 0
    muted: bool = False
    solo: bool = False


class GradientStop(BaseModel):
    offset: float  # 0.0-1.0
    color: str  # hex


class GradientFill(BaseModel):
    type: Literal["linear", "radial"] = "linear"
    angle_deg: float = 0.0
    stops: list[GradientStop] = Field(default_factory=list)


class ShadowEffect(BaseModel):
    color: str = "#000000"
    blur: float = 16.0
    offset_x: float = 0.0
    offset_y: float = 8.0
    opacity: float = 0.35
    glow: bool = False


class MotionLayer(BaseModel):
    id: str
    name: str
    type: LayerType
    transform: Transform = Field(default_factory=Transform)
    locked: bool = False
    hidden: bool = False
    rect: RectLayerProps | None = None
    ellipse: EllipseLayerProps | None = None
    text: TextLayerProps | None = None
    image: ImageLayerProps | None = None
    video: VideoLayerProps | None = None
    # Optional visual effects — mirror frontend types/motion.ts. When null
    # the renderer falls back to the shape's plain solid fill / no shadow.
    gradient: GradientFill | None = None
    shadow: ShadowEffect | None = None
    # Flat list across all animatable properties (not nested per-property
    # tracks) — simplest thing to serialize/mirror; filter by `.property`
    # when a renderer needs one property's own keyframes.
    keyframes: list[Keyframe] = Field(default_factory=list)


class MotionScene(BaseModel):
    id: str
    name: str = "Scene 1"
    width: float = 1920.0
    height: float = 1080.0
    duration_ms: int = 5000
    background_color: str = "#0B0B0F"
    layers: list[MotionLayer] = Field(default_factory=list)
    audio_tracks: list[AudioTrack] = Field(default_factory=list)


class MotionProject(BaseModel):
    id: str
    name: str = "Untitled Project"
    scenes: list[MotionScene] = Field(default_factory=list)
    created_at: str
    updated_at: str
