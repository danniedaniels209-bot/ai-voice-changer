from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

LayerType = Literal["rect", "ellipse", "text", "image", "video", "polygon", "star", "triangle", "line", "arrow"]
AnimatableProperty = Literal["x", "y", "width", "height", "rotation", "opacity", "blur"]
EasingType = Literal[
    "linear",
    "ease_in",
    "ease_out",
    "ease_in_out",
    "bounce",
    "elastic",
    "spring",
    "overshoot",
    "custom",
]


class Keyframe(BaseModel):
    id: str
    time_ms: int
    property: AnimatableProperty
    value: float
    easing: EasingType = "ease_in_out"
    # Cubic-bezier control points, only meaningful when easing == "custom".
    # Same semantics as the frontend — defaulted so existing project JSON
    # deserialises unchanged.
    easing_bezier: tuple[float, float, float, float] | None = None


class Transform(BaseModel):
    x: float = 0.0
    y: float = 0.0
    width: float = 200.0
    height: float = 200.0
    rotation: float = 0.0  # degrees
    opacity: float = 1.0  # 0-1
    blur: float = 0.0  # gaussian blur radius (0 = no blur)


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
    # LT-TEXTSTYLE — letter spacing in px, line-height multiplier, text outline.
    # Defaulted Optional so existing project JSON deserialises unchanged and
    # factories don't have to spell them out per call site.
    letter_spacing: float = 0.0
    line_height: float = 1.25  # matches textWrap.ts LINE_HEIGHT_FACTOR
    stroke_color: str = "#000000"
    stroke_width: float = 0.0


class ImageLayerProps(BaseModel):
    src: str
    fit: Literal["contain", "cover", "fill"] = "contain"


class PolygonLayerProps(BaseModel):
    fill: str = "#4F46E5"
    stroke_color: str = "#000000"
    stroke_width: float = 0.0
    points: list[float] = Field(default_factory=list)


class StarLayerProps(BaseModel):
    fill: str = "#F59E0B"
    stroke_color: str = "#000000"
    stroke_width: float = 0.0
    num_points: int = 5
    inner_radius_ratio: float = 0.4


class TriangleLayerProps(BaseModel):
    fill: str = "#10B981"
    stroke_color: str = "#000000"
    stroke_width: float = 0.0
    direction: Literal["up", "down", "left", "right"] = "up"


class LineLayerProps(BaseModel):
    stroke_color: str = "#FFFFFF"
    stroke_width: float = 2.0
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 200.0
    y2: float = 200.0


class ArrowLayerProps(BaseModel):
    stroke_color: str = "#FFFFFF"
    stroke_width: float = 2.0
    x1: float = 0.0
    y1: float = 0.0
    x2: float = 200.0
    y2: float = 200.0
    head_size: float = 12.0
    head_angle: float = 30.0


class VideoLayerProps(BaseModel):
    source_url: str = ""
    trim_start_ms: int = 0
    trim_end_ms: int = 0
    playback_rate: float = 1.0
    muted: bool = False
    volume: float = 1.0
    fit: Literal["contain", "cover", "fill"] = "contain"

    # Crop, as a fraction (0-1) trimmed off each edge of the layer's box.
    # All four default to 0 = no crop, so every existing project is unchanged.
    #
    # Crop TRIMS, it does not ZOOM: the remaining footage keeps its size and
    # position and the cropped-away edges become transparent. That matches the
    # default behaviour of the crop effect in Premiere/Resolve, and it is the
    # only definition that renders identically in all three renderers from a
    # single CSS `clip-path: inset(...)` with no geometry math — anything that
    # rescales has to re-derive object-fit against a different aspect ratio in
    # each renderer, which is exactly the kind of split that has produced
    # editor/export divergence here before. To fill the frame with a cropped
    # region, resize the layer.
    crop_top: float = 0.0
    crop_right: float = 0.0
    crop_bottom: float = 0.0
    crop_left: float = 0.0

    # Hold a single frame instead of playing. None = play normally.
    #
    # This is SOURCE time (a position within the footage), not scene time, so
    # the held frame stays the same one if the layer is later retimed or the
    # scene is stretched. The UI sets it from the current playhead by running
    # the same scene->source mapping the renderers use.
    freeze_frame_ms: int | None = None


AudioTrackKind = Literal["voiceover", "music", "sfx"]


class AudioKeyframe(BaseModel):
    id: str
    time_ms: int
    value: float  # 0.0-1.0 volume
    easing: EasingType = "ease_in_out"


class AudioMarker(BaseModel):
    id: str
    time_ms: int
    label: str
    color: str


class SceneMarker(BaseModel):
    id: str
    time_ms: int
    label: str
    color: str


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
    markers: list[AudioMarker] = Field(default_factory=list)


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
    color: str | None = None
    parent_id: str | None = None
    is_folder: bool = False
    rect: RectLayerProps | None = None
    ellipse: EllipseLayerProps | None = None
    text: TextLayerProps | None = None
    image: ImageLayerProps | None = None
    video: VideoLayerProps | None = None
    polygon: PolygonLayerProps | None = None
    star: StarLayerProps | None = None
    triangle: TriangleLayerProps | None = None
    line: LineLayerProps | None = None
    arrow: ArrowLayerProps | None = None
    # Optional visual effects — mirror frontend types/motion.ts. When null
    # the renderer falls back to the shape's plain solid fill / no shadow.
    # Defaulted (not required) so existing factories/layer constructors that
    # don't pass these fields still validate — gradient/shadow are additive
    # decoration most layers never use, so the burden shouldn't be on every
    # call site to spell out `gradient=None, shadow=None`.
    gradient: GradientFill | None = None
    shadow: ShadowEffect | None = None

    # Optional scene-time visibility window. A layer is rendered only during
    # [visible_start_ms ?? 0, visible_end_ms ?? scene.duration_ms). None on
    # either side = "use the scene default", so an unset pair matches today's
    # "every layer is visible the whole scene" behaviour. Defaulted (not
    # required) for the same reason gradient/shadow are: additive behaviour
    # most layers don't use; forcing every factory call site to spell out
    # `visible_start_ms=None, visible_end_ms=None` would be noise.
    # NB: scene time, NOT source media time — VideoLayerProps.trim_start_ms/
    # trim_end_ms cover the orthogonal "which part of the source footage
    # plays" axis. v1: keyframes stay scene-absolute and do NOT move when a
    # layer is retimed (keyframes outside the visible range simply stop
    # having effect because the layer isn't drawn there).
    visible_start_ms: int | None = None
    visible_end_ms: int | None = None

    # Flat list across all animatable properties (not nested per-property
    # tracks) — simplest thing to serialize/mirror; filter by `.property`
    # when a renderer needs one property's own keyframes.
    keyframes: list[Keyframe] = Field(default_factory=list)


ConnectorStyle = Literal["straight", "curved", "orthogonal", "bezier"]
ConnectorEndAnchor = Literal["center", "top", "right", "bottom", "left"]


class ConnectorEndpoint(BaseModel):
    layer_id: str
    anchor: ConnectorEndAnchor


class MotionConnector(BaseModel):
    """A connection between two layers that follows its endpoints when
    either layer moves / is resized / animates. Endpoints are LAYER-ANCHORED
    (not absolute points): the renderer resolves a concrete (x, y) for each
    end at draw time from the source/target layer's current transform.

    Field names are ``source`` / ``target`` deliberately — ``from`` is a
    Python keyword and Pydantic aliasing would split the wire format
    between disk-serialised and HTTP-serialised JSON in this codebase
    (storage uses model_dump_json without by_alias; FastAPI defaults to
    true). Using plain names with no alias avoids the split entirely.
    """

    id: str
    name: str = "Connector"
    source: ConnectorEndpoint
    target: ConnectorEndpoint
    style: ConnectorStyle = "curved"
    stroke_color: str = "#888888"
    stroke_width: float = 2.0
    dash_pattern: str | None = None
    animated: bool = False


class MotionScene(BaseModel):
    id: str
    name: str = "Scene 1"
    width: float = 1920.0
    height: float = 1080.0
    duration_ms: int = 5000
    background_color: str = "#0B0B0F"
    layers: list[MotionLayer] = Field(default_factory=list)
    audio_tracks: list[AudioTrack] = Field(default_factory=list)
    markers: list[SceneMarker] = Field(default_factory=list)
    # Optional connectors between layers. Flat list per scene — a connector
    # is a relationship between two layers, so storing it on either side
    # would create an asymmetry around which side owns deletion; a flat
    # scene-level list mirrors how audio_tracks already work. Defaulted so
    # existing project JSON deserialises unchanged.
    connectors: list[MotionConnector] = Field(default_factory=list)


class MotionProject(BaseModel):
    id: str
    name: str = "Untitled Project"
    scenes: list[MotionScene] = Field(default_factory=list)
    created_at: str
    updated_at: str
