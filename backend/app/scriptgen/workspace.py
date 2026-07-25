"""
Coder workspace — an isolated scratch directory the AI may READ AND WRITE.

Deliberately separate from `codebase.py` (which exposes THIS app's source
read-only): everything here is confined to temp/coder_workspace, so the
assistant can create, edit and run the user's uploaded files without any
path into the application's own code. Every path is resolved before use, so
'..' and symlink escapes are rejected rather than followed.

Execution happens in a subprocess with an isolated interpreter, the
workspace as its working directory, and a hard timeout — the same sandbox
discipline the Tool Forge uses.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from app.core.config import Paths
from app.core.logging import get_logger

logger = get_logger(__name__)

RUN_TIMEOUT_S = 60
MAX_FILE_CHARS = 40_000
MAX_OUTPUT_CHARS = 8_000
MAX_LISTING = 400
# Text-ish files the assistant may read/write. Uploads of other types are
# stored but not opened as text.
_TEXT_SUFFIXES = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css",
    ".html", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".csv", ".sh", ".bat",
    ".sql", ".env", ".xml", ".java", ".c", ".cpp", ".h", ".go", ".rs", ".rb",
    ".php", ".swift", ".kt", ".r", ".jl", ".lua", ".pl", ".dockerfile", "",
}


def workspace_dir() -> Path:
    d = Paths.temp / "coder_workspace"
    d.mkdir(parents=True, exist_ok=True)
    return d


def resolve(rel_path: str, *, must_exist: bool = False) -> Path:
    """Resolve a path INSIDE the workspace or raise. Resolution happens
    before the containment check, so traversal and symlinks can't escape."""
    root = workspace_dir().resolve()
    cleaned = (rel_path or "").strip().replace("\\", "/").lstrip("/")
    if not cleaned:
        raise ValueError("A file path is required.")
    candidate = (root / cleaned).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Path is outside the coder workspace.")
    if must_exist and not candidate.exists():
        raise ValueError(f"No such file in the workspace: {cleaned}")
    return candidate


def list_files() -> list[str]:
    root = workspace_dir().resolve()
    out: list[str] = []
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out.append(p.relative_to(root).as_posix())
            if len(out) >= MAX_LISTING:
                break
    return out


def read_file(rel_path: str) -> str:
    path = resolve(rel_path, must_exist=True)
    if path.suffix.lower() not in _TEXT_SUFFIXES:
        raise ValueError(f"'{rel_path}' is not a text file.")
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > MAX_FILE_CHARS:
        text = text[:MAX_FILE_CHARS] + "\n... (truncated)"
    return text


def write_file(rel_path: str, content: str) -> str:
    path = resolve(rel_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return f"Wrote {len(content)} characters to {rel_path}."


def delete_file(rel_path: str) -> str:
    path = resolve(rel_path, must_exist=True)
    if path.is_dir():
        shutil.rmtree(path)
        return f"Deleted directory {rel_path}."
    path.unlink()
    return f"Deleted {rel_path}."


def clear_workspace() -> None:
    root = workspace_dir()
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)


def run_file(rel_path: str, args: list[str] | None = None) -> str:
    """Execute a Python or Node file inside the workspace sandbox."""
    path = resolve(rel_path, must_exist=True)
    suffix = path.suffix.lower()
    if suffix == ".py":
        cmd = [sys.executable, "-I", str(path)]
    elif suffix in (".js", ".mjs", ".cjs"):
        node = shutil.which("node")
        if not node:
            return "Node.js is not installed in this session — cannot run .js files."
        cmd = [node, str(path)]
    else:
        raise ValueError("Only .py and .js files can be run.")
    cmd += [str(a) for a in (args or [])]

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(workspace_dir()),
            capture_output=True,
            text=True,
            timeout=RUN_TIMEOUT_S,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return f"Timed out after {RUN_TIMEOUT_S}s (infinite loop?)."

    parts = []
    if proc.stdout.strip():
        parts.append(f"stdout:\n{proc.stdout.strip()}")
    if proc.stderr.strip():
        parts.append(f"stderr:\n{proc.stderr.strip()}")
    parts.append(f"exit code: {proc.returncode}")
    return "\n\n".join(parts)[-MAX_OUTPUT_CHARS:]


# --- Tool registry for the coder chat loop ---------------------------------

TOOL_SPECS = """
list_files()
  -> Every file currently in the workspace.

read_file(path: str)
  -> The contents of one workspace file.

write_file(path: str, content: str)
  -> Create or overwrite a workspace file with the full new content.
     Always send the COMPLETE file, not a fragment.

delete_file(path: str)
  -> Remove a file or folder from the workspace.

run_file(path: str, args?: list)
  -> Execute a .py (or .js if Node is available) file in the sandbox and
     return its stdout/stderr/exit code. Use it to test what you wrote.
""".strip()


def _t_list(args: dict) -> str:
    files = list_files()
    return "\n".join(files) if files else "The workspace is empty."


def _t_read(args: dict) -> str:
    return read_file(str(args.get("path", "")))


def _t_write(args: dict) -> str:
    content = args.get("content")
    if not isinstance(content, str):
        raise ValueError("write_file needs 'content' as a string.")
    return write_file(str(args.get("path", "")), content)


def _t_delete(args: dict) -> str:
    return delete_file(str(args.get("path", "")))


def _t_run(args: dict) -> str:
    raw = args.get("args")
    return run_file(str(args.get("path", "")), raw if isinstance(raw, list) else None)


TOOLS = {
    "list_files": _t_list,
    "read_file": _t_read,
    "write_file": _t_write,
    "delete_file": _t_delete,
    "run_file": _t_run,
}


def execute(name: str, args: dict) -> str:
    """Run one workspace tool; errors return as text so the model recovers."""
    if name not in TOOLS:
        return f"Error: unknown tool '{name}'."
    try:
        return TOOLS[name](args)
    except ValueError as exc:
        return f"Error: {exc}"
    except Exception as exc:  # noqa: BLE001 — surface anything to the model
        return f"Error: {type(exc).__name__}: {exc}"
