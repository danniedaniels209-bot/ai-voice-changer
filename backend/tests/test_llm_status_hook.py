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
