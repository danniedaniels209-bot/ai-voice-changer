"""
SRT subtitle writer. Segments come from Whisper transcription (TTS mode) or
from the synthesized narration placements (script mode), so subtitles always
match what is actually spoken in the exported video.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SubtitleCue:
    start: float  # seconds
    end: float
    text: str


def _format_timestamp(seconds: float) -> str:
    """SRT timestamp: HH:MM:SS,mmm"""
    ms = max(0, int(round(seconds * 1000)))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_word_pop_ass(cues: list[SubtitleCue], output_path: Path) -> Path:
    """
    Word-by-word "pop" captions (Shorts/TikTok style) as an ASS subtitle
    file for burning: each word appears alone, big and centered, timed by
    splitting its cue's duration proportionally to word length. The
    synthesis engines don't report per-word timing, so proportional split
    is the honest approximation — at word-level granularity it tracks the
    real pacing closely.
    """
    def _ass_time(seconds: float) -> str:
        cs = max(0, int(round(seconds * 100)))
        h, rem = divmod(cs, 360000)
        m, rem = divmod(rem, 6000)
        s, cs = divmod(rem, 100)
        return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1920\nPlayResY: 1080\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, "
        "Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Pop,Arial,110,&H00FFFFFF,&H00000000,&H80000000,-1,0,1,6,2,2,60,60,120,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    lines = [header]
    for cue in cues:
        words = cue.text.split()
        if not words:
            continue
        total_chars = sum(len(w) for w in words) or 1
        duration = max(cue.end - cue.start, 0.2)
        t = cue.start
        for w in words:
            share = duration * (len(w) / total_chars)
            end = min(t + share, cue.end)
            safe = w.replace("{", "").replace("}", "").replace("\\", "")
            lines.append(
                f"Dialogue: 0,{_ass_time(t)},{_ass_time(end)},Pop,,0,0,0,,{safe}\n"
            )
            t = end

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("".join(lines), encoding="utf-8")
    return output_path


def write_srt(cues: list[SubtitleCue], output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for i, cue in enumerate(cues, start=1):
        lines.append(str(i))
        lines.append(f"{_format_timestamp(cue.start)} --> {_format_timestamp(cue.end)}")
        lines.append(cue.text.strip())
        lines.append("")
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path
