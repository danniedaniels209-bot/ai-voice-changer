"""Coder API: the agent runs in the background so nothing is request-bound."""

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "temp", tmp_path)
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def _await_task(client, task_id, timeout=30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = client.get(f"/coder/chat/{task_id}").json()
        if state.get("done"):
            return state
        time.sleep(0.1)
    raise AssertionError("coder task never finished")


def test_chat_returns_task_id_immediately_and_completes(client, monkeypatch):
    """The POST must not block on the model — it hands back a task id, and
    the answer arrives via polling."""
    from app.scriptgen import llm

    monkeypatch.setattr(llm, "availability", lambda: (True, "test"))
    monkeypatch.setattr(llm, "chat", lambda messages, **kw: "All done — nothing to build.")

    started = client.post("/coder/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert started.status_code == 200
    task_id = started.json()["task_id"]

    state = _await_task(client, task_id)
    assert state["reply"] == "All done — nothing to build."
    assert state["error"] is None


def test_agent_loop_executes_tools_and_reports_progress(client, monkeypatch):
    """A tool call is executed, recorded in the trace, and its effect is
    visible in the workspace file list."""
    from app.scriptgen import llm

    replies = iter([
        '<tool_call>{"tool": "write_file", "args": '
        '{"path": "app/main.py", "content": "print(1)"}}</tool_call>',
        "Created app/main.py for you.",
    ])
    monkeypatch.setattr(llm, "availability", lambda: (True, "test"))
    monkeypatch.setattr(llm, "chat", lambda messages, **kw: next(replies))

    task_id = client.post(
        "/coder/chat", json={"messages": [{"role": "user", "content": "make an app"}]}
    ).json()["task_id"]

    state = _await_task(client, task_id)
    assert state["reply"] == "Created app/main.py for you."
    assert [t["tool"] for t in state["tool_calls"]] == ["write_file"]
    assert "app/main.py" in state["files"]


def test_chat_rejected_without_llm(client, monkeypatch):
    from app.scriptgen import llm

    monkeypatch.setattr(llm, "availability", lambda: (False, "Needs a GPU session"))
    resp = client.post("/coder/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 424  # failed dependency, not a server error
    assert "GPU" in resp.json()["error"]["message"]


def test_unknown_task_id_is_reported(client):
    assert client.get("/coder/chat/does-not-exist").status_code == 404
