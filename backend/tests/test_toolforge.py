"""Tool Forge sandbox: registration validation and isolated execution."""

import pytest

from app.scriptgen import toolforge


GOOD_TOOL = '''
"""Adds two numbers from args a and b."""

def run(args: dict) -> str:
    return str(int(args.get("a", 0)) + int(args.get("b", 0)))

if __name__ == "__main__":
    assert run({"a": 2, "b": 3}) == "5"
    print("TESTS PASSED")
'''


@pytest.fixture()
def forge_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(toolforge, "TOOLS_DIR", tmp_path)
    return tmp_path


def test_run_tool_executes_in_sandbox(forge_dir):
    (forge_dir / "adder.py").write_text(GOOD_TOOL, encoding="utf-8")
    assert toolforge.run_tool("adder", {"a": 4, "b": 6}) == "10"


def test_run_tool_unknown_name_rejected(forge_dir):
    with pytest.raises(ValueError, match="No custom tool"):
        toolforge.run_tool("ghost", {})


def test_bad_names_rejected(forge_dir):
    for bad in ("../evil", "UPPER", "x", "a" * 40, "rm -rf"):
        with pytest.raises(ValueError):
            toolforge.run_tool(bad, {})


def test_crashing_tool_returns_error_text(forge_dir):
    (forge_dir / "boom.py").write_text(
        'def run(args):\n    raise RuntimeError("kaboom")\n', encoding="utf-8"
    )
    result = toolforge.run_tool("boom", {})
    assert result.startswith("Error running 'boom'")
    assert "kaboom" in result


def test_hanging_tool_times_out(forge_dir, monkeypatch):
    monkeypatch.setattr(toolforge, "RUN_TIMEOUT_S", 3)
    (forge_dir / "spin.py").write_text(
        "def run(args):\n"
        "    while True:\n"
        "        pass\n",
        encoding="utf-8",
    )
    result = toolforge.run_tool("spin", {})
    assert "Timed out" in result


def test_list_tools_reads_docstrings(forge_dir):
    (forge_dir / "adder.py").write_text(GOOD_TOOL, encoding="utf-8")
    listing = toolforge.list_tools()
    assert "adder" in listing
    assert "Adds two numbers" in listing


def test_create_tool_registers_only_on_passing_tests(forge_dir, monkeypatch):
    from app.scriptgen import llm

    monkeypatch.setattr(llm, "generate", lambda *a, **k: GOOD_TOOL)
    report = toolforge.create_tool("adder", "add two numbers")
    assert "registered" in report
    assert (forge_dir / "adder.py").exists()


def test_create_tool_rejects_failing_code(forge_dir, monkeypatch):
    from app.scriptgen import llm

    failing = 'def run(args):\n    return "x"\n\nif __name__ == "__main__":\n    assert False\n'
    monkeypatch.setattr(llm, "generate", lambda *a, **k: failing)
    report = toolforge.create_tool("broken", "always fails")
    assert "FAILED" in report
    assert not (forge_dir / "broken.py").exists()
