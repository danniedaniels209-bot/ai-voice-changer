"""
Topic Analyzer / Outline Generator / Script Generator / Rewrite Engine —
prompt logic on top of the LLM runtime. Pure functions: settings in, text
out. Nothing here knows about narration.
"""

from __future__ import annotations

import re

from app.scriptgen import llm

# Target spoken-word counts per requested length (~150 words/minute).
LENGTH_WORDS = {
    "30s": 80, "1m": 150, "3m": 450, "5m": 750, "10m": 1500, "15m": 2200,
}

_SYSTEM = (
    "You are a professional script writer for {content_type} content. "
    "Audience: {audience}. Tone: {tone}. Write natural, spoken-style "
    "English meant to be read aloud by a narrator. Never include stage "
    "directions, camera notes, markdown emphasis, or emoji."
)


def _system(settings: dict) -> str:
    return _SYSTEM.format(
        content_type=settings.get("content_type", "YouTube"),
        audience=settings.get("audience", "general audience"),
        tone=settings.get("tone", "professional"),
    )


def outline(topic: str, settings: dict) -> list[str]:
    raw = llm.generate(
        _system(settings),
        f"Create an outline for a script about: {topic}\n\n"
        "Return ONLY 5 to 8 short section titles, one per line, no numbering, "
        "no explanations. Start with an introduction and end with a conclusion.",
        max_new_tokens=200,
    )
    lines = [re.sub(r"^[\d\-.*#)\s]+", "", l).strip() for l in raw.splitlines()]
    return [l for l in lines if l][:8]


def script(topic: str, outline_sections: list[str], settings: dict) -> str:
    words = LENGTH_WORDS.get(settings.get("length", "3m"), 450)
    per_section = max(40, words // max(len(outline_sections), 1))
    sections_text = "\n".join(f"- {s}" for s in outline_sections)
    raw = llm.generate(
        _system(settings),
        f"Write a complete narration script about: {topic}\n\n"
        f"Follow this outline exactly, one section per outline item:\n{sections_text}\n\n"
        f"Total length: about {words} words (~{per_section} words per section). "
        "Format each section as a markdown heading (# Title) followed by its "
        "narration paragraphs. Write ONLY the script.",
        max_new_tokens=min(4000, int(words * 2.2)),
    )
    return raw


# --- Rewrite Engine / Script Assistant --------------------------------------

ACTIONS: dict[str, str] = {
    "rewrite": "Rewrite the following text, keeping its meaning but improving flow:",
    "continue": "Continue writing naturally from where the following text ends. Return only the continuation:",
    "summarize": "Summarize the following text into a shorter narration passage:",
    "expand": "Expand the following text with more detail and examples, same style:",
    "simplify": "Simplify the language of the following text so beginners understand it:",
    "explain": "Rewrite the following text so it explains the concepts more clearly:",
    "engaging": "Rewrite the following text to be more engaging and energetic for viewers:",
    "technical": "Rewrite the following text with more technical depth and precision:",
    "grammar": "Fix grammar, clarity, and awkward phrasing in the following text. Change nothing else:",
    "change_tone": "Rewrite the following text in a {tone} tone:",
    "intro": "Write a strong opening/introduction for a script based on the following content. Return only the introduction:",
    "conclusion": "Write a strong conclusion for a script based on the following content. Return only the conclusion:",
    "cta": "Write a short call-to-action (subscribe/like/next steps) matching the following content. Return only the call to action:",
    "titles": "Suggest 8 compelling video titles for the following script. One per line:",
    "description": "Write a YouTube description (2 short paragraphs + 5 hashtags) for the following script:",
    "chapters": "Create YouTube chapter titles for the following script. Format: one short title per line in order:",
    "thumbnails": "Suggest 5 thumbnail concepts (short visual descriptions) for the following script. One per line:",
    "keywords": "List 15 SEO keywords/tags for the following script, comma-separated:",
}


def assist(action: str, text: str, settings: dict, tone: str | None = None) -> str:
    if action not in ACTIONS:
        raise ValueError(f"Unknown action '{action}'. Available: {', '.join(ACTIONS)}")
    instruction = ACTIONS[action].format(tone=tone or settings.get("tone", "professional"))
    return llm.generate(
        _system(settings),
        f"{instruction}\n\n{text[:8000]}",
        max_new_tokens=1500,
    )
