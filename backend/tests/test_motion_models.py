from app.motion_studio.models import (
    AudioTrack,
    ColorGrade,
    MotionLayer,
    MotionProject,
    MotionScene,
    RectLayerProps,
    TextLayerProps,
    Transform,
    VideoLayerProps,
)


def test_rect_layer_round_trips_through_json():
    layer = MotionLayer(
        id="l1", name="Box", type="rect",
        transform=Transform(x=10, y=20, width=100, height=50),
        rect=RectLayerProps(fill="#ff0000", corner_radius=8),
    )
    restored = MotionLayer.model_validate_json(layer.model_dump_json())
    assert restored == layer


def test_text_layer_round_trips_through_json():
    layer = MotionLayer(
        id="l2", name="Title", type="text",
        text=TextLayerProps(text="Hello", font_size=64),
    )
    restored = MotionLayer.model_validate_json(layer.model_dump_json())
    assert restored == layer
    assert restored.rect is None


def test_scene_defaults_are_a_1080p_canvas():
    scene = MotionScene(id="s1")
    assert scene.width == 1920.0
    assert scene.height == 1080.0
    assert scene.layers == []
    assert scene.audio_tracks == []


def test_audio_track_round_trips_through_json():
    track = AudioTrack(id="a1", name="Voice-over", kind="voiceover", volume=0.8)
    restored = AudioTrack.model_validate_json(track.model_dump_json())
    assert restored == track


def test_scene_with_audio_tracks_round_trips():
    scene = MotionScene(id="s1", audio_tracks=[AudioTrack(id="a1", name="Music", kind="music")])
    restored = MotionScene.model_validate_json(scene.model_dump_json())
    assert restored == scene
    assert restored.audio_tracks[0].kind == "music"


def test_project_round_trips_with_nested_scenes_and_layers():
    project = MotionProject(
        id="p1",
        name="Demo",
        scenes=[
            MotionScene(
                id="s1",
                layers=[MotionLayer(id="l1", name="Box", type="rect", rect=RectLayerProps())],
            )
        ],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    restored = MotionProject.model_validate_json(project.model_dump_json())
    assert restored == project
    assert restored.scenes[0].layers[0].type == "rect"


# --- LT-VIDEOEDIT: crop and freeze frame -------------------------------------
#
# These are round-trip tests rather than behaviour tests because the failure
# mode they guard is silent: pydantic DROPS fields the running model doesn't
# know about, so a new field that isn't actually on the deployed model just
# vanishes on the wire with no error. That has happened here repeatedly and
# always presents as a frontend bug.


def test_video_crop_and_freeze_default_to_off():
    """Existing projects have none of these keys and must be unchanged."""
    props = VideoLayerProps.model_validate({"source_url": "/motion/assets/a.mp4"})
    assert (props.crop_top, props.crop_right, props.crop_bottom, props.crop_left) == (
        0.0, 0.0, 0.0, 0.0,
    )
    assert props.freeze_frame_ms is None


def test_video_crop_and_freeze_round_trip_through_json():
    props = VideoLayerProps(
        source_url="/motion/assets/a.mp4",
        crop_top=0.1, crop_right=0.2, crop_bottom=0.3, crop_left=0.4,
        freeze_frame_ms=1200,
    )
    restored = VideoLayerProps.model_validate_json(props.model_dump_json())
    assert restored == props
    assert restored.crop_bottom == 0.3
    assert restored.freeze_frame_ms == 1200


def test_freezing_at_zero_survives_the_round_trip_as_zero_not_none():
    """0 and None mean different things: hold the first frame vs play."""
    props = VideoLayerProps(source_url="/a.mp4", freeze_frame_ms=0)
    restored = VideoLayerProps.model_validate_json(props.model_dump_json())
    assert restored.freeze_frame_ms == 0
    assert restored.freeze_frame_ms is not None


def test_cropped_video_layer_round_trips_inside_a_project():
    project = MotionProject(
        id="p1", name="Crop",
        scenes=[MotionScene(id="s1", layers=[MotionLayer(
            id="l1", name="Clip", type="video",
            video=VideoLayerProps(source_url="/a.mp4", crop_left=0.25, freeze_frame_ms=500),
        )])],
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
    )
    restored = MotionProject.model_validate_json(project.model_dump_json())
    assert restored == project
    assert restored.scenes[0].layers[0].video.crop_left == 0.25
    assert restored.scenes[0].layers[0].video.freeze_frame_ms == 500


# --- LT-SPEEDRAMP ------------------------------------------------------------


def test_speed_keyframes_default_to_empty_so_existing_projects_are_unchanged():
    props = VideoLayerProps.model_validate({"source_url": "/a.mp4"})
    assert props.speed_keyframes == []


def test_speed_ramp_round_trips_through_json():
    from app.motion_studio.models import SpeedKeyframe

    props = VideoLayerProps(
        source_url="/a.mp4",
        speed_keyframes=[
            SpeedKeyframe(id="s0", time_ms=0, rate=0.5, easing="linear"),
            SpeedKeyframe(id="s1", time_ms=2000, rate=3.0, easing="ease_in_out"),
        ],
    )
    restored = VideoLayerProps.model_validate_json(props.model_dump_json())
    assert restored == props
    assert restored.speed_keyframes[1].rate == 3.0


def test_a_rate_of_zero_is_allowed_because_it_holds_a_frame():
    from app.motion_studio.models import SpeedKeyframe

    assert SpeedKeyframe(id="s", time_ms=0, rate=0).rate == 0


def test_a_negative_rate_is_rejected_rather_than_silently_clamped():
    """Reverse playback would break monotonicity, and both renderers seek
    their <video> elements forward only. Failing loudly beats a ramp that
    quietly doesn't match the number the user typed."""
    import pytest as _pytest
    from pydantic import ValidationError

    from app.motion_studio.models import SpeedKeyframe

    with _pytest.raises(ValidationError, match="must be >= 0"):
        SpeedKeyframe(id="s", time_ms=0, rate=-1.0)


# --- LT-COLORGRADE ------------------------------------------------------------


def test_color_grade_defaults_to_none_so_existing_layers_are_unchanged():
    layer = MotionLayer(id="l1", name="Box", type="rect", rect=RectLayerProps())
    assert layer.color_grade is None


def test_color_grade_default_values_are_identity():
    grade = ColorGrade()
    assert (grade.brightness, grade.contrast, grade.saturation, grade.hue_deg) == (1.0, 1.0, 1.0, 0.0)


def test_color_grade_round_trips_inside_a_layer():
    layer = MotionLayer(
        id="l1", name="Box", type="rect", rect=RectLayerProps(),
        color_grade=ColorGrade(brightness=1.2, contrast=0.9, saturation=1.5, hue_deg=45),
    )
    restored = MotionLayer.model_validate_json(layer.model_dump_json())
    assert restored == layer
    assert restored.color_grade.hue_deg == 45
