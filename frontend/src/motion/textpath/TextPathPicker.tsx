/**
 * Inspector panel control for LT-TEXTONPATH (Curved / Arced Text on Path).
 */

import type { TextLayerProps, TextPathType } from "../../types/motion";

export interface TextPathPickerProps {
  text: TextLayerProps;
  onChange: (patch: Partial<TextLayerProps>) => void;
}

const PATH_OPTIONS: Array<{ type: TextPathType; label: string }> = [
  { type: "none", label: "Straight (None)" },
  { type: "arc-up", label: "Arc Up ⌒" },
  { type: "arc-down", label: "Arc Down ⌣" },
  { type: "wave", label: "Wave 〰" },
  { type: "circle", label: "Circle ◯" },
  { type: "custom", label: "Custom Path" },
];

export function TextPathPicker({ text, onChange }: TextPathPickerProps) {
  const currentType: TextPathType = text.path_type || "none";

  return (
    <div className="space-y-2 pt-2 border-t border-border/40">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-text-muted">Text Path</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {PATH_OPTIONS.map((opt) => {
          const selected = currentType === opt.type;
          return (
            <button
              key={opt.type}
              type="button"
              onClick={() => onChange({ path_type: opt.type })}
              className={`px-2 py-1.5 rounded border text-xs text-center truncate transition-colors ${
                selected
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-border text-text-muted hover:border-accent/50 hover:bg-surface-hover"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {currentType === "custom" && (
        <div className="space-y-1 pt-1">
          <label className="text-[11px] text-text-faint">Custom SVG Path 'd' attribute</label>
          <input
            type="text"
            value={text.path_d || ""}
            placeholder="e.g. M 0 50 Q 100 0 200 50"
            onChange={(e) => onChange({ path_d: e.target.value || null })}
            className="w-full px-2 py-1 bg-surface-hover border border-border rounded text-xs text-text focus:outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  );
}
