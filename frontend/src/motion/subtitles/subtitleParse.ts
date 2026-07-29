/**
 * SRT / WebVTT reader.
 *
 * This repo could already WRITE subtitles (backend/app/utils/subtitles.py
 * write_srt) and could already RENDER them (subtitle_engine + the
 * SubtitleFrame live preview), but nothing anywhere could read a subtitle
 * file back in. That's the missing half that kept the subtitle engine and
 * Motion Studio disconnected, so it lives here rather than in the backend:
 * the import is a pure client-side text parse with no server round trip,
 * which also means it adds nothing to the wire format (no new pydantic
 * fields, no --reload trap).
 *
 * Output is `SubtitleCue[]` from types/subtitle.ts — the SAME cue type the
 * subtitle engine's own renderers consume — so anything that already knows
 * how to draw a cue can draw these, and subtitleLayers.ts is the only piece
 * that needs to know about Motion Studio at all.
 */

import type { SubtitleCue } from "../../types/subtitle";

export interface ParseResult {
  cues: SubtitleCue[];
  /** Non-fatal problems, surfaced to the user rather than swallowed. A file
   *  that is 90% parseable should import its 90% AND say what it dropped —
   *  silently importing fewer captions than the file contains is the kind
   *  of failure nobody notices until the export is already published. */
  warnings: string[];
  format: "srt" | "vtt" | "unknown";
}

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` / `MM:SS.mmm` (VTT) → seconds.
 *  Returns null on anything it can't read, so the caller can report the
 *  line number instead of quietly producing a cue at t=0. */
export function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  // A 1- or 2-digit fraction in VTT means tenths/hundredths, not
  // thousandths: "00:01.5" is 1.5s, not 1.005s.
  const msNum = Number(ms.padEnd(3, "0"));
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + msNum / 1000;
}

const ARROW = /-{2,}>/;

/** Strip the inline markup both formats allow but a plain text layer can't
 *  express: HTML-ish tags (<i>, <b>, <font color=…>), VTT voice/class spans
 *  (<v Narrator>, <c.loud>), and ASS override blocks ({\an8}) that leak in
 *  from tools that write .srt with positioning tags. The text is kept, only
 *  the markup goes. */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .trim();
}

/** Parse SRT or WebVTT. Format is detected from the content, not the file
 *  extension — plenty of ".txt" files are really SRT, and the two grammars
 *  differ only in the fraction separator and an optional header, so one
 *  parser handles both honestly. */
export function parseSubtitles(source: string): ParseResult {
  const warnings: string[] = [];
  // Strip a UTF-8 BOM (Notepad and most Windows subtitle tools write one —
  // left in place it becomes part of the first cue's index and the whole
  // first block fails to parse) and normalise line endings.
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  const isVtt = /^\s*WEBVTT/.test(text);
  const format: ParseResult["format"] = isVtt ? "vtt" : /-{2,}>/.test(text) ? "srt" : "unknown";
  if (format === "unknown") {
    return { cues: [], warnings: ["No subtitle timing lines (`-->`) found — is this an .srt or .vtt file?"], format };
  }

  const lines = text.split("\n");
  const cues: SubtitleCue[] = [];
  let i = 0;
  // VTT NOTE/STYLE/REGION blocks carry no cues; skipping them by name is
  // more robust than trying to detect them structurally.
  const VTT_BLOCK = /^(NOTE|STYLE|REGION)\b/;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || /^\s*WEBVTT/.test(line)) {
      i++;
      continue;
    }
    if (isVtt && VTT_BLOCK.test(line.trim())) {
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }

    // A cue is: [optional id line] timing line, then text until a blank line.
    let timingIndex = -1;
    if (ARROW.test(line)) {
      timingIndex = i;
    } else if (i + 1 < lines.length && ARROW.test(lines[i + 1])) {
      timingIndex = i + 1;
    } else {
      warnings.push(`Line ${i + 1}: expected a timing line, skipped "${line.trim().slice(0, 40)}"`);
      i++;
      continue;
    }

    const [rawStart, rawEndAndSettings] = lines[timingIndex].split(ARROW);
    // VTT allows cue settings after the end time ("... --> ... line:90% align:center").
    // We read the time and drop the settings: position is decided by the
    // Motion Studio style preset, and honouring half of a positioning
    // system would be worse than honouring none of it.
    const rawEnd = (rawEndAndSettings ?? "").trim().split(/\s+/)[0] ?? "";
    const start = parseTimestamp(rawStart ?? "");
    const end = parseTimestamp(rawEnd);

    i = timingIndex + 1;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      body.push(lines[i]);
      i++;
    }

    if (start === null || end === null) {
      warnings.push(`Line ${timingIndex + 1}: unreadable timestamp "${lines[timingIndex].trim().slice(0, 60)}"`);
      continue;
    }
    // Keep the newlines: they are the author's intended line breaks, and
    // wrapTextToLines honours '\n' as a hard break.
    const cueText = stripMarkup(body.join("\n"));
    if (cueText === "") {
      warnings.push(`Line ${timingIndex + 1}: cue has no text, skipped`);
      continue;
    }
    if (end <= start) {
      warnings.push(
        `Line ${timingIndex + 1}: end (${end}s) is not after start (${start}s), skipped "${cueText.slice(0, 30)}"`,
      );
      continue;
    }

    cues.push({ id: `cue-${cues.length + 1}`, start, end, text: cueText, words: [] });
  }

  // Sort by start time. findActiveCue() in subtitle/timing.ts binary-searches
  // and documents that it assumes sorted input, so an out-of-order file must
  // be fixed here rather than becoming a mystery later.
  cues.sort((a, b) => a.start - b.start);

  // Overlaps are reported, NOT auto-trimmed. Two captions on screen at once
  // is legal (and some files do it deliberately); silently shortening one
  // would change what the author wrote.
  let overlaps = 0;
  for (let n = 1; n < cues.length; n++) {
    if (cues[n].start < cues[n - 1].end) overlaps++;
  }
  if (overlaps > 0) {
    warnings.push(`${overlaps} cue(s) overlap the previous cue — they will be on screen at the same time.`);
  }

  return { cues, warnings, format };
}
