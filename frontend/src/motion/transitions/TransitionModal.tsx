/**
 * Scene transition picker, in a modal.
 *
 * TransitionPicker is a bare presentational grid built as a side panel; the
 * editor has no free side rail, so this wraps it in the same modal shell the
 * Insert library uses. Picking a transition animates every eligible layer in
 * the current scene in, via applyTransitionToScene.
 */

import { X, Wand2 } from "lucide-react";
import { TransitionPicker } from "./TransitionPicker";

export interface TransitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the chosen transition id. The caller turns it into keyframes
   *  and dispatches them — this component owns no editor state. */
  onSelect: (transitionId: string) => void;
}

export function TransitionModal({ isOpen, onClose, onSelect }: TransitionModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-semibold text-base text-text">
            <Wand2 size={18} className="text-accent" />
            <span>Animate scene in</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto">
          <TransitionPicker
            onSelect={(id) => {
              onSelect(id);
              onClose();
            }}
            title="Transitions"
          />
        </div>
      </div>
    </div>
  );
}
