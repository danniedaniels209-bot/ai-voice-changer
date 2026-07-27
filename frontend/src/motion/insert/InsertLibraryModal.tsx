/**
 * Insert Library: everything you can add to a scene, in one scrollable
 * panel — mockup components, charts & diagrams, callouts, cursor animations,
 * device frames, text reveal, and video import.
 *
 * Deliberately NOT tabbed by topic. Splitting these into category tabs meant
 * you had to already know which bucket a thing lived in before you could find
 * it; laying everything out at once lets you scan the whole library and pick
 * whatever fits. Motion presets stay in the Inspector — they animate the
 * SELECTED layer rather than insert a new one, so they're a different tool.
 */

import { X, Shapes } from "lucide-react";
import { ComponentLibraryPanel } from "../components/ComponentLibraryPanel";
import { ChartLibraryPanel } from "../charts/ChartLibraryPanel";
import { CalloutPicker } from "../callouts/CalloutPicker";
import { CursorPicker } from "../cursor/CursorPicker";
import { DeviceFramePicker } from "../deviceframes/DeviceFramePicker";
import { TextFxPicker } from "../textfx/TextFxPicker";
import { VideoImportPanel } from "../video/VideoImportPanel";
import type { MotionLayer } from "../../types/motion";

export interface InsertLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertLayers: (layers: MotionLayer[]) => void;
  onImportVideo: (file: File) => void;
}

export function InsertLibraryModal({ isOpen, onClose, onInsertLayers, onImportVideo }: InsertLibraryModalProps) {
  if (!isOpen) return null;

  function insertAndClose(layers: MotionLayer[]) {
    onInsertLayers(layers);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-semibold text-base text-text">
            <Shapes size={18} className="text-accent" />
            <span>Insert</span>
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

        <div className="p-4 overflow-y-auto space-y-3">
          {/* Video first — footage is usually the base layer everything else
              annotates, so it's the thing you reach for before any graphic. */}
          <div className="border border-border rounded-lg bg-surface p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">Video</h3>
            <div className="h-[280px]">
              <VideoImportPanel
                onImport={(file) => {
                  onImportVideo(file);
                  onClose();
                }}
              />
            </div>
          </div>
          <ComponentLibraryPanel onInsert={insertAndClose} />
          <ChartLibraryPanel onInsert={insertAndClose} />
          <CalloutPicker onInsert={insertAndClose} />
          <CursorPicker onInsert={insertAndClose} />
          <DeviceFramePicker onInsert={insertAndClose} />
          <TextFxPicker onInsert={insertAndClose} />
        </div>
      </div>
    </div>
  );
}
