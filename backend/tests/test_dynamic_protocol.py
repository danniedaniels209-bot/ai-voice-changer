"""Dynamic protocol retrieval: small core always sent, specialized sections
pulled in only when the task/workspace actually calls for them."""

import pytest

from app.scriptgen import engineering_protocol as ep


def test_all_core_headings_exist_in_the_source_file():
    sections = ep._sections()
    missing = [h for h in ep.CORE_HEADINGS if h not in sections]
    assert missing == []


def test_duplicate_headings_collapse_without_losing_content():
    sections = ep._sections()
    # The source file repeats this section verbatim twice; parsing must not
    # error or silently drop it — exactly one (non-empty) copy survives.
    assert "CODE REVIEW PROTOCOL" in sections
    assert len(sections["CODE REVIEW PROTOCOL"]) > 20


def test_generic_task_gets_only_core(monkeypatch):
    monkeypatch.delenv("AVC_CODER_PROTOCOL_MODE", raising=False)
    prompt, included = ep.build_prompt("hi", [])
    assert set(included) == set(h for h in ep.CORE_HEADINGS if h in ep._sections())
    assert "REACT" not in included
    assert "PYTHON" not in included


def test_react_task_pulls_in_react_and_frontend_sections(monkeypatch):
    monkeypatch.delenv("AVC_CODER_PROTOCOL_MODE", raising=False)
    prompt, included = ep.build_prompt("build a react todo app", ["App.tsx"])
    assert "REACT" in included
    assert "JAVASCRIPT/TYPESCRIPT" in included
    # Core rules are still present alongside the specialized ones.
    assert "SECURITY" in included


def test_python_workspace_file_triggers_python_section_even_without_keyword(monkeypatch):
    """Retrieval also looks at the files already in the workspace, not just
    the wording of the latest message."""
    monkeypatch.delenv("AVC_CODER_PROTOCOL_MODE", raising=False)
    prompt, included = ep.build_prompt("fix this", ["main.py", "utils.py"])
    assert "PYTHON" in included


def test_dynamic_prompt_is_much_smaller_than_full(monkeypatch):
    monkeypatch.delenv("AVC_CODER_PROTOCOL_MODE", raising=False)
    dynamic_prompt, _ = ep.build_prompt("hi", [])
    full_prompt = ep.text()
    assert len(dynamic_prompt) < len(full_prompt) * 0.4


def test_mode_full_includes_everything(monkeypatch):
    monkeypatch.setenv("AVC_CODER_PROTOCOL_MODE", "full")
    prompt, included = ep.build_prompt("hi", [])
    assert len(included) == len(ep._sections())


def test_mode_core_includes_only_core(monkeypatch):
    monkeypatch.setenv("AVC_CODER_PROTOCOL_MODE", "core")
    prompt, included = ep.build_prompt("build a react app", ["App.tsx"])
    assert set(included) == set(h for h in ep.CORE_HEADINGS if h in ep._sections())
    assert "REACT" not in included


def test_build_prompt_falls_back_when_file_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(ep, "_PROMPT_FILE", tmp_path / "gone.md")
    monkeypatch.setattr(ep, "_cache", None)
    monkeypatch.setattr(ep, "_cache_mtime", None)
    monkeypatch.delenv("AVC_CODER_PROTOCOL_MODE", raising=False)
    prompt, included = ep.build_prompt("hi", [])
    assert prompt  # never empty
    assert "fallback" in included[0].lower()


def test_legacy_text_still_returns_full_verbatim_document():
    """The whole-document accessor other code may still rely on stays
    unaffected by the new task-scoped builder."""
    full = ep.text()
    assert "TASK COMPLETION PROTOCOL" in full
    assert "PRIMARY OBJECTIVES" in full
