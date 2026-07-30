/**
 * Motion blur toggle switch for the selected layer (LT-MOTIONBLUR).
 * Own component to keep Inspector.tsx clean and concise.
 */

import { Wind } from "lucide-react";
import type { MotionLayer } from "../../types/motion";

export interface MotionBlurPickerProps {
  layer: MotionLayer;
  onUpdateLayer: (patch: Partial<MotionLayer>) => void;
}

export function MotionBlurPicker({ layer, onUpdateLayer }: MotionBlurPickerProps) {
  const enabled = !!layer.motion_blur;

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint flex items-center gap-1">
          <Wind size={11} /> Motion Blur
        </span>
      </div>
      <label className="flex items-center gap-2 cursor-pointer text-xs text-text bg-surface border border-border rounded px-2.5 py-1.5 hover:border-border-hover transition-colors">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onUpdateLayer({ motion_blur: e.target.checked })}
          className="rounded border-border text-accent focus:ring-accent"
        />
        <span>Enable velocity motion blur</span>
      </label>
      <p className="text-[10px] text-text-faint mt-1">
        Applies directional blur proportional to speed during animated movement.
      </p>
    </div>
  );
}
