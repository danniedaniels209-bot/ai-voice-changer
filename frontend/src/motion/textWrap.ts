/**
 * Word-wrap helper for text layers across the editor canvas, the export
 * renderer, and the scene thumbnail.
 *
 * The reason this is a deterministic character-count estimate and NOT a
 * real text measurement (getComputedTextLength() / canvas measureText()):
 *
 *   1. The editor and the exporter must agree pixel-for-pixel. The exporter
 *      runs inside Playwright where a layout-effect measurement pass could
 *      race the screenshot handshake (data-render-time only flips after
 *      every video has fired 'seeked' — a synchronous measurement there
 *      runs fine, but a layout-then-measure-then-render cycle is exactly
 *      the kind of extra async step that creates the silent half-second
 *      drift bug we just spent a day closing for video).
 *   2. getComputedTextLength is SVG-only and depends on the browser's font
 *      metrics; the editor and the headless Chromium may render with
 *      slightly different font fallbacks, which would mean the wrap point
 *      is correct in one and wrong in the other.
 *   3. canvas measureText needs a 2D context, which is fine in the editor
 *      but a pain inside the foreignObject that RenderFrame uses for video.
 *
 * A rough estimate that produces the same line breaks in all three
 * renderers is more useful than a pixel-perfect one that disagrees between
 * them. The estimate below uses 0.55 * fontSize as the average character
 * width — same fudge factor textReveal.ts already uses for word-width
 * estimation, so the two stay consistent across the codebase.
 *
 * If you ever want to "improve" this to a real measurement, do it in ALL
 * THREE renderers on the same day with a paired test, never piecemeal.
 */

export const DEFAULT_CHAR_WIDTH_FACTOR = 0.55;
const LINE_HEIGHT_FACTOR = 1.25;

export interface WrapOptions {
  /** Max width in pixels the text is allowed to span. */
  maxWidthPx: number;
  /** Font size in pixels — drives the per-character width estimate. */
  fontSize: number;
  /** Average character-width factor (default 0.55). Override rarely. */
  charWidthFactor?: number;
}

/**
 * Wrap text to an array of lines. Honours explicit '\n' characters as hard
 * breaks (each newline starts a new line, even if empty), then wraps each
 * of those lines greedily to fit `maxWidthPx` at the given `fontSize`.
 *
 * A single word longer than the box is NOT broken mid-word — it returns as
 * its own line and overflows. Silently chopping a URL or a long identifier
 * is worse than letting the user see and fix the overflow.
 */
export function wrapTextToLines(
  text: string,
  opts: WrapOptions,
): string[] {
  const charWidthFactor = opts.charWidthFactor ?? DEFAULT_CHAR_WIDTH_FACTOR;
  const charWidth = opts.fontSize * charWidthFactor;
  // maxCharsPerLine === 0 would mean width 0, which is degenerate. Floor of
  // 1 still lets a single character fit to avoid an infinite loop in the
  // wrapping loop below.
  const maxCharsPerLine = Math.max(1, Math.floor(opts.maxWidthPx / charWidth));

  const result: string[] = [];
  // Split on newline first so each chunk is wrapped in isolation. Using
  // split('\n') (not /\n/) is intentional — keeps the function cheap and
  // doesn't pull in regex semantics.
  const chunks = text.split("\n");
  for (const chunk of chunks) {
    if (chunk.length === 0) {
      result.push("");
      continue;
    }

    const words = chunk.split(" ");
    let current = "";
    for (const word of words) {
      // A word longer than the line gets its own line and we keep going.
      // Greedy single-word overflow: don't try to break it.
      if (word.length > maxCharsPerLine) {
        if (current.length > 0) {
          result.push(current);
          current = "";
        }
        result.push(word);
        continue;
      }
      // Accumulate into the current line. If adding this word would push us
      // past the limit, finalize the current line first.
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (candidate.length > maxCharsPerLine) {
        result.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) result.push(current);
  }
  return result;
}

/** Vertical advance per line, in pixels — exposed so the renderer can use
 *  the same factor for <tspan dy="..."> values and stay locked to the
 *  estimator. The optional multiplier (LT-TEXTSTYLE, layer.text.line_height)
 *  lets the user override the per-line spacing per layer; passing nothing
 *  falls back to the original 1.25 constant so every existing call site
 *  keeps its current pixel layout. */
export function lineHeight(fontSize: number, multiplier?: number): number {
  return fontSize * (multiplier ?? LINE_HEIGHT_FACTOR);
}
