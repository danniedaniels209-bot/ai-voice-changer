import { useEffect, useMemo, useRef, useState } from "react";
import { X, CornerDownLeft, Search } from "lucide-react";

export interface CommandItem {
  id: string;
  label: string;
  icon?: string;
  onRun: () => void;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState<string>("");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset query + selection whenever the palette opens.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setHighlightedIndex(0);
      // Focus the input on next tick after the modal mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Case-insensitive substring filter on label.
  const filtered = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [query, commands]);

  // Keep the highlighted index in range as the filtered list changes.
  useEffect(() => {
    if (highlightedIndex >= filtered.length) {
      setHighlightedIndex(filtered.length === 0 ? 0 : filtered.length - 1);
    }
  }, [filtered.length, highlightedIndex]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-cmd-index="${highlightedIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  if (!isOpen) return null;

  function runCommand(item: CommandItem | undefined) {
    if (!item) return;
    item.onRun();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) =>
        filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(filtered[highlightedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[15vh] p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={16} className="text-text-faint shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-text-faint"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-text-faint">
              No matching commands.
            </div>
          ) : (
            filtered.map((cmd, i) => {
              const isHighlighted = i === highlightedIndex;
              return (
                <button
                  type="button"
                  key={cmd.id}
                  data-cmd-index={i}
                  onMouseMove={() => setHighlightedIndex(i)}
                  onClick={() => runCommand(cmd)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left ${
                    isHighlighted ? "bg-accent-dim text-text" : "text-text-muted hover:bg-surface-hover"
                  }`}
                >
                  <span className="shrink-0 w-5 text-center text-text-faint">
                    {cmd.icon ?? ""}
                  </span>
                  <span className="flex-1 truncate">{cmd.label}</span>
                  {isHighlighted && (
                    <span className="shrink-0 text-text-faint flex items-center gap-1 text-[10px]">
                      <CornerDownLeft size={12} />
                      Enter
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-[10px] text-text-faint flex items-center justify-between bg-background/50">
          <span>
            <kbd className="px-1 py-0.5 border border-border rounded">↑</kbd>
            <kbd className="ml-1 px-1 py-0.5 border border-border rounded">↓</kbd>
            to navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 border border-border rounded">Enter</kbd>
            to run · <kbd className="ml-1 px-1 py-0.5 border border-border rounded">Esc</kbd>
            to close
          </span>
        </div>
      </div>
    </div>
  );
}
