"""AI Chat content tools: tool-call parsing and segment editing."""

import json

from app.scriptgen import tools


def test_parse_valid_tool_call():
    reply = '<tool_call>{"tool": "list_jobs", "args": {}}</tool_call>'
    assert tools.parse_tool_call(reply) == ("list_jobs", {})


def test_parse_accepts_name_arguments_aliases_and_missing_close_tag():
    reply = 'Sure!\n<tool_call>{"name": "get_transcript", "arguments": {"job_id": "abc"}}'
    assert tools.parse_tool_call(reply) == ("get_transcript", {"job_id": "abc"})


def test_parse_rejects_plain_text_and_unknown_tools():
    assert tools.parse_tool_call("Here are three title ideas...") is None
    assert tools.parse_tool_call('<tool_call>{"tool": "rm_rf", "args": {}}</tool_call>') is None
    assert tools.parse_tool_call("<tool_call>not json</tool_call>") is None


def test_strip_tool_call_removes_block_keeps_text():
    reply = 'Done.\n<tool_call>{"tool": "list_jobs", "args": {}}</tool_call>'
    assert tools.strip_tool_call(reply) == "Done."


def test_edit_segment_updates_recipe(tmp_path, monkeypatch):
    from app.core.config import Paths

    job_dir = tmp_path / "job1"
    job_dir.mkdir()
    recipe = {"segments": [
        {"id": 0, "start": 0.0, "end": 2.0, "text": "hello", "seed": 0},
        {"id": 1, "start": 2.5, "end": 5.0, "text": "world", "seed": 0},
    ]}
    (job_dir / "edit_recipe.json").write_text(json.dumps(recipe), encoding="utf-8")
    monkeypatch.setattr(Paths, "job_temp_dir", staticmethod(lambda job_id: job_dir))

    result = tools.execute("edit_segment", {"job_id": "job1", "segment_id": 1, "new_text": "WORLD!"})
    assert "updated" in result
    saved = json.loads((job_dir / "edit_recipe.json").read_text(encoding="utf-8"))
    assert saved["segments"][1]["text"] == "WORLD!"
    assert saved["segments"][0]["text"] == "hello"


def test_start_conversion_validates_inputs():
    assert tools.execute("start_conversion", {}).startswith("Error:")
    assert "mode must be" in tools.execute(
        "start_conversion", {"job_id": "x", "mode": "banana"}
    )
    assert "Unsupported dub language" in tools.execute(
        "start_conversion", {"job_id": "x", "mode": "tts", "dub_language": "zz"}
    )


def test_start_conversion_picks_default_dub_voice(monkeypatch):
    """When dubbing without a valid dub voice, the language's first voice is used."""
    captured = {}

    def fake_start(job_id, request):
        captured["voice"] = request.tts_voice
        captured["dub"] = request.dub_language

        class J:
            original_filename = "clip.mp4"

        return J()

    import app.api.routes.convert as convert_route

    monkeypatch.setattr(convert_route, "start_conversion", fake_start)
    result = tools.execute(
        "start_conversion", {"job_id": "j1", "mode": "tts", "dub_language": "es"}
    )
    assert "Conversion started" in result
    assert captured["dub"] == "es"
    from app.services.tts_service import DUB_VOICES

    assert captured["voice"] == DUB_VOICES["es"][0][0]


def test_get_job_status_missing_job_is_error_text():
    assert tools.execute("get_job_status", {"job_id": "nope-123"}).startswith("Error:")


def test_edit_segment_errors_are_text_not_exceptions(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "job_temp_dir", staticmethod(lambda job_id: tmp_path / "nope"))
    result = tools.execute("edit_segment", {"job_id": "gone", "segment_id": 0, "new_text": "x"})
    assert result.startswith("Error:")
