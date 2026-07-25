"""Coder workspace: read/write/run inside the sandbox, nothing outside it."""

import pytest

from app.scriptgen import workspace


@pytest.fixture(autouse=True)
def isolated_workspace(tmp_path, monkeypatch):
    from app.core.config import Paths

    monkeypatch.setattr(Paths, "temp", tmp_path)
    workspace.clear_workspace()
    return workspace.workspace_dir()


def test_write_read_list_roundtrip():
    workspace.write_file("src/hello.py", "print('hi')\n")
    assert workspace.list_files() == ["src/hello.py"]
    assert "print('hi')" in workspace.read_file("src/hello.py")


def test_delete_removes_file():
    workspace.write_file("a.txt", "x")
    workspace.delete_file("a.txt")
    assert workspace.list_files() == []


def test_traversal_escapes_are_rejected():
    for bad in ("../escape.py", "..\\escape.py", "sub/../../out.py", "a/b/../../../c.py"):
        with pytest.raises(ValueError):
            workspace.resolve(bad)
        with pytest.raises(ValueError):
            workspace.write_file(bad, "nope")
        with pytest.raises(ValueError):
            workspace.read_file(bad)


def test_absolute_paths_are_clamped_inside_the_workspace(isolated_workspace):
    """A leading slash must not reach the real filesystem root — it is
    treated as workspace-relative, so the write stays contained."""
    workspace.write_file("/etc/passwd", "not the real one")
    written = (isolated_workspace / "etc" / "passwd").resolve()
    assert written.exists()
    assert isolated_workspace.resolve() in written.parents


def test_cannot_read_outside_workspace(tmp_path):
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("classified", encoding="utf-8")
    with pytest.raises(ValueError):
        workspace.read_file("../secret.txt")


def test_run_file_executes_and_returns_output():
    workspace.write_file("run_me.py", "print('sandbox works')\n")
    out = workspace.run_file("run_me.py")
    assert "sandbox works" in out
    assert "exit code: 0" in out


def test_run_file_reports_errors_not_raises():
    workspace.write_file("boom.py", "raise RuntimeError('kaboom')\n")
    out = workspace.run_file("boom.py")
    assert "kaboom" in out
    assert "exit code: 1" in out


def test_run_file_times_out(monkeypatch):
    monkeypatch.setattr(workspace, "RUN_TIMEOUT_S", 3)
    workspace.write_file("spin.py", "while True:\n    pass\n")
    assert "Timed out" in workspace.run_file("spin.py")


def test_run_rejects_unsupported_types():
    workspace.write_file("notes.txt", "hello")
    with pytest.raises(ValueError):
        workspace.run_file("notes.txt")


def test_execute_returns_error_text_for_bad_input():
    assert workspace.execute("read_file", {"path": "../x"}).startswith("Error:")
    assert workspace.execute("nope", {}).startswith("Error:")


def test_write_file_creates_nested_folders():
    """Scaffolding a project must not need explicit mkdir calls."""
    workspace.write_file("myapp/src/index.js", "console.log(1)\n")
    assert workspace.list_files() == ["myapp/src/index.js"]


def test_create_folder_and_traversal_guard():
    workspace.create_folder("pkg/sub")
    assert (workspace.workspace_dir() / "pkg" / "sub").is_dir()
    with pytest.raises(ValueError):
        workspace.create_folder("../outside")


def test_run_command_executes_in_workspace():
    workspace.write_file("hello.txt", "hi")
    out = workspace.run_command("python -c \"import os; print(os.listdir('.'))\"")
    assert "hello.txt" in out
    assert "exit code: 0" in out


def test_run_command_reports_failures_and_needs_input():
    out = workspace.run_command("python -c \"raise SystemExit(3)\"")
    assert "exit code: 3" in out
    with pytest.raises(ValueError):
        workspace.run_command("   ")


def test_run_command_times_out():
    out = workspace.run_command("python -c \"import time; time.sleep(30)\"", timeout=3)
    assert "Timed out" in out


def test_zip_workspace_bundles_every_file():
    import zipfile

    workspace.write_file("app/main.py", "print('x')\n")
    workspace.write_file("README.md", "# hi\n")
    archive = workspace.zip_workspace()
    with zipfile.ZipFile(archive) as z:
        names = set(z.namelist())
    assert "app/main.py" in names and "README.md" in names


def test_clear_empties_the_workspace():
    workspace.write_file("a.py", "1")
    workspace.write_file("b/c.py", "2")
    workspace.clear_workspace()
    assert workspace.list_files() == []
