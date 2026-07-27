from app.motion_studio.models import (
    AudioTrack,
    MotionLayer,
    MotionProject,
    MotionScene,
    RectLayerProps,
    TextLayerProps,
    Transform,
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
