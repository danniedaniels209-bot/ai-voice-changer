"""
Subtitle engine: a style/animation data model shared (by field name) between
this package and frontend/src/types/subtitle.ts, plus renderers that turn a
SubtitleStyle + timed cues into either a live browser preview (frontend,
CSS-driven) or a burned-in export (ass_renderer.py, ASS override tags) —
both consuming the exact same style data so preview and export always match.
"""
