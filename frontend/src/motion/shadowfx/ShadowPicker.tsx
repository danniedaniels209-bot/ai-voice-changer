import type { ShadowEffect } from "./shadowTypes";

export interface ShadowPickerProps {
  value: ShadowEffect;
  onChange: (s: ShadowEffect) => void;
  className?: string;
  title?: string;
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function shadowCss(value: ShadowEffect) {
  const alpha = clamp(value.opacity, 0, 1);
  const offsetX = value.glow ? 0 : value.offset_x;
  const offsetY = value.glow ? 0 : value.offset_y;
  return `${offsetX}px ${offsetY}px ${value.blur}px color-mix(in srgb, ${value.color} ${
    alpha * 100
  }%, transparent)`;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const displayValue = step < 1 ? value.toFixed(2) : Math.round(value).toString();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium text-text-muted">{label}</label>
        <span className="text-[11px] tabular-nums text-text-faint">
          {displayValue}
          {suffix}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-border focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={step < 1 ? value.toFixed(2) : Math.round(value)}
          disabled={disabled}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          className="w-16 rounded border border-border bg-background px-1.5 py-1 text-right text-xs text-text focus:outline-none focus:border-accent disabled:opacity-40"
        />
      </div>
    </div>
  );
}

export function ShadowPicker({
  value,
  onChange,
  className = "",
  title = "Shadow & Glow",
}: ShadowPickerProps) {
  const update = (updates: Partial<ShadowEffect>) => onChange({ ...value, ...updates });

  return (
    <div className={`border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        {title}
      </h3>

      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="flex h-24 items-center justify-center rounded-md border border-border bg-surface-hover">
            <div
              className="h-12 w-24 rounded-md bg-accent-dim"
              style={{ boxShadow: shadowCss(value) }}
            />
          </div>
        </div>

        <div className="grid grid-cols-[auto_1fr] items-center gap-3">
          <input
            type="color"
            value={value.color}
            onChange={(e) => update({ color: e.target.value })}
            className="h-9 w-9 cursor-pointer rounded border border-border bg-background p-0 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <label className="text-sm text-text-muted">Effect color</label>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
          <span className="text-sm text-text-muted">Glow mode</span>
          <input
            type="checkbox"
            checked={value.glow}
            onChange={(e) =>
              update({
                glow: e.target.checked,
                offset_x: e.target.checked ? 0 : value.offset_x,
                offset_y: e.target.checked ? 0 : value.offset_y,
              })
            }
            className="h-4 w-4 accent-accent"
          />
        </label>

        <SliderRow
          label="Blur"
          value={value.blur}
          min={0}
          max={80}
          suffix="px"
          onChange={(blur) => update({ blur })}
        />
        <SliderRow
          label="Offset X"
          value={value.offset_x}
          min={-80}
          max={80}
          suffix="px"
          disabled={value.glow}
          onChange={(offset_x) => update({ offset_x })}
        />
        <SliderRow
          label="Offset Y"
          value={value.offset_y}
          min={-80}
          max={80}
          suffix="px"
          disabled={value.glow}
          onChange={(offset_y) => update({ offset_y })}
        />
        <SliderRow
          label="Opacity"
          value={value.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(opacity) => update({ opacity })}
        />
      </div>
    </div>
  );
}
