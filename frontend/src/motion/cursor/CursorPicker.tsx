import type { MotionLayer } from "../../types/motion";
import { CURSOR_DEFINITIONS, type CursorDef } from "./cursorFactory";

export interface CursorPickerProps {
  onInsert: (layers: MotionLayer[]) => void;
  className?: string;
  title?: string;
}

/**
 * Presentational grid picker that lets the user insert a cursor / interaction
 * element at a default anchor (200, 200 — near canvas top-left) by clicking
 * one of the tiles. Mirrors CalloutPicker.tsx's structure and Tailwind tokens
 * (border-border, bg-surface, bg-background, hover:bg-accent-dim,
 * text-text-faint, text-text-muted) so the panel matches the existing editor
 * language.
 *
 * Pure props-driven — reads no editor state, mutates nothing. Claude will
 * wire this into MotionEditor.tsx afterward (likely reading the active
 * selection / pointer to set the anchor point).
 */
export function CursorPicker({
  onInsert,
  className = "",
  title = "Cursors",
}: CursorPickerProps) {
  return (
    <div className={`cursor-picker border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">{title}</h3>
      <div className="grid grid-cols-3 gap-2">
        {CURSOR_DEFINITIONS.map((cursor: CursorDef) => (
          <button
            key={cursor.id}
            type="button"
            onClick={() => onInsert(cursor.build(200, 200))}
            className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-1 py-2
                       hover:bg-accent-dim hover:border-accent transition-colors"
            title={`Insert ${cursor.label}`}
          >
            <span className="text-lg leading-none mb-1">{cursor.preview}</span>
            <span className="text-[10px] text-text-muted leading-tight text-center">{cursor.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
