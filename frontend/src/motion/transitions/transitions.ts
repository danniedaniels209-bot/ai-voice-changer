export interface TransitionDef {
  id: string;
  label: string;
  previewGlyph: string;
  duration_ms: number;
}

export const TRANSITION_DEFINITIONS: TransitionDef[] = [
  {
    id: "fade",
    label: "Fade",
    previewGlyph: "◐",
    duration_ms: 300,
  },
  {
    id: "slide-left",
    label: "Slide Left",
    previewGlyph: "←",
    duration_ms: 400,
  },
  {
    id: "slide-right",
    label: "Slide Right",
    previewGlyph: "→",
    duration_ms: 400,
  },
  {
    id: "slide-up",
    label: "Slide Up",
    previewGlyph: "↑",
    duration_ms: 400,
  },
  {
    id: "slide-down",
    label: "Slide Down",
    previewGlyph: "↓",
    duration_ms: 400,
  },
  {
    id: "push",
    label: "Push",
    previewGlyph: "⇉",
    duration_ms: 400,
  },
  {
    id: "zoom",
    label: "Zoom",
    previewGlyph: "⛶",
    duration_ms: 500,
  },
  {
    id: "wipe",
    label: "Wipe",
    previewGlyph: "▤",
    duration_ms: 400,
  },
  {
    id: "dissolve",
    label: "Dissolve",
    previewGlyph: "░",
    duration_ms: 500,
  },
];
