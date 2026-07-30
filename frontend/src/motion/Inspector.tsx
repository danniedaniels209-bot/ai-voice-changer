import { Diamond } from "lucide-react";
import type { EasingType } from "../types/motion";
import type { AnimatableProperty, MotionLayer, Transform } from "../types/motion";
import type { GradientFill } from "./gradients/gradientTypes";
import { GradientPicker } from "./gradients/GradientPicker";
import type { ShadowEffect } from "./shadowfx/shadowTypes";
import { ShadowPicker } from "./shadowfx/ShadowPicker";
import { CubicBezierEditor } from "./easing/CubicBezierEditor";
import { PresetPicker } from "./presets/PresetPicker";
import type { PresetId } from "./presets/motionPresets";
import { VideoCropControls } from "./video/VideoCropControls";
import { VideoSpeedControls } from "./video/VideoSpeedControls";
import { CaptionGroupPanel } from "./subtitles/CaptionGroupPanel";
import { ColorGradePicker } from "./colorgrade/ColorGradePicker";
import { BlendModePicker } from "./blend/BlendModePicker";
import { MotionBlurPicker } from "./motionblur/MotionBlurPicker";

/** Default starting points for "Add gradient"/"Add shadow" — matches what
 *  GradientPicker / ShadowPicker already consider reasonable, so the user
 *  sees something sensible the moment the effect is added. */
const DEFAULT_GRADIENT: GradientFill = {
  type: "linear",
  angle_deg: 90,
  stops: [
    { offset: 0, color: "#4F46E5" },
    { offset: 1, color: "#A855F7" },
  ],
};

const DEFAULT_SHADOW: ShadowEffect = {
  color: "#000000",
  blur: 16,
  offset_x: 0,
  offset_y: 8,
  opacity: 0.35,
  glow: false,
};

interface InspectorProps {
  layer: MotionLayer | null;
  playheadMs: number;
  onUpdateTransform: (patch: Partial<Transform>) => void;
  onUpdateLayer: (patch: Partial<MotionLayer>) => void;
  onSetKeyframe: (property: AnimatableProperty, value: number) => void;
  onApplyPreset: (presetId: PresetId) => void;
  // LT-KEYFRAMEUI — the currently selected keyframe (for easing editing).
  // Null when no keyframe is selected.
  selectedKeyframe?: { layerId: string; keyframeId: string } | null;
  /** Change the selected keyframe's easing. When easing === "custom", bezier
   carries the four cubic-bezier control points. */
  onUpdateKeyframeEasing?: (easing: EasingType, bezier?: [number, number, number, number]) => void;
  /** Change the selected keyframe's custom cubic-bezier control points.
   *  Only meaningful while its easing is "custom". */
  onUpdateKeyframeBezier?: (bezier: [number, number, number, number]) => void;
  // LT-CAPTIONSTYLE — every layer in the active scene (to find subtitle-
  // import siblings) plus the two batch dispatchers. Optional so this file
  // doesn't force every OTHER caller of <Inspector> (there's only one today,
  // but the type shouldn't assume it) to thread props it doesn't use.
  sceneLayers?: MotionLayer[];
  onBatchUpdateLayers?: (updates: { layerId: string; patch: Partial<MotionLayer> }[]) => void;
  onAlignLayers?: (updates: { layerId: string; transform: Transform }[]) => void;
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

/**
 * Number field in seconds that treats 0 as "unset" (an empty input + the
 * placeholder shown). Used for trim_end_ms where the model default is 0
 * meaning "no end trim — play to the end of the clip" — rendering that as
 * a literal "0.00s" would invite the user to think the clip is being
 * truncated to zero. Empty input + placeholder makes the intent visible.
 *
 * The onChange receives the raw string the user typed, so the caller can
 * distinguish "user cleared the field" (empty string) from "user typed 0"
 * (which doesn't actually happen here — typing 0 would re-commit 0, but
 * the user's mental model is "I cleared end-trim", so we accept that).
 */
function SecondsField({
  label,
  valueMs,
  onChangeMs,
  step = 0.1,
  min = 0,
  placeholder,
  unitLabel,
}: {
  label: string;
  valueMs: number;
  onChangeMs: (ms: number) => void;
  step?: number;
  min?: number;
  /** Placeholder when valueMs === 0 (or any other "unset" sentinel we add). */
  placeholder?: string;
  /** Unit suffix shown after the input. Defaults to "s" (seconds). */
  unitLabel?: string;
}) {
  // 0 means "unset" — render an empty input. The user can still type a
  // positive number to set the field; clearing the input reverts to 0.
  const isUnset = valueMs === 0;
  const displayValue = isUnset ? "" : (valueMs / 1000).toString();
  return (
    <label className="block">
      <span className="text-xs text-text-muted block mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={displayValue}
          step={step}
          min={min}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChangeMs(0);
              return;
            }
            const parsed = Number(raw);
            if (Number.isNaN(parsed)) {
              // Treat garbage as "user cleared it" — better than silently
              // snapping to 0 and confusing them on the next render.
              onChangeMs(0);
              return;
            }
            onChangeMs(Math.max(0, Math.round(parsed * 1000)));
          }}
          className="flex-1 bg-surface border border-border rounded px-2 py-1 text-sm min-w-0"
        />
        <span className="text-[10px] text-text-faint shrink-0">{unitLabel ?? "s"}</span>
      </div>
    </label>
  );
}

// A property counts as "keyframed at this time" within a quarter-frame
// tolerance (30fps) — exact float equality would miss keyframes placed by
// dragging or frame-stepping.
const TIME_TOLERANCE_MS = 8;

/** Plain-language labels — "ease_in_out" is the wire value, not something to
 *  show a user. Order runs simple -> expressive. */
const EASING_OPTIONS: { id: EasingType; label: string }[] = [
  { id: "linear", label: "Linear (no easing)" },
  { id: "ease_in", label: "Ease in (slow start)" },
  { id: "ease_out", label: "Ease out (slow finish)" },
  { id: "ease_in_out", label: "Ease in & out" },
  { id: "overshoot", label: "Overshoot (past, then settle)" },
  { id: "spring", label: "Spring (bouncy settle)" },
  { id: "bounce", label: "Bounce" },
  { id: "elastic", label: "Elastic" },
  { id: "custom", label: "Custom curve…" },
];

/** Starting handles when the user first switches a keyframe to "custom".
 *  Same values as CSS `ease`, so the curve doesn't visibly jump at the moment
 *  they select it — it starts where a sensible default already was. */
const DEFAULT_BEZIER: [number, number, number, number] = [0.25, 0.1, 0.25, 1];

export function Inspector({
  layer,
  playheadMs,
  onUpdateTransform,
  onUpdateLayer,
  onSetKeyframe,
  onApplyPreset,
  selectedKeyframe,
  onUpdateKeyframeEasing,
  onUpdateKeyframeBezier,
  sceneLayers,
  onBatchUpdateLayers,
  onAlignLayers,
}: InspectorProps) {
  if (!layer) {
    return (
      <div className="p-4 text-xs text-text-faint text-center">
        Select a layer to edit its properties.
      </div>
    );
  }

  const t = layer.transform;
  const activeKeyframe =
    selectedKeyframe && selectedKeyframe.layerId === layer.id
      ? layer.keyframes.find((k) => k.id === selectedKeyframe.keyframeId)
      : undefined;

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
      {/* Easing for the selected keyframe. The 8 easings existed with no way
          to change one after creation — a keyframe was stuck with whatever it
          was made with. Shown only when a keyframe on THIS layer is selected,
          so it doesn't imply it's editing something else. */}
      {selectedKeyframe && selectedKeyframe.layerId === layer.id && activeKeyframe && (
        <div className="border border-accent/40 rounded-lg bg-accent-dim/40 p-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint block mb-1.5">
            Keyframe easing
          </span>
          <p className="text-[10px] text-text-faint mb-2">
            {activeKeyframe.property} at {(activeKeyframe.time_ms / 1000).toFixed(2)}s
          </p>
          <select
            value={activeKeyframe.easing}
            onChange={(e) => {
              const next = e.target.value as EasingType;
              const bezier = next === "custom"
                ? (activeKeyframe.easing_bezier ?? DEFAULT_BEZIER)
                : undefined;
              onUpdateKeyframeEasing?.(next, bezier);
            }}
            className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
          >
            {EASING_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>

          {/* The bezier editor only appears for "custom" — showing it for the
              named easings would imply the handles drive them, which they
              don't. Falls back to DEFAULT_BEZIER so a keyframe just switched
              to custom has handles to grab rather than collapsing to a
              degenerate 0,0,0,0 curve. */}
          {activeKeyframe.easing === "custom" && (
            <div className="mt-2 flex justify-center">
              <CubicBezierEditor
                value={activeKeyframe.easing_bezier ?? DEFAULT_BEZIER}
                onChange={(bezier) => onUpdateKeyframeBezier?.(bezier)}
                size={168}
              />
            </div>
          )}

          <p className="text-[10px] text-text-faint mt-1.5">
            Controls how the animation arrives AT this keyframe.
          </p>
        </div>
      )}

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
          <NumberField
            label="Blur px"
            value={t.blur}
            step={1}
            onChange={(v) => onUpdateTransform({ blur: Math.max(0, v) })}
            {...keyframeProps("blur", t.blur)}
          />
        </div>
        <p className="text-[10px] text-text-faint mt-1.5">
          Click the ◇ next to a field to keyframe it at the playhead's current time.
        </p>
      </div>

      {/* Gradient fill — applies on top of the shape's solid fill: when set,
          the canvas / thumbnail renderers use the gradient instead. Image and
          video layers ignore this (their "fill" is the raster itself). */}
      {(layer.type === "rect" || layer.type === "ellipse" || layer.type === "text") && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
              Gradient fill
            </span>
            {layer.gradient ? (
              <button
                type="button"
                onClick={() => onUpdateLayer({ gradient: null })}
                className="text-[10px] text-text-faint hover:text-text"
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onUpdateLayer({ gradient: DEFAULT_GRADIENT })}
                className="text-[10px] text-accent hover:text-text"
              >
                + Add gradient
              </button>
            )}
          </div>
          {layer.gradient && (
            <GradientPicker
              value={layer.gradient}
              onChange={(g) => onUpdateLayer({ gradient: g })}
            />
          )}
        </div>
      )}

      {/* Drop shadow / glow — applies to every layer type. Wraps the shape
          in an SVG <filter> at render time. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
            Shadow & glow
          </span>
          {layer.shadow ? (
            <button
              type="button"
              onClick={() => onUpdateLayer({ shadow: null })}
              className="text-[10px] text-text-faint hover:text-text"
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onUpdateLayer({ shadow: DEFAULT_SHADOW })}
              className="text-[10px] text-accent hover:text-text"
            >
              + Add shadow
            </button>
          )}
        </div>
        {layer.shadow && (
          <ShadowPicker
            value={layer.shadow}
            onChange={(s) => onUpdateLayer({ shadow: s })}
          />
        )}
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
            <NumberField
              label="Letter spacing (px)"
              value={layer.text.letter_spacing ?? 0}
              onChange={(v) => onUpdateLayer({ text: { ...layer.text!, letter_spacing: v } })}
              step={0.5}
            />
            <NumberField
              label="Line height (× font size)"
              value={layer.text.line_height ?? 1.25}
              onChange={(v) => onUpdateLayer({ text: { ...layer.text!, line_height: Math.max(0.1, v) } })}
              step={0.05}
            />
            <ColorField
              label="Stroke color"
              value={layer.text.stroke_color ?? "#000000"}
              onChange={(v) => onUpdateLayer({ text: { ...layer.text!, stroke_color: v } })}
            />
            <NumberField
              label="Stroke width (px)"
              value={layer.text.stroke_width ?? 0}
              onChange={(v) => onUpdateLayer({ text: { ...layer.text!, stroke_width: Math.max(0, v) } })}
              step={0.5}
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

      {layer.type === "video" && layer.video && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint block mb-2">
            Video
          </span>
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs text-text-muted block mb-1">Source URL</span>
              <input
                type="text"
                value={layer.video.source_url}
                onChange={(e) => onUpdateLayer({ video: { ...layer.video!, source_url: e.target.value } })}
                placeholder="/motion/assets/…"
                className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <SecondsField
                label="Trim start"
                valueMs={layer.video.trim_start_ms}
                onChangeMs={(trim_start_ms) => onUpdateLayer({ video: { ...layer.video!, trim_start_ms } })}
              />
              <SecondsField
                label="Trim end"
                valueMs={layer.video.trim_end_ms}
                onChangeMs={(trim_end_ms) => onUpdateLayer({ video: { ...layer.video!, trim_end_ms } })}
                placeholder="end of clip"
              />
            </div>

            <NumberField
              label="Playback rate"
              value={layer.video.playback_rate}
              step={0.1}
              onChange={(v) => onUpdateLayer({ video: { ...layer.video!, playback_rate: Math.max(0.1, v) } })}
            />

            <div>
              <span className="text-xs text-text-muted block mb-1">Volume</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layer.video.volume}
                  onChange={(e) => onUpdateLayer({ video: { ...layer.video!, volume: Math.min(1, Math.max(0, Number(e.target.value))) } })}
                  className="flex-1 accent-accent"
                />
                <span className="text-[10px] text-text-faint tabular-nums w-8 text-right">
                  {Math.round(layer.video.volume * 100)}%
                </span>
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={layer.video.muted}
                onChange={(e) => onUpdateLayer({ video: { ...layer.video!, muted: e.target.checked } })}
                className="accent-accent"
              />
              <span className="text-xs text-text-muted">Muted</span>
            </label>

            <label className="block">
              <span className="text-xs text-text-muted block mb-1">Fit</span>
              <select
                value={layer.video.fit}
                onChange={(e) =>
                  onUpdateLayer({
                    video: { ...layer.video!, fit: e.target.value as "contain" | "cover" | "fill" },
                  })
                }
                className="w-full bg-surface border border-border rounded px-2 py-1 text-sm"
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="fill">Fill</option>
              </select>
            </label>

            {/* Crop + freeze frame (LT-VIDEOEDIT). Kept in its own component
                so this heavily-contested file grows by one block rather than
                eighty lines. */}
            <VideoCropControls
              video={layer.video}
              onChange={(patch) => onUpdateLayer({ video: { ...layer.video!, ...patch } })}
              playheadMs={playheadMs}
              visibleStartMs={layer.visible_start_ms ?? 0}
            />
            <VideoSpeedControls
              video={layer.video}
              onChange={(patch) => onUpdateLayer({ video: { ...layer.video!, ...patch } })}
              playheadMs={playheadMs}
              visibleStartMs={layer.visible_start_ms ?? 0}
            />
          </div>
        </div>
      )}

      {/* LT-COLORGRADE: brightness/contrast/saturation/hue. Applies to any
          layer type — it's a MotionLayer field, not a per-shape prop — so
          it's unconditional here, unlike the video-only blocks above. */}
      <ColorGradePicker layer={layer} onUpdateLayer={onUpdateLayer} />

      {/* LT-LAYERBLEND: CSS mix-blend-mode selector. Same shape as
          ColorGradePicker — applies to any layer type via a MotionLayer
          field, so unconditional here. The actual CSS application lives
          in motion/blend/blendMode.ts so all three renderers share one
          definition rather than re-emitting the style three times. */}
      <BlendModePicker layer={layer} onUpdateLayer={onUpdateLayer} />

      {/* LT-MOTIONBLUR: velocity motion blur toggle. */}
      <MotionBlurPicker layer={layer} onUpdateLayer={onUpdateLayer} />

      {/* LT-CAPTIONSTYLE (subtitles/CaptionGroupPanel): batch restyle +
          group-move for layers from a subtitle import. Kept in its own
          component, same reasoning as VideoCropControls — this file grows
          by one block, not the panel's own logic. */}
      {sceneLayers && onBatchUpdateLayers && onAlignLayers && (
        <CaptionGroupPanel
          layer={layer}
          allLayers={sceneLayers}
          onBatchUpdateLayers={onBatchUpdateLayers}
          onAlignLayers={onAlignLayers}
        />
      )}
    </div>
  );
}
