"""
Read-only project awareness for the AI Chat.

Lets the assistant answer "where do I find X?" / "how does Y work?" by
searching and reading THIS project's own source. Strictly read-only by
design — there is no write/edit/delete path here, and every access is
confined to the project root with symlinks resolved, so the model can
explain the app but can never modify it.

Heavy/irrelevant trees (node_modules, venvs, caches, media, user data) are
skipped so results stay useful and cheap.
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import Paths

# Directories never worth searching (dependencies, build output, user data).
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
    ".pytest_cache", ".ruff_cache", ".mypy_cache", "temp", "exports", "logs",
    "models", "ffmpeg", "custom_tools", ".idea", ".vscode",
}
# Only text/source files — never weights, media, or archives.
_ALLOWED_SUFFIXES = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json", ".md",
    ".txt", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".bat", ".sh",
}

MAX_FILE_CHARS = 20_000
MAX_MATCHES = 40
MAX_RESULT_CHARS = 6_000


def _iter_files():
    root = Paths.root
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in _SKIP_DIRS for part in path.relative_to(root).parts[:-1]):
            continue
        if path.suffix.lower() not in _ALLOWED_SUFFIXES:
            continue
        try:
            if path.stat().st_size > 1_000_000:  # skip huge generated files
                continue
        except OSError:
            continue
        yield path


def _safe_relative(rel_path: str) -> Path:
    """Resolve a user/model-supplied path INSIDE the project, or raise.
    Resolving first defeats '..' traversal and symlink escapes."""
    root = Paths.root.resolve()
    candidate = (root / rel_path.strip().lstrip("/\\")).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Path is outside the project.")
    if not candidate.is_file():
        raise ValueError(f"No such file in the project: {rel_path}")
    if candidate.suffix.lower() not in _ALLOWED_SUFFIXES:
        raise ValueError(f"Not a readable source file: {rel_path}")
    return candidate


def search_project(query: str) -> str:
    """Case-insensitive plain-text search across the project's source."""
    query = query.strip()
    if len(query) < 2:
        raise ValueError("search_project needs a query of at least 2 characters.")
    needle = query.lower()
    root = Paths.root
    lines_out: list[str] = []
    matches = 0

    for path in _iter_files():
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if needle not in text.lower():
            continue
        rel = path.relative_to(root).as_posix()
        for num, line in enumerate(text.splitlines(), start=1):
            if needle in line.lower():
                lines_out.append(f"{rel}:{num}: {line.strip()[:160]}")
                matches += 1
                if matches >= MAX_MATCHES:
                    break
        if matches >= MAX_MATCHES:
            lines_out.append("... (more matches truncated)")
            break

    if not lines_out:
        return f"No matches for '{query}' in the project source."
    return "\n".join(lines_out)[:MAX_RESULT_CHARS]


def read_project_file(rel_path: str) -> str:
    """Return the contents of one project source file (truncated if long)."""
    path = _safe_relative(rel_path)
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > MAX_FILE_CHARS:
        text = text[:MAX_FILE_CHARS] + "\n... (truncated)"
    return f"# {path.relative_to(Paths.root.resolve()).as_posix()}\n{text}"


def list_project_files(subdir: str = "") -> str:
    """List source files, optionally under a subdirectory."""
    root = Paths.root
    prefix = subdir.strip().strip("/\\").replace("\\", "/")
    rels = []
    for path in _iter_files():
        rel = path.relative_to(root).as_posix()
        if prefix and not rel.startswith(prefix):
            continue
        rels.append(rel)
    if not rels:
        return f"No source files found{f' under {prefix}' if prefix else ''}."
    rels.sort()
    shown = rels[:200]
    out = "\n".join(shown)
    if len(rels) > len(shown):
        out += f"\n... ({len(rels) - len(shown)} more)"
    return out[:MAX_RESULT_CHARS]
