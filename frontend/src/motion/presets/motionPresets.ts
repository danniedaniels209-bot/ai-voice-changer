import type { EasingType, Keyframe, MotionLayer, Transform } from "../../types/motion";

export type PresetId =
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "zoom-in"
  | "zoom-out"
  | "bounce"
  | "pop"
  | "elastic"
  | "rotate";

export interface PresetDef {
  id: PresetId;
  label: string;
  icon: string;
}

export const PRESET_DEFINITIONS: PresetDef[] = [
  { id: "fade", label: "Fade", icon: "✦" },
  { id: "slide-left", label: "Slide left", icon: "→" },
  { id: "slide-right", label: "Slide right", icon: "←" },
  { id: "slide-up", label: "Slide up", icon: "↑" },
  { id: "slide-down", label: "Slide down", icon: "↓" },
  { id: "zoom-in", label: "Zoom in", icon: "⊕" },
  { id: "zoom-out", label: "Zoom out", icon: "⊖" },
  { id: "bounce", label: "Bounce", icon: "↕" },
  { id: "pop", label: "Pop", icon: "◎" },
  { id: "elastic", label: "Elastic", icon: "∿" },
  { id: "rotate", label: "Rotate", icon: "↻" },
];

function newId(): string {
  return crypto.randomUUID().slice(0, 12);
}

function keyframe(
  time_ms: number,
  property: keyof Transform,
  value: number,
  easing: EasingType,
): Keyframe {
  return { id: newId(), time_ms, property, value, easing };
}

function defaultDuration(sceneDurationMs: number): number {
  // A quick in animation: one-third of the scene, capped between 400ms and 1200ms.
  return Math.max(400, Math.min(1200, Math.round(sceneDurationMs * 0.33)));
}

export function applyPreset(
  presetId: PresetId | string,
  layer: MotionLayer,
  sceneDurationMs: number,
): Keyframe[] {
  const t = layer.transform;
  const dur = defaultDuration(sceneDurationMs);
  // The playhead is clamped to [0, sceneDurationMs] (see state.ts's
  // SET_PLAYHEAD) — it can never go negative, so an intro animation MUST
  // play forward from time 0, not from a negative "before the timeline"
  // start. Keyframing start=-dur/end=0 would put the entire animation
  // before frame 0 is ever visible, making it look instantly "already
  // finished" instead of playing.
  const start = 0;
  const end = dur;

  switch (presetId) {
    case "fade": {
      return [
        keyframe(start, "opacity", 0, "ease_in_out"),
        keyframe(end, "opacity", t.opacity, "linear"),
      ];
    }

    case "slide-left": {
      const offset = t.width * 1.5 + 80;
      return [
        keyframe(start, "x", t.x + offset, "ease_out"),
        keyframe(end, "x", t.x, "linear"),
      ];
    }

    case "slide-right": {
      const offset = t.width * 1.5 + 80;
      return [
        keyframe(start, "x", t.x - offset, "ease_out"),
        keyframe(end, "x", t.x, "linear"),
      ];
    }

    case "slide-up": {
      const offset = t.height * 1.5 + 80;
      return [
        keyframe(start, "y", t.y + offset, "ease_out"),
        keyframe(end, "y", t.y, "linear"),
      ];
    }

    case "slide-down": {
      const offset = t.height * 1.5 + 80;
      return [
        keyframe(start, "y", t.y - offset, "ease_out"),
        keyframe(end, "y", t.y, "linear"),
      ];
    }

    case "zoom-in": {
      return [
        keyframe(start, "width", t.width * 0.05, "elastic"),
        keyframe(end, "width", t.width, "linear"),
        keyframe(start, "height", t.height * 0.05, "elastic"),
        keyframe(end, "height", t.height, "linear"),
      ];
    }

    case "zoom-out": {
      return [
        keyframe(start, "width", t.width * 2.5, "ease_out"),
        keyframe(end, "width", t.width, "linear"),
        keyframe(start, "height", t.height * 2.5, "ease_out"),
        keyframe(end, "height", t.height, "linear"),
      ];
    }

    case "bounce": {
      return [
        keyframe(start, "y", t.y - (t.height * 1.5 + 80), "bounce"),
        keyframe(end, "y", t.y, "linear"),
        keyframe(start, "opacity", 0, "linear"),
        keyframe(end, "opacity", t.opacity, "linear"),
      ];
    }

    case "pop": {
      return [
        keyframe(start, "width", t.width * 0.1, "ease_out"),
        keyframe(dur * 0.5, "width", t.width * 1.15, "ease_out"),
        keyframe(end, "width", t.width, "linear"),
        keyframe(start, "height", t.height * 0.1, "ease_out"),
        keyframe(dur * 0.5, "height", t.height * 1.15, "ease_out"),
        keyframe(end, "height", t.height, "linear"),
      ];
    }

    case "elastic": {
      const stretch = 80;
      return [
        keyframe(start, "x", t.x - stretch, "elastic"),
        keyframe(end, "x", t.x, "linear"),
        keyframe(start, "opacity", 0, "linear"),
        keyframe(end, "opacity", t.opacity, "linear"),
      ];
    }

    case "rotate": {
      return [
        keyframe(start, "rotation", t.rotation - 180, "ease_in_out"),
        keyframe(end, "rotation", t.rotation, "linear"),
        keyframe(start, "opacity", 0, "linear"),
        keyframe(end, "opacity", t.opacity, "linear"),
      ];
    }

    default:
      return [];
  }
}
