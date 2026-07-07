"""
AI Narration Studio — professional script-to-voice.

Modular per the architecture requirement; each stage is independent and
engine-agnostic so narration engines can be added without touching the rest:

    script_analyzer  — raw script -> structured, typed segments
    pronunciation    — text -> speakable text (numbers, units, URLs, acronyms)
    planner          — segments + mode + controls -> per-segment prosody plan
    engine           — plan -> audio (per-segment, cached: preview/regenerate)
    exporter         — assembled narration -> wav/mp3/flac/aac/ogg + subtitles
"""
