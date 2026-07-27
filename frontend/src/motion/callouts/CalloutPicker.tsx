import type { MotionLayer } from "../../types/motion";
import { CALLOUT_DEFINITIONS, type CalloutDef } from "./calloutFactory";

export interface CalloutPickerProps {
  onInsert: (layers: MotionLayer[]) => void;
  className?: string;
  title?: string;
}

/**
 * Presentational grid picker that lets the user insert a callout at a
 * default anchor (200, 200 — near canvas top-left) by clicking one of the
 * tiles. Mirrors PresetPicker.tsx's structure and Tailwind tokens so the
 * panel matches the existing editor language.
 *
 * Pure props-driven — reads no editor state, mutates nothing. Claude will
 * wire this into MotionEditor.tsx afterward (likely reading the active
 * selection / pointer to set the anchor point).
 */
export function CalloutPicker({
  onInsert,
  className = "",
  title = "Callouts",
}: CalloutPickerProps) {
  return (
    <div className={`callout-picker border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">{title}</h3>
      <div className="grid grid-cols-3 gap-2">
        {CALLOUT_DEFINITIONS.map((callout: CalloutDef) => (
          <button
            key={callout.id}
            type="button"
            onClick={() => onInsert(callout.build(200, 200))}
            className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-1 py-2
                       hover:bg-accent-dim hover:border-accent transition-colors"
            title={`Insert ${callout.label}`}
          >
            <span className="text-lg leading-none mb-1">{callout.preview}</span>
            <span className="text-[10px] text-text-muted leading-tight text-center">{callout.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}