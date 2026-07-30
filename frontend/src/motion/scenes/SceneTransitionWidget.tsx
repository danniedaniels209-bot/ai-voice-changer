import { useState, useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { TRANSITION_DEFINITIONS } from "../transitions/transitions";

const PREVIEW_CSS = `
@keyframes t-preview-fade {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
@keyframes t-preview-slide-left {
  0% { transform: translateX(16px); opacity: 0.2; }
  100% { transform: translateX(0); opacity: 1; }
}
@keyframes t-preview-slide-right {
  0% { transform: translateX(-16px); opacity: 0.2; }
  100% { transform: translateX(0); opacity: 1; }
}
@keyframes t-preview-slide-up {
  0% { transform: translateY(12px); opacity: 0.2; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes t-preview-slide-down {
  0% { transform: translateY(-12px); opacity: 0.2; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes t-preview-push {
  0% { transform: translateX(24px); }
  100% { transform: translateX(0); }
}
@keyframes t-preview-zoom {
  0% { transform: scale(0.1); }
  60% { transform: scale(1.15); }
  100% { transform: scale(1); }
}
@keyframes t-preview-wipe {
  0% { clip-path: inset(0 100% 0 0); }
  100% { clip-path: inset(0 0 0 0); }
}
@keyframes t-preview-dissolve {
  0% { opacity: 0; transform: scale(0.92); }
  50% { opacity: 0.7; transform: scale(1.02); }
  100% { opacity: 1; transform: scale(1); }
}
`;

const PREVIEW_STYLE: Record<string, React.CSSProperties> = {
  "fade": { animation: "t-preview-fade 1.2s ease-in-out infinite" },
  "slide-left": { animation: "t-preview-slide-left 0.8s ease-out infinite" },
  "slide-right": { animation: "t-preview-slide-right 0.8s ease-out infinite" },
  "slide-up": { animation: "t-preview-slide-up 0.8s ease-out infinite" },
  "slide-down": { animation: "t-preview-slide-down 0.8s ease-out infinite" },
  "push": { animation: "t-preview-push 0.7s linear infinite" },
  "zoom": { animation: "t-preview-zoom 1s ease-out infinite" },
  "wipe": { animation: "t-preview-wipe 0.9s ease-in-out infinite" },
  "dissolve": { animation: "t-preview-dissolve 1.2s ease-in-out infinite" },
};

export interface SceneTransitionWidgetProps {
  sceneId: string;
  transitionId: string | null | undefined;
  onApplyTransition: (sceneId: string, transitionId: string) => void;
  onClearTransition: (sceneId: string) => void;
}

export function SceneTransitionWidget({
  sceneId,
  transitionId,
  onApplyTransition,
  onClearTransition,
}: SceneTransitionWidgetProps) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const activeDef = TRANSITION_DEFINITIONS.find((d) => d.id === transitionId);
  const hasTransition = !!activeDef;

  const handleSelect = useCallback(
    (id: string) => {
      onApplyTransition(sceneId, id);
      setOpen(false);
    },
    [sceneId, onApplyTransition],
  );

  const handleToggle = useCallback(() => {
    if (open) {
      setOpen(false);
    } else if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 260) });
      setOpen(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!triggerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div>
      <style>{PREVIEW_CSS}</style>

      <div
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-3 py-1 cursor-pointer border-b border-border/30 text-[11px] text-text-faint hover:text-text hover:bg-surface-hover transition-colors group"
      >
        <div className="w-5 h-3 rounded-[2px] bg-accent/20 flex items-center justify-center overflow-hidden shrink-0">
          <div
            className="w-3.5 h-[6px] rounded-[1px] bg-accent/60"
            style={hasTransition ? PREVIEW_STYLE[transitionId!] : undefined}
          />
        </div>
        <span className="truncate flex-1">
          {hasTransition ? activeDef!.label : "No transition"}
        </span>
        {hasTransition && (
          <span className="text-[10px] text-text-faint">{activeDef!.previewGlyph}</span>
        )}
        {hasTransition ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearTransition(sceneId);
            }}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-hover text-text-faint hover:text-danger transition-all"
            title="Remove transition"
          >
            <X size={10} />
          </button>
        ) : (
          <span className="text-[9px] text-text-faint flex items-center gap-0.5">
            pick +
          </span>
        )}
      </div>

      {open && popoverPos && (
        <div
          className="fixed z-50 bg-surface border border-border rounded-lg shadow-xl p-2"
          style={{ top: popoverPos.top, left: popoverPos.left, minWidth: popoverPos.width }}
        >
          <div className="grid grid-cols-3 gap-1.5">
            {TRANSITION_DEFINITIONS.map((def) => {
              const selected = def.id === transitionId;
              return (
                <button
                  key={def.id}
                  onClick={() => handleSelect(def.id)}
                  className={`flex flex-col items-center p-2 rounded-md border transition-colors ${
                    selected
                      ? "border-accent bg-accent-dim text-text"
                      : "border-border bg-background text-text-muted hover:border-accent hover:bg-accent-dim hover:text-text"
                  }`}
                >
                  <div className="w-10 h-7 flex items-center justify-center bg-surface rounded border border-border/50 mb-1 overflow-hidden">
                    <div
                      className="w-7 h-4 rounded bg-accent/40"
                      style={PREVIEW_STYLE[def.id]}
                    />
                  </div>
                  <span className="text-[10px] font-medium leading-tight truncate w-full text-center">
                    {def.label}
                  </span>
                  <span className="text-[9px] text-text-faint">{def.previewGlyph}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
