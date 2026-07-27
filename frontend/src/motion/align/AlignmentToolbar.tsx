import {
  AlignLeft,
  AlignCenterHorizontal,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignVerticalJustifyCenter,
  AlignHorizontalJustifyCenter,
  type LucideIcon,
} from "lucide-react";
import { ALIGN_DEFINITIONS, type AlignKind } from "./alignment";

const ICONS: { [k in AlignKind]: LucideIcon } = {
  "align-left": AlignLeft,
  "align-center-h": AlignCenterHorizontal,
  "align-right": AlignRight,
  "align-top": AlignStartVertical,
  "align-center-v": AlignCenterVertical,
  "align-bottom": AlignEndVertical,
  "distribute-h": AlignHorizontalJustifyCenter,
  "distribute-v": AlignVerticalJustifyCenter,
};

export interface AlignmentToolbarProps {
  onAlign: (kind: AlignKind) => void;
  /** Number of selected layers; the toolbar disables buttons that need 2+ layers
   * (alignment) or 3+ layers (distribute). */
  selectedCount?: number;
  className?: string;
}

/**
 * Presentational row of alignment/distribution icon buttons.
 *
 * Pure props-driven — calls `onAlign(kind)` when a button is clicked. The
 * caller is responsible for collecting the selected layers' transforms,
 * running the corresponding function from alignment.ts, and dispatching the
 * new transforms into the editor state.
 *
 * Icon-button styling mirrors MotionEditor.tsx's existing toolbar
 * (`p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text`)
 * so this drops in visually alongside the existing controls.
 */
export function AlignmentToolbar({
  onAlign,
  selectedCount = 0,
  className = "",
}: AlignmentToolbarProps) {
  // Align ops need 2+ layers, distribute needs 3+.
  const isDisabled = (kind: AlignKind): boolean => {
    if (kind.startsWith("distribute")) return selectedCount < 3;
    return selectedCount < 2;
  };

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {ALIGN_DEFINITIONS.map((def) => {
        const Icon = ICONS[def.id];
        const disabled = isDisabled(def.id);
        return (
          <button
            key={def.id}
            type="button"
            title={def.label}
            disabled={disabled}
            onClick={() => onAlign(def.id)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}