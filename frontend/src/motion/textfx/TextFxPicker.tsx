import { useState } from "react";
import type { MotionLayer } from "../../types/motion";
import { buildWordReveal, type TextFxStyle } from "./textReveal";

export interface TextFxPickerProps {
  /** Called with the freshly-built layers when the user clicks Insert. The
   *  caller decides where to anchor them (selection / pointer / default). */
  onInsert: (layers: MotionLayer[]) => void;
  className?: string;
  title?: string;
  /** Anchor x/y for the inserted layers (default 200, 200 — near canvas top-left).
   *  Claude will likely swap these for selection/pointer coords when wiring it up. */
  anchorX?: number;
  anchorY?: number;
}

const STYLES: { id: TextFxStyle; label: string }[] = [
  { id: "fade", label: "Fade" },
  { id: "slide-up", label: "Slide up" },
];

/**
 * Presentational form for inserting a word-by-word text reveal into the scene.
 * Mirrors PresetPicker.tsx's outer chrome (border / bg-surface / uppercase
 * faint heading) but uses an inline form (text input + style dropdown + Insert
 * button) instead of a tile grid, because the user supplies the text rather
 * than picking from a fixed catalog.
 *
 * Pure props-driven — reads no editor state, mutates nothing itself; the
 * caller handles selection / pointer anchoring after Claude wires it up.
 */
export function TextFxPicker({
  onInsert,
  className = "",
  title = "Text reveal",
  anchorX = 200,
  anchorY = 200,
}: TextFxPickerProps) {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<TextFxStyle>("fade");

  const handleInsert = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const layers = buildWordReveal(trimmed, anchorX, anchorY, { style });
    if (layers.length > 0) onInsert(layers);
  };

  return (
    <div className={`textfx-picker border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">{title}</h3>

      <label className="block text-[10px] uppercase tracking-wide text-text-faint mb-1">
        Text
      </label>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your phrase…"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text
                   placeholder:text-text-muted focus:outline-none focus:border-accent"
      />

      <label className="block text-[10px] uppercase tracking-wide text-text-faint mt-3 mb-1">
        Style
      </label>
      <select
        value={style}
        onChange={(e) => setStyle(e.target.value as TextFxStyle)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text
                   focus:outline-none focus:border-accent"
      >
        {STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleInsert}
        disabled={text.trim().length === 0}
        className="mt-3 w-full rounded-md border border-accent bg-accent-dim px-3 py-1.5 text-sm font-medium text-text
                   hover:bg-accent disabled:opacity-40 disabled:hover:bg-accent-dim disabled:cursor-not-allowed
                   transition-colors"
      >
        Insert
      </button>
    </div>
  );
}