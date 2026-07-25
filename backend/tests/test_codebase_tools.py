"""Project-awareness tools: useful for guidance, strictly read-only."""

import pytest

from app.scriptgen import codebase, tools


def test_search_finds_known_project_text():
    out = codebase.search_project("synthesize_timeline")
    assert "tts_service.py" in out
    assert ":" in out  # file:line: content


def test_search_reports_no_matches_cleanly():
    assert "No matches" in codebase.search_project("zzz_definitely_not_here_zzz")


def test_search_rejects_too_short_query():
    with pytest.raises(ValueError):
        codebase.search_project("a")


def test_read_project_file_returns_source():
    out = codebase.read_project_file("backend/app/scriptgen/codebase.py")
    assert "Read-only project awareness" in out


def test_read_rejects_path_traversal():
    for bad in ("../../../etc/passwd", "..\\..\\secrets.txt", "/etc/hosts"):
        with pytest.raises(ValueError):
            codebase.read_project_file(bad)


def test_read_rejects_non_source_and_missing_files():
    with pytest.raises(ValueError):
        codebase.read_project_file("backend/app/nope_missing.py")


def test_list_project_files_scoped_to_subdir():
    out = codebase.list_project_files("backend/app/scriptgen")
    assert "backend/app/scriptgen/tools.py" in out
    assert "frontend/" not in out


def test_listing_skips_dependency_and_user_data_dirs():
    out = codebase.list_project_files()
    for skipped in ("node_modules/", "/temp/", "/exports/", "__pycache__"):
        assert skipped not in out


def test_registry_exposes_readonly_tools_and_no_write_tool():
    for name in ("search_project", "read_project_file", "list_project_files"):
        assert name in tools._TOOLS
    # No tool may offer a way to modify project source.
    for name in tools._TOOLS:
        assert not any(w in name for w in ("write", "edit_project", "delete", "patch"))


def test_tools_execute_returns_error_text_not_exception():
    assert tools.execute("read_project_file", {"path": "../../x"}).startswith("Error:")
