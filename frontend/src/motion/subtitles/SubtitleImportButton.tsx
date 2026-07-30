/**
 * Toolbar button + its modal, bundled so MotionEditor.tsx needs exactly ONE
 * JSX line (plus the import) to gain the whole feature.
 *
 * That packaging is the point: MotionEditor.tsx and Inspector.tsx are
 * contested files on this project, and a feature that needs a useState, a
 * handler and a <Modal/> spread across the parent is three separate merge
 * conflicts waiting to happen. Owning the open/closed state locally costs
 * nothing — nobody else needs to open this dialog — and keeps the blast
 * radius in the shared file to a single line.
 */

import { useState } from "react";
import { Captions } from "lucide-react";
import type { AudioTrack, MotionLayer } from "../../types/motion";
import { SubtitleImportModal } from "./SubtitleImportModal";

export interface SubtitleImportButtonProps {
  projectId?: string;
  audioTracks?: AudioTrack[];
  sceneWidth: number;
  sceneHeight: number;
  sceneDurationMs: number;
  onInsertLayers: (layers: MotionLayer[]) => void;
}

export function SubtitleImportButton(props: SubtitleImportButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="Import or auto-generate subtitles — burn captions into this scene as text layers"
        onClick={() => setOpen(true)}
        className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
      >
        <Captions size={16} />
      </button>
      <SubtitleImportModal isOpen={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}
