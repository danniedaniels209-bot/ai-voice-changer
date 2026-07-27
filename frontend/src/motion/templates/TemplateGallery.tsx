import { TEMPLATES } from "./templates";
import type { MotionScene } from "../../types/motion";

interface TemplateGalleryProps {
  onSelect: (scene: MotionScene) => void;
}

export function TemplateGallery({ onSelect }: TemplateGalleryProps) {
  return (
    <div className="flex flex-col h-full bg-surface border-l border-border">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-faint">Starter Templates</h2>
        <p className="text-xs text-text-muted mt-1">Choose a pre-built template to jumpstart your project.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-3">
          {TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => onSelect(tmpl.factory())}
              className="group text-left flex flex-col p-3 rounded-lg border border-border bg-background hover:border-accent hover:bg-accent-dim transition-colors"
            >
              <div className="w-full aspect-video bg-surface-hover rounded-md mb-2 overflow-hidden flex items-center justify-center border border-border/50">
                <span className="text-text-faint text-xs font-medium">Preview</span>
              </div>
              <h3 className="text-sm font-medium text-text group-hover:text-accent">{tmpl.name}</h3>
              <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{tmpl.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
