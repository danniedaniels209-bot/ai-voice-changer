import { useMemo } from "react";
import { TEMPLATES } from "./templates";
import { SceneThumbnail } from "../scenes/SceneThumbnail";
import type { MotionScene } from "../../types/motion";

interface TemplateGalleryProps {
  onSelect: (scene: MotionScene) => void;
}

/** Preview tile size. The scenes are 1920x1080, and SceneThumbnail scales to
 *  fit while preserving aspect ratio, so these only need to be in the right
 *  proportion. */
const PREVIEW_W = 272;
const PREVIEW_H = 153;

export function TemplateGallery({ onSelect }: TemplateGalleryProps) {
  // Build each template's scene ONCE and reuse it for both the preview and
  // the click. Calling factory() on every render would rebuild every scene
  // (and mint fresh layer ids) on each keystroke elsewhere in the dialog.
  //
  // Reusing the previewed scene as the inserted one also guarantees the user
  // gets exactly what they saw — building it twice would be two different
  // objects, and any nondeterminism in a factory would make the preview a
  // lie. TEMPLATES is a module constant, so this never needs to recompute.
  const previews = useMemo(
    () => TEMPLATES.map((tmpl) => ({ tmpl, scene: tmpl.factory() })),
    [],
  );

  return (
    <div className="flex flex-col h-full bg-surface border-l border-border">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-faint">Starter Templates</h2>
        <p className="text-xs text-text-muted mt-1">Choose a pre-built template to jumpstart your project.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-3">
          {previews.map(({ tmpl, scene }) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => onSelect(scene)}
              className="group text-left flex flex-col p-3 rounded-lg border border-border bg-background hover:border-accent hover:bg-accent-dim transition-colors"
            >
              {/* A real render of the template's first frame, via the same
                  component the scene list uses — rather than the word
                  "Preview", which told the user nothing about what they were
                  about to pick. */}
              <div className="w-full rounded-md mb-2 overflow-hidden border border-border/50 bg-background flex items-center justify-center">
                <SceneThumbnail scene={scene} width={PREVIEW_W} height={PREVIEW_H} />
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
