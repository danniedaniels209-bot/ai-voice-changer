"""
Script Analyzer — turns a raw script (plain text or Markdown) into typed,
ordered segments the planner can direct individually.

Detected structure: headings, paragraphs (split into sentences), bullet/
numbered list items, block quotes, fenced code blocks, inline dialogue
quotes. Detected per sentence: type (question/exclamation/command/statement),
emphasis words (ALL-CAPS *common* English words — rare all-caps words are
acronyms/tech, not shouting), and technical terms (rare-in-English words,
identifier shapes — same dictionary-free signals as context_recognition).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*)$")
_BLOCKQUOTE = re.compile(r"^\s*>\s?(.*)$")
_CODE_FENCE = re.compile(r"^\s*(```|~~~)")
_CAPS_WORD = re.compile(r"\b[A-Z]{3,}\b")
_QUOTED = re.compile(r"[\"“]([^\"”]{15,})[\"”]")

# Imperative openers: cheap, effective command detection for tutorial scripts.
_COMMAND_OPENERS = {
    "never", "always", "don't", "dont", "do", "avoid", "remember", "note",
    "click", "run", "install", "open", "use", "make", "create", "stop",
    "download", "select", "choose", "check", "try", "let's", "lets", "watch",
    "subscribe", "like", "follow", "imagine", "consider", "listen",
}


@dataclass
class Segment:
    id: int
    kind: str  # heading | sentence | list_item | quote | code | dialogue
    text: str
    sentence_type: str = "statement"  # statement | question | exclamation | command
    emphasis_words: list[str] = field(default_factory=list)
    tech_terms: list[str] = field(default_factory=list)
    paragraph_index: int = 0
    is_paragraph_end: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "text": self.text,
            "sentence_type": self.sentence_type,
            "emphasis_words": self.emphasis_words,
            "tech_terms": self.tech_terms,
            "paragraph_index": self.paragraph_index,
            "is_paragraph_end": self.is_paragraph_end,
        }


def _is_rare(word: str) -> bool:
    try:
        from wordfreq import zipf_frequency

        w = word.strip(".,!?()\"'").lower()
        return len(w) >= 3 and any(c.isalpha() for c in w) and zipf_frequency(w, "en") < 3.5
    except ImportError:
        return False


def _is_identifier_shaped(word: str) -> bool:
    w = word.strip(".,!?()\"'")
    return bool(
        (any(c.isdigit() for c in w) and any(c.isalpha() for c in w))
        or re.search(r"[a-z][A-Z]", w)
        or "." in w.rstrip(".")
    )


def _classify_sentence(text: str) -> str:
    stripped = text.strip()
    if stripped.endswith("?"):
        return "question"
    if stripped.endswith("!"):
        return "exclamation"
    first = stripped.split(maxsplit=1)[0].lower().strip(",:") if stripped else ""
    if first in _COMMAND_OPENERS:
        return "command"
    return "statement"


def _analyze_words(text: str) -> tuple[list[str], list[str]]:
    """Returns (emphasis_words, tech_terms) for one sentence."""
    emphasis: list[str] = []
    tech: list[str] = []
    for caps in _CAPS_WORD.findall(text):
        # ALL-CAPS + common English = emphasis ("EXTREMELY"); rare = acronym/tech.
        (tech if _is_rare(caps) else emphasis).append(caps)
    for word in re.findall(r"[A-Za-z][\w.+\-]*", text):
        if word.upper() == word and len(word) >= 3:
            continue  # handled above
        if _is_identifier_shaped(word) or _is_rare(word):
            if word not in tech:
                tech.append(word)
    return emphasis, tech


def analyze(script: str) -> list[Segment]:
    """Parses the full script into ordered segments with an internal plan-
    ready structure. Line-based first pass (headings/lists/quotes/code
    fences), then sentence splitting inside paragraphs."""
    segments: list[Segment] = []
    next_id = 0
    paragraph_index = 0

    def add(kind: str, text: str, stype: str | None = None) -> Segment:
        nonlocal next_id
        emphasis, tech = _analyze_words(text) if kind != "code" else ([], [])
        seg = Segment(
            id=next_id,
            kind=kind,
            text=text.strip(),
            sentence_type=stype or _classify_sentence(text),
            emphasis_words=emphasis,
            tech_terms=tech,
            paragraph_index=paragraph_index,
        )
        segments.append(seg)
        next_id += 1
        return seg

    lines = script.replace("\r\n", "\n").split("\n")
    in_code = False
    code_buf: list[str] = []
    para_buf: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph_index
        text = " ".join(para_buf).strip()
        para_buf.clear()
        if not text:
            return
        # Long inline quotes become their own segments (multi-voice target).
        remainder = text
        for quoted in _QUOTED.findall(text):
            before, _, after = remainder.partition(f'"{quoted}"')
            if before.strip():
                for s in _SENTENCE_SPLIT.split(before.strip()):
                    if s.strip():
                        add("sentence", s)
            add("dialogue", quoted)
            remainder = after
        for s in _SENTENCE_SPLIT.split(remainder.strip()):
            if s.strip():
                add("sentence", s)
        if segments:
            segments[-1].is_paragraph_end = True
        paragraph_index += 1

    for line in lines:
        if _CODE_FENCE.match(line):
            if in_code:
                add("code", "\n".join(code_buf), stype="statement")
                code_buf.clear()
                in_code = False
            else:
                flush_paragraph()
                in_code = True
            continue
        if in_code:
            code_buf.append(line)
            continue

        h = _HEADING.match(line)
        if h:
            flush_paragraph()
            add("heading", h.group(2), stype="statement")
            continue
        b = _BULLET.match(line)
        if b:
            flush_paragraph()
            add("list_item", b.group(1))
            continue
        q = _BLOCKQUOTE.match(line)
        if q:
            flush_paragraph()
            if q.group(1).strip():
                add("quote", q.group(1))
            continue
        if not line.strip():
            flush_paragraph()
            continue
        para_buf.append(line.strip())

    if in_code and code_buf:  # unterminated fence
        add("code", "\n".join(code_buf), stype="statement")
    flush_paragraph()
    return segments


def script_stats(script: str, segments: list[Segment]) -> dict:
    words = len(re.findall(r"\S+", script))
    speakable_words = sum(
        len(s.text.split()) for s in segments if s.kind != "code"
    )
    return {
        "words": words,
        "segments": len(segments),
        "code_blocks": sum(1 for s in segments if s.kind == "code"),
        "questions": sum(1 for s in segments if s.sentence_type == "question"),
        # ~150 spoken words/minute is standard narration pace.
        "estimated_duration_seconds": round(speakable_words / 150 * 60),
        "reading_time_seconds": round(words / 220 * 60),
    }
