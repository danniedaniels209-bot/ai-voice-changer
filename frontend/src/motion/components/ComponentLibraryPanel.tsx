/**
 * Component library panel — a presentational grid of the mockup factories
 * exported from ./mockups. Each entry shows a small SVG preview (built from
 * primitive shapes that mirror the mockup's silhouette) and a label, and
 * calls onInsert(layers) when clicked with a freshly-generated layer group.
 *
 * Purely presentational: no editor state is read or mutated here. The parent
 * (MotionEditor.tsx, which Claude will wire) supplies onInsert and decides
 * where the new layers go (which scene, what z-index, etc.).
 *
 * Styling follows the same Tailwind tokens as PresetPicker.tsx and
 * LayerPanel.tsx (border-border, bg-surface, text-text-faint, etc.) so the
 * panel matches the rest of the Motion Studio UI.
 */

import type { ReactElement } from "react";
import type { MotionLayer } from "../../types/motion";
import {
  phoneMockup,
  laptopMockup,
  tabletMockup,
  browserWindow,
  desktopWindow,
  cardMockup,
  buttonMockup,
  simpleTable,
  simpleForm,
} from "./mockups";

export interface ComponentLibraryPanelProps {
  /** Called with a fresh layer group when the user clicks a component entry. */
  onInsert: (layers: MotionLayer[]) => void;
  className?: string;
  title?: string;
}

/** A preview is a small inline SVG that sketches the component's silhouette.
 * Drawing the actual layers to scale would need a tiny renderer; these SVGs
 * are intentionally schematic (colored shapes giving the gist of the
 * component), matching how PresetPicker uses a single emoji glyph per preset.
 * Each preview is sized to a 64x48 viewBox so the grid stays uniform. */
interface ComponentDef {
  id: string;
  label: string;
  /** Build the actual layers for insertion. Anchored at (0,0) — the parent
   * editor should offset to wherever its canvas drop logic wants them. */
  build: () => MotionLayer[];
  preview: () => ReactElement;
}

const PHONE_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={25} y={4} width={14} height={40} rx={4} fill="#1F2937" />
    <rect x={27} y={6} width={10} height={34} rx={2} fill="#FFFFFF" />
  </svg>
);
const LAPTOP_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={12} y={6} width={40} height={26} rx={2} fill="#1F2937" />
    <rect x={14} y={8} width={36} height={22} fill="#FFFFFF" />
    <rect x={6} y={33} width={52} height={4} rx={2} fill="#E5E7EB" />
  </svg>
);
const TABLET_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={8} y={8} width={48} height={32} rx={4} fill="#1F2937" />
    <rect x={11} y={11} width={42} height={26} rx={2} fill="#FFFFFF" />
    <circle cx={32} cy={9.5} r={0.8} fill="#111827" />
  </svg>
);
const BROWSER_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={8} y={8} width={48} height={32} rx={3} fill="#FFFFFF" stroke="#9CA3AF" />
    <rect x={8} y={8} width={48} height={8} rx={3} fill="#E5E7EB" />
    <rect x={8} y={13} width={48} height={3} fill="#E5E7EB" />
    <circle cx={12} cy={12} r={1.2} fill="#EF4444" />
    <circle cx={16} cy={12} r={1.2} fill="#F59E0B" />
    <circle cx={20} cy={12} r={1.2} fill="#059669" />
    <rect x={24} y={10.5} width={30} height={3} rx={1.5} fill="#FFFFFF" />
  </svg>
);
const WINDOW_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={10} y={8} width={44} height={32} rx={3} fill="#FFFFFF" stroke="#9CA3AF" />
    <rect x={10} y={8} width={44} height={7} rx={3} fill="#E5E7EB" />
    <rect x={10} y={12} width={44} height={3} fill="#E5E7EB" />
    <circle cx={51} cy={11.5} r={1.4} fill="#EF4444" />
    <rect x={14} y={11} width={30} height={2} rx={1} fill="#9CA3AF" />
  </svg>
);
const CARD_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={12} y={8} width={40} height={32} rx={4} fill="#FFFFFF" stroke="#9CA3AF" />
    <rect x={12} y={8} width={40} height={3} rx={2} fill="#4F46E5" />
    <circle cx={19} cy={20} r={5} fill="#F3F4F6" />
    <rect x={27} y={16} width={22} height={3} rx={1.5} fill="#374151" />
    <rect x={27} y={22} width={18} height={2.5} rx={1} fill="#9CA3AF" />
    <rect x={17} y={30} width={30} height={2.5} rx={1} fill="#F3F4F6" />
    <rect x={17} y={35} width={20} height={2.5} rx={1} fill="#F3F4F6" />
  </svg>
);
const BUTTON_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={14} y={18} width={36} height={12} rx={6} fill="#4F46E5" />
    <rect x={24} y={22} width={16} height={4} rx={1} fill="#FFFFFF" />
  </svg>
);
const TABLE_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={6} y={8} width={52} height={32} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
    <rect x={6} y={8} width={52} height={7} fill="#F3F4F6" />
    <line x1={23} y1={8} x2={23} y2={40} stroke="#E5E7EB" />
    <line x1={41} y1={8} x2={41} y2={40} stroke="#E5E7EB" />
    <line x1={6} y1={18} x2={58} y2={18} stroke="#E5E7EB" />
    <line x1={6} y1={27} x2={58} y2={27} stroke="#E5E7EB" />
    <line x1={6} y1={36} x2={58} y2={36} stroke="#E5E7EB" />
  </svg>
);
const FORM_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={12} y={6} width={40} height={36} rx={3} fill="#FFFFFF" stroke="#9CA3AF" />
    <rect x={17} y={11} width={14} height={2.5} rx={1} fill="#374151" />
    <rect x={17} y={15} width={30} height={4} rx={2} fill="#F3F4F6" />
    <rect x={17} y={22} width={14} height={2.5} rx={1} fill="#374151" />
    <rect x={17} y={26} width={30} height={4} rx={2} fill="#F3F4F6" />
    <rect x={26} y={34} width={12} height={5} rx={2.5} fill="#4F46E5" />
  </svg>
);

/** The component catalog. Order is the display order in the panel. */
const COMPONENTS: ComponentDef[] = [
  { id: "phone", label: "Phone", build: () => phoneMockup(0, 0), preview: () => PHONE_PREVIEW },
  { id: "laptop", label: "Laptop", build: () => laptopMockup(0, 0), preview: () => LAPTOP_PREVIEW },
  { id: "tablet", label: "Tablet", build: () => tabletMockup(0, 0), preview: () => TABLET_PREVIEW },
  { id: "browser", label: "Browser", build: () => browserWindow(0, 0), preview: () => BROWSER_PREVIEW },
  { id: "window", label: "Window", build: () => desktopWindow(0, 0), preview: () => WINDOW_PREVIEW },
  { id: "card", label: "Card", build: () => cardMockup(0, 0), preview: () => CARD_PREVIEW },
  { id: "button", label: "Button", build: () => buttonMockup(0, 0), preview: () => BUTTON_PREVIEW },
  { id: "table", label: "Table", build: () => simpleTable(0, 0), preview: () => TABLE_PREVIEW },
  { id: "form", label: "Form", build: () => simpleForm(0, 0), preview: () => FORM_PREVIEW },
];

export function ComponentLibraryPanel({
  onInsert,
  className = "",
  title = "Components",
}: ComponentLibraryPanelProps) {
  return (
    <div
      className={`component-library border border-border rounded-lg bg-surface p-3 ${className}`}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {COMPONENTS.map((comp) => (
          <button
            key={comp.id}
            type="button"
            onClick={() => onInsert(comp.build())}
            className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-1 py-2
                       hover:bg-accent-dim hover:border-accent transition-colors"
            title={`Insert ${comp.label.toLowerCase()} mockup`}
          >
            <span className="h-12 w-16 mb-1 flex items-center justify-center">
              {comp.preview()}
            </span>
            <span className="text-[10px] text-text-muted leading-tight text-center">
              {comp.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
