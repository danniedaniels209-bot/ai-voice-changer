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

import os
import shutil
import subprocess
import sys
from pathlib import Path

from app.core.config import Paths
from app.core.logging import get_logger

logger = get_logger(__name__)

# Generous ceilings, not product limits: the work runs in a background task
# (see routes/coder.py) so nothing is bounded by an HTTP request. These only
# exist so a runaway loop eventually yields instead of hanging forever, and
# every one is overridable by env var.
RUN_TIMEOUT_S = int(os.environ.get("AVC_CODER_RUN_TIMEOUT_S", 3600))       # 1 h
CMD_TIMEOUT_S = int(os.environ.get("AVC_CODER_CMD_TIMEOUT_S", 7200))       # 2 h
MAX_FILE_CHARS = int(os.environ.get("AVC_CODER_MAX_FILE_CHARS", 400_000))
MAX_OUTPUT_CHARS = int(os.environ.get("AVC_CODER_MAX_OUTPUT_CHARS", 60_000))
MAX_LISTING = int(os.environ.get("AVC_CODER_MAX_LISTING", 5_000))
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


def create_folder(rel_path: str) -> str:
    path = resolve(rel_path)
    path.mkdir(parents=True, exist_ok=True)
    return f"Created folder {rel_path}."


def run_command(command: str, timeout: int | None = None) -> str:
    """
    Run a shell command with the workspace as its working directory — the
    agent's equivalent of a terminal, for scaffolding (mkdir, npx create-*),
    dependency installs (pip/npm), builds and test runs.

    Confined by cwd and a timeout, and it can only be reached through this
    workspace API; output is capped so a chatty build can't flood the model.
    """
    command = (command or "").strip()
    if not command:
        raise ValueError("run_command needs a command string.")
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=str(workspace_dir()),
            capture_output=True,
            text=True,
            timeout=timeout or CMD_TIMEOUT_S,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return f"Timed out after {timeout or CMD_TIMEOUT_S}s: {command}"

    parts = [f"$ {command}"]
    if proc.stdout.strip():
        parts.append(proc.stdout.strip())
    if proc.stderr.strip():
        parts.append(f"[stderr]\n{proc.stderr.strip()}")
    parts.append(f"exit code: {proc.returncode}")
    return "\n".join(parts)[-MAX_OUTPUT_CHARS:]


def zip_workspace() -> Path:
    """Bundle the whole workspace into a zip the user can download."""
    root = workspace_dir()
    archive_base = Paths.temp / "coder_workspace_export"
    for stale in Paths.temp.glob("coder_workspace_export.zip"):
        stale.unlink(missing_ok=True)
    return Path(shutil.make_archive(str(archive_base), "zip", root_dir=str(root)))


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
  -> Create or overwrite a file, creating any parent folders automatically
     (e.g. "myapp/src/index.js"). Always send the COMPLETE file, never a
     fragment or a diff.

create_folder(path: str)
  -> Make an empty directory (write_file already creates parents, so you
     rarely need this).

delete_file(path: str)
  -> Remove a file or folder from the workspace.

run_command(command: str)
  -> Run any shell command with the workspace as the working directory —
     your terminal. Use it to scaffold projects, install what's missing
     (pip install X, npm install X), build, and run tests. Returns
     stdout/stderr/exit code. Long installs are allowed (5 min limit).

run_file(path: str, args?: list)
  -> Shortcut to execute one .py or .js file and see its output.
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


def _t_create_folder(args: dict) -> str:
    return create_folder(str(args.get("path", "")))


def _t_run_command(args: dict) -> str:
    return run_command(str(args.get("command", "")))


TOOLS = {
    "list_files": _t_list,
    "read_file": _t_read,
    "write_file": _t_write,
    "create_folder": _t_create_folder,
    "delete_file": _t_delete,
    "run_command": _t_run_command,
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
