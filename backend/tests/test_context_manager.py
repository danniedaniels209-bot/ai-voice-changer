"""History compaction: keeps working memory bounded without losing
requirements, decisions, files, or unfinished work from older turns."""

import pytest

from app.scriptgen import context_manager as cm


def _msg(role, content):
    return {"role": role, "content": content}


def test_short_conversation_is_left_alone():
    messages = [_msg("system", "sys"), _msg("user", "hi"), _msg("assistant", "hello")]
    assert cm.compact_if_needed(messages, budget_tokens=10_000) == messages


def test_under_budget_conversation_is_untouched_even_if_long():
    messages = [_msg("system", "sys")] + [_msg("user", "short") for _ in range(20)]
    result = cm.compact_if_needed(messages, budget_tokens=10_000, keep_recent=8)
    assert result == messages


def test_over_budget_conversation_gets_summarized(monkeypatch):
    monkeypatch.setattr(
        "app.scriptgen.llm.generate",
        lambda system, user, max_new_tokens=700: "- built a flask app\n- todo: add auth",
    )
    long_text = "x" * 2000  # ~500 tokens each
    messages = [_msg("system", "sys")] + [_msg("user", long_text) for _ in range(20)]

    result = cm.compact_if_needed(messages, budget_tokens=2000, keep_recent=4)

    assert result[0] == messages[0]  # system message preserved untouched
    assert "<context_summary>" in result[1]["content"]
    assert "built a flask app" in result[1]["content"]
    assert result[-4:] == messages[-4:]  # most recent messages kept verbatim
    assert len(result) == 1 + 1 + 4  # system + summary + kept recent


def test_summarizer_failure_degrades_to_a_note_not_a_crash(monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError("GPU busy")

    monkeypatch.setattr("app.scriptgen.llm.generate", boom)
    long_text = "x" * 2000
    messages = [_msg("system", "sys")] + [_msg("user", long_text) for _ in range(20)]

    result = cm.compact_if_needed(messages, budget_tokens=2000, keep_recent=4)
    assert "dropped" in result[1]["content"].lower()
    assert len(result) == 1 + 1 + 4


def test_no_system_message_is_handled(monkeypatch):
    monkeypatch.setattr(
        "app.scriptgen.llm.generate", lambda *a, **kw: "summary text"
    )
    long_text = "x" * 2000
    messages = [_msg("user", long_text) for _ in range(20)]
    result = cm.compact_if_needed(messages, budget_tokens=2000, keep_recent=4)
    assert result[0]["role"] == "user"
    assert "<context_summary>" in result[0]["content"]


def test_estimate_tokens_is_a_reasonable_heuristic():
    assert cm.estimate_tokens("") >= 1
    assert cm.estimate_tokens("a" * 400) == 100
