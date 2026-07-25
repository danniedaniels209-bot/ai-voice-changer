"""
The Coder agent's engineering standards — split into a small always-loaded
core plus specialized protocol sections retrieved dynamically per task.

Why: the source document (SYSTEM_PROMPT.md) is ~68 sections and ~8,500
tokens. Sending all of it on every single generation call was measured to
be a real cause of CUDA out-of-memory on a shared T4 (see git history) —
prefill memory scales with prompt length, and an 8,500-token system prompt
alone can cost several GB before the model has generated a single word.

The fix keeps every capability (nothing in SYSTEM_PROMPT.md is edited or
removed) but stops sending irrelevant sections: a small CORE of
behavior-governing rules (objectives, security, loop/completion control,
communication) is always included, and the rest (React, Python, DevOps,
databases, UI, testing, ...) is pulled in only when the current task or the
files already in the workspace suggest it's relevant.

Source of truth is still SYSTEM_PROMPT.md, read fresh from disk every call
and never hand-edited — this module only decides which of its sections to
include for a given task.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_PROMPT_FILE = Path(__file__).parent / "prompts" / "SYSTEM_PROMPT.md"

# Matches both delimiter styles the source file actually uses:
#   ========================================
#   HEADING
#   ========================================
# and
#   **========================================**
#   **HEADING**
#   **========================================**
_SECTION_RE = re.compile(
    r"\*{0,2}=+\*{0,2}\s*\n+\*{0,2}([A-Za-z][A-Za-z /\-]+?)\*{0,2}\s*\n+\*{0,2}=+\*{0,2}"
)

# Behavior-governing rules relevant to EVERY task, regardless of language or
# framework — these are always sent. Deliberately small: this is the whole
# point of the split.
CORE_HEADINGS = [
    "PRIMARY OBJECTIVES",
    "GENERAL BEHAVIOR",
    "SECURITY",
    "ERROR HANDLING",
    "COMMUNICATION STYLE",
    "LIMITATIONS",
    "ARTIFACT POLICY",
    "TASK COMPLETION PROTOCOL",
    "COMPLETION CHECK",
    "DO NOT LOOP",
    "SUCCESS CONDITIONS",
    "FINAL DELIVERY",
    "TOOL TERMINATION",
    "SELF-AWARENESS",
    "FAILURE RECOVERY",
    "ENGINEERING PRINCIPLE",
]

# Specialized sections -> trigger keywords (matched against the user's
# current message + the workspace's file names/extensions, case-insensitive).
# A heading not listed here (e.g. exact duplicates, or generic ones covered
# by CORE) is still retrievable, just never auto-triggers.
PROTOCOL_KEYWORDS: dict[str, list[str]] = {
    "CODING STYLE": ["code style", "clean code", "style guide"],
    "WHEN WRITING CODE": ["write", "implement", "build", "create", "add"],
    "DEBUGGING": ["bug", "error", "crash", "traceback", "exception", "debug", "broken", "fix", "not working"],
    "REFACTORING": ["refactor", "clean up", "restructure", "simplify"],
    "REFACTORING PROTOCOL": ["refactor", "clean up", "restructure", "simplify"],
    "PERFORMANCE": ["performance", "slow", "optimize", "speed up", "latency", "memory usage"],
    "API DEVELOPMENT": ["api", "endpoint", "rest", "graphql", "route"],
    "DATABASES": ["database", "sql", "query", "schema", "migration", ".sql", "postgres", "mysql", "sqlite", "mongo"],
    "FRONTEND": ["frontend", "ui", "component", "css", "html", ".css", ".html"],
    "REACT": ["react", ".jsx", ".tsx", "hook", "usestate", "useeffect", "component"],
    "PYTHON": ["python", ".py", "pip", "django", "flask", "fastapi"],
    "JAVASCRIPT/TYPESCRIPT": ["javascript", "typescript", ".js", ".ts", ".jsx", ".tsx", "node", "npm", "package.json"],
    "FLUTTER": ["flutter", "dart", ".dart", "pubspec"],
    "MOBILE DEVELOPMENT": ["mobile", "android", "ios", "flutter", "react native"],
    "DEVOPS": ["docker", "kubernetes", "k8s", "ci/cd", "github actions", "gitlab ci", "terraform", "nginx", "dockerfile", "deploy"],
    "GIT": ["git ", "commit", "branch", "merge", "pull request", ".gitignore"],
    "TESTING": ["test", "pytest", "jest", "unit test", "integration test", "spec.", "_test."],
    "DOCUMENTATION": ["readme", "document", "docs", "documentation"],
    "WHEN USER PROVIDES CODE": ["review", "explain", "look at", "this code"],
    "WHEN USER ASKS FOR A PROJECT": ["build a", "create a", "make a", "app", "project", "scaffold"],
    "ARTIFACT GENERATION PROTOCOL": ["build a", "create a", "make a", "app", "project", "scaffold"],
    "SINGLE FILE GENERATION PROTOCOL": ["script", "one file", "single file"],
    "DEPENDENCY REPORT": ["install", "dependency", "package", "requirements.txt", "pip install", "npm install"],
    "RUNNING THE PROJECT": ["run", "how do i start", "how to run", "launch"],
    "ARCHITECTURE REPORT": ["architecture", "how it works", "design", "structure"],
    "PLANNING PROTOCOL": ["plan", "design first", "before you start"],
    "AUTONOMOUS ENGINEERING PROTOCOL": ["improve", "clean up", "make it better"],
    "REPOSITORY AWARENESS": ["existing code", "existing project", "this repo", "this codebase"],
    "UI DESIGN PROTOCOL": ["ui", "design", "layout", "interface", "css"],
    "UX PROTOCOL": ["ux", "user experience", "usability", "flow"],
    "ACCESSIBILITY PROTOCOL": ["accessibility", "a11y", "screen reader", "aria", "contrast"],
    "CODE REVIEW PROTOCOL": ["review", "code review", "audit"],
    "TERMINAL COMMAND PROTOCOL": ["run command", "terminal", "shell", "cli", "command line"],
    "ERROR RECOVERY PROTOCOL": ["fix", "error", "broken", "failing", "crash"],
    "MODERN FRAMEWORK PROTOCOL": ["latest", "modern", "best practice", "framework"],
    "DEPLOYMENT PROTOCOL": ["deploy", "production", "hosting", "release"],
    "SOFTWARE ARCHITECT PROTOCOL": ["architecture", "design pattern", "scalab"],
}

_cache: dict[str, str] | None = None
_cache_mtime: float | None = None


def _parse_sections(raw: str) -> dict[str, str]:
    """Split the source file into {heading: body}. Later duplicate headings
    overwrite earlier ones — the file's two genuinely-duplicated sections
    are byte-identical, so this only removes redundant repeats, no content
    is lost."""
    matches = list(_SECTION_RE.finditer(raw))
    sections: dict[str, str] = {}
    for i, m in enumerate(matches):
        heading = re.sub(r"\s+", " ", m.group(1)).strip().upper()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(raw)
        body = raw[start:end].strip()
        if body:
            sections[heading] = body
    return sections


def _sections() -> dict[str, str]:
    """Parsed sections, re-read whenever the source file changes on disk."""
    global _cache, _cache_mtime
    try:
        mtime = _PROMPT_FILE.stat().st_mtime
    except OSError:
        return {}
    if _cache is None or _cache_mtime != mtime:
        _cache = _parse_sections(_PROMPT_FILE.read_text(encoding="utf-8"))
        _cache_mtime = mtime
    return _cache


def select_specialized(context_text: str, workspace_files: list[str] | None = None) -> list[str]:
    """Which specialized headings are relevant to the current task, judged
    from the latest user message and the file names already in the
    workspace. Order matches the source document."""
    haystack = (context_text or "").lower()
    for f in workspace_files or []:
        haystack += " " + f.lower()

    sections = _sections()
    hits = []
    for heading, keywords in PROTOCOL_KEYWORDS.items():
        if heading not in sections:
            continue
        if any(kw in haystack for kw in keywords):
            hits.append(heading)
    return hits


def build_prompt(context_text: str, workspace_files: list[str] | None = None) -> tuple[str, list[str]]:
    """The system prompt for one agent run: CORE always, plus whichever
    specialized sections the task/workspace suggest. Returns (prompt text,
    headings actually included) — the second value is for logging/tests, so
    it's easy to see what a given task pulled in."""
    mode = os.environ.get("AVC_CODER_PROTOCOL_MODE", "dynamic").strip().lower()
    sections = _sections()
    if not sections:
        return CORE, ["CORE (fallback — SYSTEM_PROMPT.md unreadable)"]

    if mode == "core":
        included = [h for h in CORE_HEADINGS if h in sections]
    elif mode == "full":
        included = list(sections.keys())
    else:
        core = [h for h in CORE_HEADINGS if h in sections]
        specialized = select_specialized(context_text, workspace_files)
        # De-dupe while preserving order (core first, then specialized).
        included = list(dict.fromkeys(core + specialized))

    parts = [
        f"{'=' * 40}\n{heading}\n{'=' * 40}\n{sections[heading]}" for heading in included
    ]
    prompt = "\n\n".join(parts) + "\n\n" + _RUNTIME_NOTE
    return prompt, included


# Condensed fallback — used only if SYSTEM_PROMPT.md is missing from disk.
CORE = """\
You are an elite software engineering AI assistant: senior engineer,
architect, DevOps, security engineer, technical writer and debugger combined.

PRIORITIES, in order: correctness, reliability, security, readability,
performance, maintainability, developer experience. Never sacrifice
correctness for speed. If uncertain, state assumptions instead of inventing
facts — never fabricate libraries, APIs, benchmarks or framework behaviour.

CODE: clean, idiomatic, modular, reusable, well structured. Descriptive
names. No magic numbers, duplicate logic, dead code, deep nesting, or
pointless comments. Consider edge cases, validate inputs, handle errors,
never swallow exceptions silently, use secure defaults.

DELIVER, DON'T DESCRIBE: if asked to build something, build it. Create every
necessary file and folder with complete implementations — no placeholders,
no "// remaining implementation". Generated code should run with minimal
setup: imports, exports, config, package files, env examples, routing and
setup code all included.

EDITING: read code before changing it. Respect the existing architecture,
naming and style. Preserve behaviour unless asked to change it. Prefer
targeted edits over rewriting whole files. Minimise breaking changes.

SECURITY: never hardcode secrets or keys — use environment variables. Guard
against injection, XSS, CSRF, weak authn/authz, unsafe file handling; encode
output; validate input; rate-limit where relevant.

FINISH: the highest-quality run is the shortest one that correctly completes
the objective. When the work is done, stop calling tools and deliver.
"""

_RUNTIME_NOTE = """
Note: wherever the protocol above says to "present", "show", or "deliver" a
generated file, that means call the write_file tool so it becomes a real
file in the workspace the user can open and download — not pasting the code
as a fenced block in your chat reply. A code block in the conversation is
not a delivered artifact here; only a tool call creates one.

Note: this run's tool loop also enforces the DO NOT LOOP / TASK COMPLETION
rules above automatically — repeating an identical action pauses the run for
you even if you don't self-correct, and the runtime periodically asks you,
out of band, whether the task is actually finished rather than relying on
you to remember.

Other engineering protocols (React, Python, testing, DevOps, UI/UX, etc.)
are available and apply even when not shown below — they're loaded only
when relevant to save context space, not because they don't apply. If a
task clearly needs a protocol you don't see, ask, or proceed using the same
professional standards shown here (clean, tested, secure, complete).
"""


def text() -> str:
    """The FULL protocol document, verbatim, read fresh every call. Used
    where the whole document (not a task-scoped subset) is wanted."""
    if os.environ.get("AVC_CODER_FULL_PROTOCOL", "1") == "0":
        return CORE
    try:
        return _PROMPT_FILE.read_text(encoding="utf-8") + _RUNTIME_NOTE
    except OSError:
        return CORE
