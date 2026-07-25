r"""
Renders a SubtitleStyle + timed cues into a self-contained .ass file for
ffmpeg's `subtitles=` burn-in filter (app.services.ffmpeg_service already
treats any .ass file as carrying its own styling — see
_subtitles_filter_arg — so this plugs in with zero changes there).

libass (ffmpeg's ASS renderer) reference used throughout:
  - BorderStyle 1: text + outline + drop shadow (the normal case).
  - BorderStyle 3: text on an opaque box; Outline becomes the box's padding
    and BackColour is the box fill — this is how "Background Box" styles
    (e.g. CapCut) are done. True rounded corners aren't expressible this
    way; only the frontend's CSS preview renders real rounded corners.
  - the \k / \kf karaoke tags: SecondaryColour is the "not yet sung" color,
    PrimaryColour is what it becomes once the timer passes that syllable.
    \kf sweeps smoothly (a wipe) rather than switching instantly.
  - \t(...) transforms animate a tag's value over a time window relative
    to the event's own start — used here for the "pop" scale-in.
"""

from __future__ import annotations

from pathlib import Path

from app.subtitle_engine.models import SubtitleCue, SubtitleStyle
from app.subtitle_engine.timing import effective_words

_ALIGNMENT = {"bottom": 2, "center": 5, "top": 8}

# Typewriter reveals character-by-character; capped so a long line can't
# blow up the file with thousands of near-identical events.
_MAX_TYPEWRITER_STEPS = 60


def _ass_time(seconds: float) -> str:
    cs = max(0, int(round(seconds * 100)))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _hex_to_bgr(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"{b}{g}{r}"


def _ass_color(hex_color: str, opacity: float = 1.0) -> str:
    """'#RRGGBB' + opacity(0-1) -> ASS '&HAABBGGRR&' (alpha 00=opaque)."""
    alpha = round((1.0 - max(0.0, min(1.0, opacity))) * 255)
    return f"&H{alpha:02X}{_hex_to_bgr(hex_color)}&"

def _escape(text: str) -> str:
    return text.replace("{", "").replace("}", "").replace("\\", "").replace("\n", " ")


def _style_line(style: SubtitleStyle) -> str:
    t, sh, bg = style.text, style.shadow, style.background
    boxed = bg.shape == "box"
    primary = _ass_color(t.active_color or t.color, t.opacity)
    secondary = _ass_color(t.color, t.opacity)
    outline_colour = _ass_color(style.stroke.color, 1.0)
    back_colour = (
        _ass_color(bg.color, bg.opacity) if boxed else _ass_color(sh.color, sh.opacity)
    )
    border_style = 3 if boxed else 1
    outline = (round((bg.padding_x + bg.padding_y) / 2) if boxed else style.stroke.width)
    shadow = 0 if boxed else max(sh.offset_x, sh.offset_y)
    alignment = _ALIGNMENT[style.position.anchor]
    return (
        f"Style: Main,{style.text.font_family},{t.font_size},{primary},{secondary},"
        f"{outline_colour},{back_colour},{-1 if t.font_weight >= 700 else 0},"
        f"{-1 if t.italic else 0},{-1 if t.underline else 0},0,100,100,"
        f"{t.letter_spacing},0,{border_style},{outline},{shadow},{alignment},"
        f"40,40,{round(style.position.margin)},1"
    )


def _header(style: SubtitleStyle) -> str:
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1920\nPlayResY: 1080\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"{_style_line(style)}\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _dialogue(start: float, end: float, text: str) -> str:
    return f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Main,,0,0,0,,{text}\n"


def _pop_tag(duration_ms: int) -> str:
    if duration_ms <= 0:
        return ""
    d1 = round(duration_ms * 0.6)
    return f"{{\\fscx60\\fscy60\\t(0,{d1},\\fscx112\\fscy112)\\t({d1},{duration_ms},\\fscx100\\fscy100)}}"


def _animated_line_events(cue: SubtitleCue, style: SubtitleStyle) -> list[str]:
    anim = style.animation
    text = _escape(cue.text)
    if anim.type == "fade" and anim.duration_ms > 0:
        return [_dialogue(cue.start, cue.end, f"{{\\fad({anim.duration_ms},{anim.duration_ms})}}{text}")]
    if anim.type == "pop":
        return [_dialogue(cue.start, cue.end, f"{_pop_tag(anim.duration_ms)}{text}")]
    if anim.type == "typewriter":
        n = min(len(text), _MAX_TYPEWRITER_STEPS) or 1
        duration = max(cue.end - cue.start, 0.05)
        events = []
        for i in range(1, n + 1):
            step_start = cue.start + duration * (i - 1) / n
            step_end = cue.start + duration * i / n if i < n else cue.end
            reveal_at = round(len(text) * i / n)
            events.append(_dialogue(step_start, step_end, text[:reveal_at]))
        return events
    return [_dialogue(cue.start, cue.end, text)]


def _word_events(cue: SubtitleCue, style: SubtitleStyle) -> list[str]:
    events = []
    for w in effective_words(cue):
        if w.end <= w.start:
            continue
        text = _escape(w.text)
        tag = _pop_tag(style.animation.duration_ms) if style.animation.type == "pop" else ""
        events.append(_dialogue(w.start, w.end, f"{tag}{text}"))
    return events


def _karaoke_event(cue: SubtitleCue) -> list[str]:
    words = effective_words(cue)
    if not words:
        return []
    parts = []
    for w in words:
        cs = max(1, round((w.end - w.start) * 100))
        parts.append(f"{{\\kf{cs}}}{_escape(w.text)}")
    return [_dialogue(cue.start, cue.end, " ".join(parts))]


def _highlight_events(cue: SubtitleCue, style: SubtitleStyle) -> list[str]:
    words = effective_words(cue)
    if not words:
        return []
    base = _ass_color(style.text.color, style.text.opacity)
    active = _ass_color(style.text.active_color or style.text.color, style.text.opacity)
    events = []
    for i, w in enumerate(words):
        if w.end <= w.start:
            continue
        segs = []
        for j, other in enumerate(words):
            token = _escape(other.text)
            segs.append(f"{{\\c{active}}}{token}{{\\c{base}}}" if j == i else token)
        events.append(_dialogue(w.start, w.end, " ".join(segs)))
    return events


def render_ass(cues: list[SubtitleCue], style: SubtitleStyle, output_path: Path) -> Path:
    """Writes a complete .ass file for `cues` styled as `style`. Cues
    without any populated `.words` use the proportional fallback
    automatically (see timing.effective_words) — real per-word timing from
    word_align.align_words() is used transparently when present."""
    lines = [_header(style)]
    for cue in cues:
        if not cue.text.strip():
            continue
        if style.word_mode == "line":
            lines.extend(_animated_line_events(cue, style))
        elif style.word_mode == "word":
            lines.extend(_word_events(cue, style))
        elif style.word_mode == "karaoke":
            lines.extend(_karaoke_event(cue))
        elif style.word_mode == "highlight":
            lines.extend(_highlight_events(cue, style))
        else:
            raise ValueError(f"Unknown word_mode: {style.word_mode!r}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("".join(lines), encoding="utf-8")
    return output_path
