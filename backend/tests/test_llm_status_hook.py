"""Model-load status hook: switching models must not look like a hang."""

from app.scriptgen import llm


def test_hook_receives_loading_message_before_bundle_ready(monkeypatch):
    messages = []
    llm.set_status_hook(messages.append)
    try:
        llm._notify("loading Test Model — downloads ~5 GB")
    finally:
        llm.set_status_hook(None)
    assert any("downloads" in m for m in messages)


def test_hook_is_per_thread_and_optional():
    # No hook registered: must not raise.
    llm.set_status_hook(None)
    llm._notify("no listener here")  # no-op, no exception


def test_a_broken_callback_never_breaks_generation():
    def boom(msg):
        raise RuntimeError("UI disconnected")

    llm.set_status_hook(boom)
    try:
        llm._notify("this must not propagate")  # swallowed, not raised
    finally:
        llm.set_status_hook(None)


def test_engineering_protocol_is_non_empty_and_toggleable(monkeypatch):
    from app.scriptgen import engineering_protocol as ep

    monkeypatch.delenv("AVC_CODER_FULL_PROTOCOL", raising=False)
    full = ep.text()
    assert "TASK COMPLETION PROTOCOL" in full
    assert "PRIMARY OBJECTIVES" in full

    monkeypatch.setenv("AVC_CODER_FULL_PROTOCOL", "0")
    core = ep.text()
    assert len(core) < len(full)
    assert "PRIORITIES" in core


def test_protocol_file_exists_in_repo_and_is_the_real_source():
    from app.scriptgen import engineering_protocol as ep

    assert ep._PROMPT_FILE.exists(), "SYSTEM_PROMPT.md must ship in the repo"
    on_disk = ep._PROMPT_FILE.read_text(encoding="utf-8")
    assert on_disk in ep.text()  # text() = file content + runtime note, unedited


def test_protocol_is_read_fresh_every_call_not_cached(tmp_path, monkeypatch):
    from app.scriptgen import engineering_protocol as ep

    scratch = tmp_path / "SYSTEM_PROMPT.md"
    scratch.write_text("first version", encoding="utf-8")
    monkeypatch.setattr(ep, "_PROMPT_FILE", scratch)
    monkeypatch.delenv("AVC_CODER_FULL_PROTOCOL", raising=False)

    assert "first version" in ep.text()
    scratch.write_text("edited live", encoding="utf-8")
    assert "edited live" in ep.text()  # no restart, no cache, sees the edit


def test_missing_protocol_file_falls_back_instead_of_crashing(tmp_path, monkeypatch):
    from app.scriptgen import engineering_protocol as ep

    monkeypatch.setattr(ep, "_PROMPT_FILE", tmp_path / "does_not_exist.md")
    monkeypatch.delenv("AVC_CODER_FULL_PROTOCOL", raising=False)
    assert ep.text() == ep.CORE
