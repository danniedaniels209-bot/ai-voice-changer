"""
Tool Forge — the chat agent can create NEW tools for itself at runtime.

Flow: the agent asks for a tool by name + purpose -> the LLM writes a
single-file Python tool (stdlib only, `run(args: dict) -> str`, with a
self-test) -> the file is executed in a sandboxed subprocess (isolated
interpreter, temp working dir, hard timeout) -> only if its self-test prints
TESTS PASSED does it get registered under custom_tools/ and become callable
from chat. Broken or hanging code never enters the registry.

The sandbox is the user's own machine/session (same trust model as a code
interpreter): isolation protects the app from accidents — bad tools crashing
the server, filesystem clutter, infinite loops — not from the user attacking
themselves.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from app.core.config import Paths
from app.core.logging import get_logger

logger = get_logger(__name__)

NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,29}$")
TOOLS_DIR = Paths.root / "custom_tools"
_RUNNER = Path(__file__).parent / "_tool_runner.py"

BUILD_TIMEOUT_S = 120
RUN_TIMEOUT_S = 60
MAX_CODE_CHARS = 20_000
MAX_OUTPUT_CHARS = 4_000


def _sandbox_run(cmd: list[str], timeout: int) -> tuple[int, str, str]:
    """Run a command in an isolated interpreter inside a throwaway cwd."""
    with tempfile.TemporaryDirectory(prefix="toolforge_") as scratch:
        try:
            proc = subprocess.run(
                cmd,
                cwd=scratch,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors="replace",
            )
            return proc.returncode, proc.stdout or "", proc.stderr or ""
        except subprocess.TimeoutExpired:
            return -1, "", f"Timed out after {timeout}s (infinite loop?)."


def _strip_fences(code: str) -> str:
    m = re.search(r"```(?:python)?\s*\n(.*?)```", code, re.DOTALL)
    return (m.group(1) if m else code).strip()


def create_tool(name: str, purpose: str) -> str:
    """Generate, sandbox-test, and register a new tool. Returns a report."""
    from app.scriptgen import llm

    name = name.strip().lower()
    if not NAME_RE.match(name):
        raise ValueError(
            "Tool name must be 3-30 chars of lowercase letters/digits/underscores."
        )
    if not purpose.strip():
        raise ValueError("create_tool needs a purpose describing what it should do.")

    code = _strip_fences(
        llm.generate(
            "You write single-file Python tools. Python standard library ONLY — "
            "no pip packages, no network calls, no reading files outside the "
            "current directory.",
            f'Write a Python tool file for: {purpose}\n\n'
            "Requirements:\n"
            "1. A module docstring: one line saying what the tool does.\n"
            "2. Define run(args: dict) -> str — the tool's whole behavior.\n"
            "3. End with a self-test block:\n"
            '   if __name__ == "__main__":\n'
            "       call run() with 2-3 realistic sample args dicts,\n"
            "       assert the outputs are correct,\n"
            '       then print("TESTS PASSED")\n'
            "Return ONLY the Python code, no explanations.",
            max_new_tokens=2000,
        )
    )

    if "def run(" not in code:
        raise ValueError("Generated code has no run(args) function — try rephrasing the purpose.")
    if len(code) > MAX_CODE_CHARS:
        raise ValueError("Generated code is unreasonably large — try a narrower purpose.")

    # Build + self-test inside the sandbox before anything is registered.
    with tempfile.TemporaryDirectory(prefix="toolforge_build_") as build_dir:
        candidate = Path(build_dir) / f"{name}.py"
        candidate.write_text(code, encoding="utf-8")
        rc, out, err = _sandbox_run(
            [sys.executable, "-I", str(candidate)], timeout=BUILD_TIMEOUT_S
        )
        if rc != 0 or "TESTS PASSED" not in out:
            detail = (err or out).strip()[-MAX_OUTPUT_CHARS:]
            return (
                f"Tool '{name}' FAILED its sandbox test — it was NOT registered.\n"
                f"Output:\n{detail}\n"
                "You can retry create_tool with a clearer purpose."
            )

        TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        (TOOLS_DIR / f"{name}.py").write_text(code, encoding="utf-8")

    logger.info("Tool Forge registered custom tool '%s'", name)
    doc = next((l.strip().strip('"\'') for l in code.splitlines() if l.strip().startswith(('"""', "'''"))), "")
    return (
        f"Tool '{name}' built, tested in the sandbox (TESTS PASSED), and "
        f"registered. {doc}\nCall it with: run_custom_tool(name=\"{name}\", "
        "args={...})."
    )


def run_tool(name: str, args: dict) -> str:
    """Execute a registered custom tool in the sandbox and return its output."""
    name = name.strip().lower()
    if not NAME_RE.match(name):
        raise ValueError("Invalid tool name.")
    path = TOOLS_DIR / f"{name}.py"
    if not path.exists():
        raise ValueError(
            f"No custom tool named '{name}'. See list_custom_tools, or build "
            "it with create_tool."
        )
    rc, out, err = _sandbox_run(
        [sys.executable, "-I", str(_RUNNER), str(path), json.dumps(args or {})],
        timeout=RUN_TIMEOUT_S,
    )
    if rc != 0:
        return f"Error running '{name}': {(err or out).strip()[-MAX_OUTPUT_CHARS:]}"
    return out.strip()[-MAX_OUTPUT_CHARS:] or "(tool produced no output)"


def list_tools() -> str:
    if not TOOLS_DIR.exists():
        return "No custom tools yet. Build one with create_tool."
    lines = []
    for f in sorted(TOOLS_DIR.glob("*.py")):
        doc = ""
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            s = line.strip()
            if s.startswith(('"""', "'''")):
                doc = s.strip('"\'').strip()
                break
        lines.append(f"- {f.stem}: {doc or '(no description)'}")
    return "\n".join(lines) or "No custom tools yet. Build one with create_tool."
