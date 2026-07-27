/**
 * Chart & diagram library panel — mirrors components/ComponentLibraryPanel.tsx's
 * structure exactly: a grid of schematic SVG previews that call
 * onInsert(layers) with a freshly-generated layer group when clicked.
 */

import type { ReactElement } from "react";
import type { MotionLayer } from "../../types/motion";
import {
  barChart,
  lineChart,
  pieChart,
  simpleTree,
  simpleFlowchart,
  stickyNoteGrid,
} from "./charts";

export interface ChartLibraryPanelProps {
  onInsert: (layers: MotionLayer[]) => void;
  className?: string;
  title?: string;
}

interface ChartDef {
  id: string;
  label: string;
  build: () => MotionLayer[];
  preview: () => ReactElement;
}

const BAR_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={6} y={6} width={52} height={36} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
    <line x1={10} y1={38} x2={54} y2={38} stroke="#9CA3AF" />
    <rect x={13} y={22} width={7} height={16} fill="#4F46E5" />
    <rect x={23} y={14} width={7} height={24} fill="#059669" />
    <rect x={33} y={18} width={7} height={20} fill="#F59E0B" />
    <rect x={43} y={10} width={7} height={28} fill="#EF4444" />
  </svg>
);
const LINE_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={6} y={6} width={52} height={36} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
    <line x1={10} y1={38} x2={54} y2={38} stroke="#9CA3AF" />
    <polyline points="12,30 22,20 32,26 42,14 52,10" fill="none" stroke="#4F46E5" strokeWidth={2} />
    <circle cx={12} cy={30} r={2} fill="#4F46E5" />
    <circle cx={22} cy={20} r={2} fill="#4F46E5" />
    <circle cx={32} cy={26} r={2} fill="#4F46E5" />
    <circle cx={42} cy={14} r={2} fill="#4F46E5" />
    <circle cx={52} cy={10} r={2} fill="#4F46E5" />
  </svg>
);
const PIE_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <circle cx={22} cy={24} r={16} fill="#4F46E5" />
    <rect x={44} y={12} width={8} height={8} rx={1.5} fill="#4F46E5" />
    <rect x={44} y={22} width={8} height={8} rx={1.5} fill="#059669" />
    <rect x={44} y={32} width={8} height={8} rx={1.5} fill="#F59E0B" />
  </svg>
);
const TREE_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={22} y={4} width={20} height={12} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
    <line x1={32} y1={16} x2={14} y2={30} stroke="#9CA3AF" />
    <line x1={32} y1={16} x2={50} y2={30} stroke="#9CA3AF" />
    <rect x={4} y={30} width={20} height={12} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
    <rect x={40} y={30} width={20} height={12} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
  </svg>
);
const FLOWCHART_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={2} y={18} width={16} height={12} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
    <line x1={18} y1={24} x2={26} y2={24} stroke="#9CA3AF" />
    <rect x={24} y={22} width={4} height={4} transform="rotate(45 26 24)" fill="#9CA3AF" />
    <rect x={26} y={18} width={16} height={12} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
    <line x1={42} y1={24} x2={50} y2={24} stroke="#9CA3AF" />
    <rect x={48} y={22} width={4} height={4} transform="rotate(45 50 24)" fill="#9CA3AF" />
    <rect x={50} y={18} width={12} height={12} rx={2} fill="#FFFFFF" stroke="#9CA3AF" />
  </svg>
);
const STICKY_PREVIEW = (
  <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
    <rect x={8} y={6} width={20} height={16} rx={1.5} fill="#FEF08A" transform="rotate(-4 18 14)" />
    <rect x={34} y={6} width={20} height={16} rx={1.5} fill="#BBF7D0" transform="rotate(4 44 14)" />
    <rect x={8} y={26} width={20} height={16} rx={1.5} fill="#FECACA" transform="rotate(-4 18 34)" />
    <rect x={34} y={26} width={20} height={16} rx={1.5} fill="#BFDBFE" transform="rotate(4 44 34)" />
  </svg>
);

const CHARTS: ChartDef[] = [
  { id: "bar", label: "Bar chart", build: () => barChart(0, 0), preview: () => BAR_PREVIEW },
  { id: "line", label: "Line chart", build: () => lineChart(0, 0), preview: () => LINE_PREVIEW },
  { id: "pie", label: "Pie chart", build: () => pieChart(0, 0), preview: () => PIE_PREVIEW },
  { id: "tree", label: "Tree", build: () => simpleTree(0, 0), preview: () => TREE_PREVIEW },
  { id: "flowchart", label: "Flowchart", build: () => simpleFlowchart(0, 0), preview: () => FLOWCHART_PREVIEW },
  { id: "sticky", label: "Sticky notes", build: () => stickyNoteGrid(0, 0), preview: () => STICKY_PREVIEW },
];

export function ChartLibraryPanel({
  onInsert,
  className = "",
  title = "Charts & Diagrams",
}: ChartLibraryPanelProps) {
  return (
    <div className={`chart-library border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {CHARTS.map((chart) => (
          <button
            key={chart.id}
            type="button"
            onClick={() => onInsert(chart.build())}
            className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-1 py-2
                       hover:bg-accent-dim hover:border-accent transition-colors"
            title={`Insert ${chart.label.toLowerCase()}`}
          >
            <span className="h-12 w-16 mb-1 flex items-center justify-center">
              {chart.preview()}
            </span>
            <span className="text-[10px] text-text-muted leading-tight text-center">
              {chart.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
