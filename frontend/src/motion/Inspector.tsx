import { Diamond } from "lucide-react";
import type { AnimatableProperty, MotionLayer, Transform } from "../types/motion";
import { PresetPicker } from "./presets/PresetPicker";
import type { PresetId } from "./presets/motionPresets";

interface InspectorProps {
  layer: MotionLayer | null;
  playheadMs: number;
  onUpdateTransform: (patch: Partial<Transform>) => void;
  onUpdateLayer: (patch: Partial<MotionLayer>) => void;
  onSetKeyframe: (property: AnimatableProperty, value: number) => void;
  onApplyPreset: (presetId: PresetId) => void;
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  keyframed,
  onToggleKeyframe,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  /** When provided, shows a diamond toggle that pins the current value as
   * a keyframe at the playhead — undefined for properties that aren't
   * animatable (e.g. rectangle corner radius). */
  keyframed?: boolean;
  onToggleKeyframe?: () => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted mb-1 flex items-center gap-1">
        {label}
        {onToggleKeyframe && (
          <button
            type="button"
            title={keyframed ? "Keyframed at this time — click to remove" : "Set a keyframe at this time"}
            onClick={(e) => {
              e.preventDefault();
              onToggleKeyframe();
            }}
            className={keyframed ? "text-accent" : "text-text-faint hover:text-text"}
          >
            <Diamond size={9} fill={keyframed ? "currentColor" : "none"} />
          </button>
        )}
      </span>
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted block mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded border border-border bg-surface shrink-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-surface border border-border rounded px-2 py-1 text-sm min-w-0"
        />
      </div>
    </label>
  );
}

// A property counts as "keyframed at this time" within a quarter-frame
// tolerance (30fps) — exact float equality would miss keyframes placed by
// dragging or frame-stepping.
const TIME_TOLERANCE_MS = 8;

export function Inspector({
  layer,
  playheadMs,
  onUpdateTransform,
  onUpdateLayer,
  onSetKeyframe,
  onApplyPreset,
}: InspectorProps) {
  if (!layer) {
    return (
      <div className="p-4 text-xs text-text-faint text-center">
        Select a layer to edit its properties.
      </div>
    );
  }

  const t = layer.transform;

  function keyframeAt(property: AnimatableProperty) {
    return layer!.keyframes.find(
      (k) => k.property === property && Math.abs(k.time_ms - playheadMs) <= TIME_TOLERANCE_MS,
    );
  }

  function keyframeProps(property: AnimatableProperty, currentValue: number) {
    const existing = keyframeAt(property);
    return {
      keyframed: !!existing,
      onToggleKeyframe: () => onSetKeyframe(property, currentValue),
    };
  }

  return (
    <div className="p-3 space-y-4 overflow-y-auto h-full">
      <PresetPicker onApply={onApplyPreset} title="Motion presets" />

      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint block mb-2">
          Transform
        </span>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={t.x} onChange={(v) => onUpdateTransform({ x: v })} {...keyframeProps("x", t.x)} />
          <NumberField label="Y" value={t.y} onChange={(v) => onUpdateTransform({ y: v })} {...keyframeProps("y", t.y)} />
          <NumberField
            label="Width"
            value={t.width}
            onChange={(v) => onUpdateTransform({ width: Math.max(1, v) })}
            {...keyframeProps("width", t.width)}
          />
          <NumberField
            label="Height"
            value={t.height}
            onChange={(v) => onUpdateTransform({ height: Math.max(1, v) })}
            {...keyframeProps("height", t.height)}
          />
          <NumberField
            label="Rotation °"
            value={t.rotation}
            onChange={(v) => onUpdateTransform({ rotation: v })}
            {...keyframeProps("rotation", t.rotation)}
          />
          <NumberField
            label="Opacity"
            value={t.opacity}
            step={0.05}
            onChange={(v) => onUpdateTransform({ opacity: Math.min(1, Math.max(0, v)) })}
            {...keyframeProps("opacity", t.opacity)}
          />
        </div>
        <p className="text-[10px] text-text-faint mt-1.5">
          Click the ◇ next to a field to keyframe it at the playhead's current time.
        </p>
      </div>

      {layer.type === "rect" && layer.rect && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint block mb-2">
            Rectangle
          </span>
          <div className="space-y-2">
            <ColorField
              label="Fill"
              value={layer.rect.fill}
              onChange={(v) => onUpdateLayer({ rect: { ...layer.rect!, fill: v } })}
            />
            <NumberField
              label="Corner radius"
              value={layer.rect.corner_radius}
              onChange={(v) => onUpdateLayer({ rect: { ...layer.rect!, corner_radius: Math.max(0, v) } })}
            />
            <ColorField
              label="Stroke color"
              value={layer.rect.stroke_color}
              onChange={(v) => onUpdateLayer({ rect: { ...layer.rect!, stroke_color: v } })}
            />
            <NumberField
              label="Stroke width"
              value={layer.rect.stroke_width}
              onChange={(v) => onUpdateLayer({ rect: { ...layer.rect!, stroke_width: Math.max(0, v) } })}
            />
          </div>
        </div>
      )}

      {layer.type === "ellipse" && layer.ellipse && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint block mb-2">
            Ellipse
          </span>
          <div className="space-y-2">
            <ColorField
              label="Fill"
              value={layer.ellipse.fill}
              onChange={(v) => onUpdateLayer({ ellipse: { ...layer.ellipse!, fill: v } })}
            />
            <ColorField
              label="Stroke color"
              value={layer.ellipse.stroke_color}
              onChange={(v) => onUpdateLayer({ ellipse: { ...layer.ellipse!, stroke_color: v } })}
            />
            <NumberField
              label="Stroke width"
              value={layer.ellipse.stroke_width}
              onChange={(v) => onUpdateLayer({ ellipse: { ...layer.ellipse!, stroke_width: Math.max(0, v) } })}
            />
          </div>
        </div>
      )}

      {layer.type === "text" && layer.text && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint block mb-2">
            Text
          </span>
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs text-text-muted block mb-1">Content</span>
              <textarea
                value={layer.text.text}
                onChange={(e) => onUpdateLayer({ text: { ...layer.text!, text: e.target.value } })}
                rows={2}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-sm resize-none"
              />
            </label>
            <NumberField
              label="Font size"
              value={layer.text.font_size}
              onChange={(v) => onUpdateLayer({ text: { ...layer.text!, font_size: Math.max(1, v) } })}
            />
            <label className="block">
              <span className="text-xs text-text-muted block mb-1">Weight</span>
              <select
                value={layer.text.font_weight}
                onChange={(e) => onUpdateLayer({ text: { ...layer.text!, font_weight: Number(e.target.value) } })}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
              >
                {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-text-muted block mb-1">Align</span>
              <select
                value={layer.text.align}
                onChange={(e) =>
                  onUpdateLayer({ text: { ...layer.text!, align: e.target.value as "left" | "center" | "right" } })
                }
                className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <ColorField
              label="Color"
              value={layer.text.color}
              onChange={(v) => onUpdateLayer({ text: { ...layer.text!, color: v } })}
            />
          </div>
        </div>
      )}

      {layer.type === "image" && layer.image && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint block mb-2">
            Image
          </span>
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs text-text-muted block mb-1">Source URL</span>
              <input
                type="text"
                value={layer.image.src}
                onChange={(e) => onUpdateLayer({ image: { ...layer.image!, src: e.target.value } })}
                placeholder="https://…"
                className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-text-muted block mb-1">Fit</span>
              <select
                value={layer.image.fit}
                onChange={(e) =>
                  onUpdateLayer({ image: { ...layer.image!, fit: e.target.value as "contain" | "cover" | "fill" } })
                }
                className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="fill">Fill</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
