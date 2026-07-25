/**
 * Mirrors backend/app/subtitle_engine/timing.py so the live preview shows
 * the same word boundaries the export will use, even before real per-word
 * alignment data has come back from the job (e.g. while just previewing a
 * style choice against a cue list that hasn't been aligned yet).
 */

import type { SubtitleCue, SubtitleWord } from "../types/subtitle";

export function proportionalWords(cue: SubtitleCue): SubtitleWord[] {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const totalChars = words.reduce((n, w) => n + w.length, 0) || 1;
  const duration = Math.max(cue.end - cue.start, 0.05);
  let t = cue.start;
  return words.map((w) => {
    const share = duration * (w.length / totalChars);
    const end = Math.min(t + share, cue.end);
    const word: SubtitleWord = { text: w, start: t, end };
    t = end;
    return word;
  });
}

export function effectiveWords(cue: SubtitleCue): SubtitleWord[] {
  return cue.words.length > 0 ? cue.words : proportionalWords(cue);
}

/** Binary search assumes `cues` is sorted by start and non-overlapping —
 * true for every cue list this engine produces (sentence-level narration
 * timing) — so lookup stays O(log n) even with thousands of cues. */
export function findActiveCue(cues: SubtitleCue[], t: number): SubtitleCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid];
    if (t < cue.start) hi = mid - 1;
    else if (t > cue.end) lo = mid + 1;
    else return cue;
  }
  return null;
}

export function findActiveWordIndex(cue: SubtitleCue | null, t: number): number {
  if (!cue) return -1;
  const words = effectiveWords(cue);
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].start && t <= words[i].end) return i;
  }
  // In a gap between words: keep the most recently completed word "active"
  // so highlight-style captions don't flicker off between syllables.
  for (let i = words.length - 1; i >= 0; i--) {
    if (t >= words[i].end) return i;
  }
  return words.length > 0 ? 0 : -1;
}
