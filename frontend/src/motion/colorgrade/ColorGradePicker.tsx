/**
 * Brightness/contrast/saturation/hue controls for the selected layer
 * (LT-COLORGRADE). Own component, same reasoning as VideoCropControls and
 * CaptionGroupPanel — Inspector.tsx is the most contested file in this
 * project, so a feature costs one small block there, not its own logic
 * spread through it.
 */

import { SlidersHorizontal } from "lucide-react";
import type { ColorGrade, MotionLayer } from "../../types/motion";

export interface ColorGradePickerProps {
  layer: MotionLayer;
  onUpdateLayer: (patch: Partial<MotionLayer>) => void;
}

const DEFAULT_GRADE: ColorGrade = { brightness: 1, contrast: 1, saturation: 1, hue_deg: 0 };

function isIdentity(g: ColorGrade): boolean {
  return g.brightness === 1 && g.contrast === 1 && g.saturation === 1 && g.hue_deg === 0;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted flex items-center justify-between mb-1">
        <span>{label}</span>
        <span className="text-text-faint tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

export function ColorGradePicker({ layer, onUpdateLayer }: ColorGradePickerProps) {
  const grade = layer.color_grade ?? DEFAULT_GRADE;

  function set(patch: Partial<ColorGrade>) {
    onUpdateLayer({ color_grade: { ...grade, ...patch } });
  }

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint flex items-center gap-1">
          <SlidersHorizontal size={11} /> Color
        </span>
        {!isIdentity(grade) && (
          <button
            type="button"
            onClick={() => onUpdateLayer({ color_grade: null })}
            className="text-[10px] text-text-faint hover:text-text underline"
          >
            Reset
          </button>
        )}
      </div>
      <div className="space-y-2">
        <Slider
          label="Brightness"
          value={grade.brightness}
          min={0}
          max={2}
          step={0.02}
          display={`${Math.round(grade.brightness * 100)}%`}
          onChange={(brightness) => set({ brightness })}
        />
        <Slider
          label="Contrast"
          value={grade.contrast}
          min={0}
          max={2}
          step={0.02}
          display={`${Math.round(grade.contrast * 100)}%`}
          onChange={(contrast) => set({ contrast })}
        />
        <Slider
          label="Saturation"
          value={grade.saturation}
          min={0}
          max={2}
          step={0.02}
          display={`${Math.round(grade.saturation * 100)}%`}
          onChange={(saturation) => set({ saturation })}
        />
        <Slider
          label="Hue"
          value={grade.hue_deg}
          min={-180}
          max={180}
          step={1}
          display={`${Math.round(grade.hue_deg)}°`}
          onChange={(hue_deg) => set({ hue_deg })}
        />
      </div>
    </div>
  );
}
