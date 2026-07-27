import { TRANSITION_DEFINITIONS } from "./transitions";

export interface TransitionPickerProps {
  onSelect: (transitionId: string) => void;
  className?: string;
  title?: string;
}

export function TransitionPicker({
  onSelect,
  className = "",
  title = "Scene Transitions",
}: TransitionPickerProps) {
  return (
    <div className={`flex flex-col h-full bg-surface border-l border-border ${className}`}>
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        <p className="text-sm text-text-muted mt-1">
          Select a transition effect to apply between scenes.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-3">
          {TRANSITION_DEFINITIONS.map((def) => (
            <button
              key={def.id}
              onClick={() => onSelect(def.id)}
              className="group flex flex-col items-center p-3 rounded-lg border border-border bg-surface hover:bg-accent-dim hover:border-accent transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-background"
              title={`${def.label} (${def.duration_ms}ms)`}
            >
              <div className="w-12 h-12 flex items-center justify-center bg-background rounded-md border border-border mb-2 text-2xl text-text-faint group-hover:text-accent transition-colors">
                {def.previewGlyph}
              </div>
              <span className="text-xs font-medium text-text-muted group-hover:text-text truncate w-full text-center">
                {def.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
