"""
Conversation context management for the long-running AI Chat agent loop.
Two problems this solves:

1. A long agent run appends a tool-call + tool-result pair to `messages`
   every iteration, so the prompt sent to the model grows every single
   generation call within one run. Combined with a growing chat history
   across turns, this is what actually exhausts a T4's VRAM (prefill memory
   scales with prompt length) — not leftover models, not the system prompt
   alone, but the conversation itself becoming enormous over a long session.

2. Simply truncating old messages would lose real information: requirements
   the user stated, decisions already made, files already produced. So
   instead of dropping the oldest messages, they are SUMMARIZED by the model
   itself into a compact brief before being dropped, preserving exactly
   what matters for continuing the work correctly.
"""

from __future__ import annotations

import os

from app.core.logging import get_logger

logger = get_logger(__name__)

# Compact once the running prompt would exceed this many (estimated) tokens.
BUDGET_TOKENS = int(os.environ.get("AVC_CONTEXT_BUDGET_TOKENS", 4000))
# Always keep at least this many of the most recent messages verbatim —
# summarizing something that just happened loses too much fidelity for the
# model to act on immediately.
KEEP_RECENT = int(os.environ.get("AVC_CONTEXT_KEEP_RECENT", 8))
SUMMARY_MAX_TOKENS = 700

_SUMMARY_INSTRUCTION = (
    "Summarize the conversation below into a compact brief for the same "
    "assistant to keep working from. Preserve exactly, as bullet points:\n"
    "- Requirements and constraints the user stated\n"
    "- Architectural/technical decisions already made, and why\n"
    "- Files already created or changed (just the names)\n"
    "- Unfinished work / explicit next steps\n"
    "Be terse. Do not invent anything not actually said or done. Do not "
    "include pleasantries or restate the assistant's own reasoning."
)


def estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // 4)


def _total_tokens(messages: list[dict]) -> int:
    return sum(estimate_tokens(m.get("content", "")) for m in messages)


def compact_if_needed(
    messages: list[dict],
    budget_tokens: int = BUDGET_TOKENS,
    keep_recent: int = KEEP_RECENT,
) -> list[dict]:
    """
    If `messages` (system message first, then the conversation) would exceed
    `budget_tokens`, summarize everything except the system message and the
    most recent `keep_recent` messages into one compact brief. Returns the
    original list unchanged if there's nothing worth compacting.
    """
    if not messages:
        return messages
    if _total_tokens(messages) <= budget_tokens:
        return messages

    has_system = messages[0].get("role") == "system"
    system = [messages[0]] if has_system else []
    body = messages[1:] if has_system else messages

    if len(body) <= keep_recent:
        return messages  # nothing old enough to summarize

    old, recent = body[:-keep_recent], body[-keep_recent:]
    if not old:
        return messages

    transcript = "\n\n".join(
        f"[{m.get('role', 'unknown')}]: {m.get('content', '')}" for m in old
    )

    try:
        from app.scriptgen import llm

        summary = llm.generate(
            "You compress conversation history accurately and tersely.",
            f"{_SUMMARY_INSTRUCTION}\n\n---\n{transcript}\n---",
            max_new_tokens=SUMMARY_MAX_TOKENS,
        )
    except Exception as exc:  # noqa: BLE001 — compaction must never crash a run
        logger.warning("Context summarization failed, falling back to a hard trim: %s", exc)
        # Degrade gracefully: keep the most recent messages only, with a
        # note that earlier context was dropped rather than summarized.
        summary = (
            f"({len(old)} earlier message(s) were dropped — summarization "
            "failed. Ask the user to restate anything important that's missing.)"
        )

    summary_message = {
        "role": "user",
        "content": (
            "<context_summary>\n"
            f"{summary.strip()}\n"
            "</context_summary>\n"
            "The above summarizes earlier parts of this conversation, "
            "compacted to save memory. Continue the work from here using it."
        ),
    }

    logger.info(
        "Compacted %d old message(s) (%d tokens) into a %d-token summary; kept %d recent",
        len(old), sum(estimate_tokens(m.get("content", "")) for m in old),
        estimate_tokens(summary), len(recent),
    )
    return system + [summary_message] + recent
