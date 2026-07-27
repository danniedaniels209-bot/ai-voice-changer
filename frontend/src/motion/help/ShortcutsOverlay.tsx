import { X, Keyboard } from "lucide-react";

export interface ShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ["Ctrl", "Z"], description: "Undo" },
  { keys: ["Ctrl", "Shift", "Z"], description: "Redo" },
  { keys: ["Delete"], description: "Delete selected layer" },
  { keys: ["Backspace"], description: "Delete selected layer" },
  { keys: ["Ctrl", "K"], description: "Open command palette" },
  { keys: ["Space"], description: "Play or pause" },
  { keys: ["Left"], description: "Previous frame" },
  { keys: ["Right"], description: "Next frame" },
];

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-7 rounded border border-border bg-background px-2 py-1 text-center text-[11px] font-medium text-text shadow-sm"
        >
          {key}
        </kbd>
      ))}
    </div>
  );
}

export function ShortcutsOverlay({ isOpen, onClose }: ShortcutsOverlayProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-base font-semibold text-text">
            <Keyboard size={18} className="text-accent" />
            <span>Keyboard Shortcuts</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-x-8 gap-y-1 p-5 sm:grid-cols-2">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={`${shortcut.keys.join("-")}-${shortcut.description}`}
              className="flex min-h-12 items-center justify-between gap-4 rounded-lg px-3 py-2 hover:bg-surface-hover"
            >
              <ShortcutKeys keys={shortcut.keys} />
              <span className="text-right text-sm text-text-muted">{shortcut.description}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-border bg-background/50 px-5 py-3 text-xs text-text-faint">
          Shortcuts apply while working in Motion Studio.
        </div>
      </div>
    </div>
  );
}
