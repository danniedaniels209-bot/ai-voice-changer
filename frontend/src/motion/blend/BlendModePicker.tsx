/**
 * CSS mix-blend-mode selector for the selected layer (LT-LAYERBLEND).
 * Own component, same reasoning as ColorGradePicker and VideoCropControls —
 * Inspector.tsx is the most contested file in this project, so a feature
 * costs one small block there, not its own logic spread through it.
 */

import { Blend } from "lucide-react";
import type { BlendMode, MotionLayer } from "../../types/motion";
import { BLEND_MODES, isNormalBlend } from "./blendMode";

export interface BlendModePickerProps {
  layer: MotionLayer;
  onUpdateLayer: (patch: Partial<MotionLayer>) => void;
}

export function BlendModePicker({ layer, onUpdateLayer }: BlendModePickerProps) {
  const current: BlendMode = layer.blend_mode ?? "normal";
  const isDefault = isNormalBlend(layer.blend_mode);

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint flex items-center gap-1">
          <Blend size={11} /> Blend
        </span>
        {!isDefault && (
          <button
            type="button"
            onClick={() => onUpdateLayer({ blend_mode: null })}
            className="text-[10px] text-text-faint hover:text-text underline"
          >
            Reset
          </button>
        )}
      </div>
      <select
        value={current}
        onChange={(e) => onUpdateLayer({ blend_mode: e.target.value as BlendMode })}
        className="w-full text-xs bg-surface border border-border rounded px-2 py-1 text-text focus:outline-none focus:border-accent"
      >
        {BLEND_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}