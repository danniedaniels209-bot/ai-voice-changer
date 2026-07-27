import { PRESET_DEFINITIONS } from "./motionPresets";
import type { PresetId } from "./motionPresets";

export interface PresetPickerProps {
  onApply: (presetId: PresetId) => void;
  className?: string;
  title?: string;
}

export function PresetPicker({
  onApply,
  className = "",
  title = "Motion presets",
}: PresetPickerProps) {
  return (
    <div className={`preset-picker border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">{title}</h3>
      <div className="grid grid-cols-4 gap-2">
        {PRESET_DEFINITIONS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onApply(preset.id)}
            className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-1 py-2
                       hover:bg-accent-dim hover:border-accent transition-colors"
            title={preset.label}
          >
            <span className="text-lg leading-none mb-1">{preset.icon}</span>
            <span className="text-[10px] text-text-muted leading-tight text-center">{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
