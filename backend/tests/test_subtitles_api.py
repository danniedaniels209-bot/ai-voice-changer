from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_presets_returns_all_five_builtins():
    resp = client.get("/subtitles/presets")
    assert resp.status_code == 200
    ids = {p["id"] for p in resp.json()}
    assert ids == {"classic", "karaoke", "word_pop", "highlight", "capcut"}


def test_preset_shape_matches_the_style_model():
    resp = client.get("/subtitles/presets")
    classic = next(p for p in resp.json() if p["id"] == "classic")
    assert classic["word_mode"] == "line"
    assert "text" in classic and "stroke" in classic and "animation" in classic
