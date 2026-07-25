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


def test_steps_carry_live_detail_for_the_activity_feed(client, monkeypatch):
    """Each step must describe itself and include its output, so the UI can
    show what the agent is doing as it happens."""
    from app.scriptgen import llm

    replies = iter([
        '<tool_call>{"tool": "write_file", "args": '
        '{"path": "hi.py", "content": "print(\'hi\')"}}</tool_call>',
        '<tool_call>{"tool": "run_file", "args": {"path": "hi.py"}}</tool_call>',
        "Built and ran it.",
    ])
    monkeypatch.setattr(llm, "availability", lambda: (True, "test"))
    monkeypatch.setattr(llm, "chat", lambda messages, **kw: next(replies))

    task_id = client.post(
        "/coder/chat", json={"messages": [{"role": "user", "content": "make hi.py"}]}
    ).json()["task_id"]
    state = _await_task(client, task_id)

    steps = state["tool_calls"]
    assert [s["tool"] for s in steps] == ["write_file", "run_file"]
    assert steps[0]["note"].startswith("Writing hi.py")
    assert all(s["running"] is False and s["ok"] is True for s in steps)
    assert "hi" in steps[1]["output"]  # the program's real stdout
    # write_file's content is never echoed back (it would flood the feed).
    assert "content" not in steps[0]["args"]


def test_identical_repeated_action_pauses_the_run(client, monkeypatch):
    """A model rewriting the same file forever must be caught automatically —
    without the user having to press Stop."""
    from app.api.routes import coder
    from app.scriptgen import llm

    same_call = (
        '<tool_call>{"tool": "write_file", "args": '
        '{"path": "same.txt", "content": "identical"}}</tool_call>'
    )

    def always_same(messages, **kw):
        # The out-of-band status check must not itself be answered with a
        # tool call; reply plainly when asked for STATUS.
        if messages and "STATUS:" in messages[-1]["content"]:
            return "STATUS: continue\nSUMMARY: still writing the same file"
        return same_call

    monkeypatch.setattr(llm, "availability", lambda: (True, "test"))
    monkeypatch.setattr(llm, "chat", always_same)
    monkeypatch.setattr(coder, "LOOP_REPEAT_LIMIT", 3)

    task_id = client.post(
        "/coder/chat", json={"messages": [{"role": "user", "content": "go"}]}
    ).json()["task_id"]
    state = _await_task(client, task_id, timeout=30)

    assert state["status"] == "needs_input"
    assert "repeated the same action" in state["reply"]
    # It stopped at the limit rather than running to MAX_TOOL_ROUNDS.
    assert len(state["tool_calls"]) == 3


def test_completion_check_ends_the_run_when_model_says_completed(client, monkeypatch):
    """Even if the model keeps emitting tool calls, the runtime's own check
    ends the run once the model admits the work is done."""
    from app.api.routes import coder
    from app.scriptgen import llm

    counter = {"n": 0}

    def replies(messages, **kw):
        if messages and "STATUS:" in messages[-1]["content"]:
            return "STATUS: completed\nSUMMARY: Built app.py; run it with python app.py."
        counter["n"] += 1
        return (
            '<tool_call>{"tool": "write_file", "args": '
            f'{{"path": "f{counter["n"]}.py", "content": "print({counter["n"]})"}}}}</tool_call>'
        )

    monkeypatch.setattr(llm, "availability", lambda: (True, "test"))
    monkeypatch.setattr(llm, "chat", replies)
    monkeypatch.setattr(coder, "COMPLETION_CHECK_EVERY", 2)

    task_id = client.post(
        "/coder/chat", json={"messages": [{"role": "user", "content": "build"}]}
    ).json()["task_id"]
    state = _await_task(client, task_id, timeout=30)

    assert state["status"] == "done"
    assert "Built app.py" in state["reply"]
    assert len(state["tool_calls"]) == 2  # stopped at the first check


def test_status_parsing_is_forgiving():
    from app.api.routes.coder import _parse_status

    assert _parse_status("STATUS: completed\nSUMMARY: done")[0] == "completed"
    assert _parse_status("status: BLOCKED\nsummary: no network")[0] == "blocked"
    # Unparseable answers must never end a healthy run.
    assert _parse_status("I think I'm finished?")[0] == "continue"


def test_stop_ends_a_looping_run_and_keeps_its_work(client, monkeypatch):
    """A model that keeps calling tools forever must be stoppable, and the
    files it already wrote must survive."""
    from app.scriptgen import llm

    call_count = {"n": 0}

    def endless(messages, **kw):
        call_count["n"] += 1
        return (
            '<tool_call>{"tool": "write_file", "args": '
            f'{{"path": "loop{call_count["n"]}.txt", "content": "x"}}}}</tool_call>'
        )

    monkeypatch.setattr(llm, "availability", lambda: (True, "test"))
    monkeypatch.setattr(llm, "chat", endless)

    task_id = client.post(
        "/coder/chat", json={"messages": [{"role": "user", "content": "go"}]}
    ).json()["task_id"]

    # Let it get going, then stop it.
    deadline = time.time() + 10
    while time.time() < deadline:
        if client.get(f"/coder/chat/{task_id}").json()["tool_calls"]:
            break
        time.sleep(0.05)
    assert client.post(f"/coder/chat/{task_id}/stop").json()["stopping"] is True

    state = _await_task(client, task_id, timeout=20)
    assert state["status"] == "stopped"
    assert "Stopped" in state["reply"]
    assert state["files"]  # work done before stopping is still there


def test_stopping_an_unknown_run_is_reported(client):
    assert client.post("/coder/chat/nope/stop").status_code == 404


def test_chat_rejected_without_llm(client, monkeypatch):
    from app.scriptgen import llm

    monkeypatch.setattr(llm, "availability", lambda: (False, "Needs a GPU session"))
    resp = client.post("/coder/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 424  # failed dependency, not a server error
    assert "GPU" in resp.json()["error"]["message"]


def test_unknown_task_id_is_reported(client):
    assert client.get("/coder/chat/does-not-exist").status_code == 404
