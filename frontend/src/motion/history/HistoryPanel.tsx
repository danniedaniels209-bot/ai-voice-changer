/**
 * Undo/redo visual history scrubber.
 *
 * Snapshot-based history in state.ts gives us just two lengths — how many
 * snapshots sit on the undo stack and how many on the redo stack — and
 * no per-step labels (the snapshots are full project trees, not labeled
 * actions). So this panel is intentionally minimal: two rows of dots,
 * past-stack on the left, future-stack on the right, separated by a
 * "now" marker. Clicking the Nth-from-now past dot rewinds N steps;
 * clicking the Nth future dot fast-forwards N steps. The caller is
 * responsible for dispatching the resulting UNDO / REDO actions N times.
 *
 * Visual language mirrors Timeline.tsx (small, dense, dark): border-border
 * separators, text-text-faint chrome, hover:bg-surface-hover on interactive
 * controls, text-text-muted default for inert ticks.
 */

import { Undo2, Redo2 } from "lucide-react";

export interface HistoryPanelProps {
  pastCount: number;
  futureCount: number;
  /** Called with the number of steps to jump back. Caller dispatches UNDO N
   *  times (or a batched equivalent). */
  onJumpBack: (steps: number) => void;
  /** Called with the number of steps to jump forward. */
  onJumpForward: (steps: number) => void;
  className?: string;
  title?: string;
}

const DOT_SIZE = 8; // px — keep parity with Timeline's keyframe diamonds (~10px)

/** Build an array [1..count] so each past tick has a clear "steps back"
 *  identity when clicked. Rendered right-to-left so step 1 (closest to
 *  "now") sits next to the divider. */
function pastTicks(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

function futureTicks(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

export function HistoryPanel({
  pastCount,
  futureCount,
  onJumpBack,
  onJumpForward,
  className = "",
  title = "History",
}: HistoryPanelProps) {
  const hasPast = pastCount > 0;
  const hasFuture = futureCount > 0;

  return (
    <div
      className={`history-panel border-t border-border bg-surface/60 px-3 py-1 ${className}`}
      aria-label="Undo and redo history"
    >
      {/* Single row: the editor's vertical space is contested (canvas, layers,
           audio, timeline all compete), so the title, counts, and scrubber
           share one line rather than stacking. History caps at MAX_HISTORY
           (50) in state.ts, so the dot row scrolls rather than blowing out. */}
      <div className="flex items-center gap-1 overflow-x-auto">
        <h3 className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-faint mr-1">
          {title}
        </h3>
        <span className="shrink-0 text-[10px] text-text-muted tabular-nums mr-1">
          {pastCount} back · {futureCount} forward
        </span>
        {/* Step-back / step-forward buttons — single-step navigation, useful
             when the dot scrubber feels too coarse. */}
        <button
          type="button"
          title="Undo"
          disabled={!hasPast}
          onClick={() => onJumpBack(1)}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text
                     disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <Undo2 size={14} />
        </button>

        {/* Past dots — newest step (1) closest to the "now" divider on the
             right; oldest step (pastCount) on the left edge. Clicking a
             dot jumps back exactly that many steps. */}
        <div
          className="flex items-center gap-1 flex-row-reverse justify-end"
          style={{ minHeight: DOT_SIZE }}
        >
          {pastTicks(pastCount).map((steps) => (
            <button
              key={`past-${steps}`}
              type="button"
              title={`Undo ${steps} step${steps === 1 ? "" : "s"}`}
              onClick={() => onJumpBack(steps)}
              aria-label={`Undo ${steps} step${steps === 1 ? "" : "s"}`}
              className="shrink-0 rounded-full bg-accent hover:bg-accent-hover border border-white/20
                         transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-accent"
              style={{ width: DOT_SIZE, height: DOT_SIZE }}
            />
          ))}
        </div>

        {/* "Now" divider — a thicker tick in the middle that always sits
             at the live state. Not interactive. */}
        <div
          aria-hidden="true"
          className="shrink-0 mx-1 rounded-sm bg-text"
          style={{ width: 2, height: DOT_SIZE + 4 }}
        />

        {/* Future dots — closest step (1) right next to the divider; oldest
             future step at the right edge. */}
        <div className="flex items-center gap-1" style={{ minHeight: DOT_SIZE }}>
          {futureTicks(futureCount).map((steps) => (
            <button
              key={`future-${steps}`}
              type="button"
              title={`Redo ${steps} step${steps === 1 ? "" : "s"}`}
              onClick={() => onJumpForward(steps)}
              aria-label={`Redo ${steps} step${steps === 1 ? "" : "s"}`}
              className="rounded-full bg-text-muted hover:bg-text border border-white/10
                         transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-accent"
              style={{ width: DOT_SIZE, height: DOT_SIZE }}
            />
          ))}
        </div>

        <button
          type="button"
          title="Redo"
          disabled={!hasFuture}
          onClick={() => onJumpForward(1)}
          className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text
                     disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <Redo2 size={14} />
        </button>
      </div>
    </div>
  );
}