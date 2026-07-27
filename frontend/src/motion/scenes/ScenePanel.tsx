import { useState } from "react";
import {
  Copy,
  Trash2,
  GripVertical,
  Plus,
} from "lucide-react";
import type { MotionScene } from "../../types/motion";
import { SceneThumbnail } from "./SceneThumbnail";

export interface ScenePanelProps {
  scenes: MotionScene[];
  activeSceneId: string;
  onSelect: (sceneId: string) => void;
  onRename: (sceneId: string, name: string) => void;
  onDuplicate: (sceneId: string) => void;
  onDelete: (sceneId: string) => void;
  onReorder: (sceneId: string, toIndex: number) => void;
  onAdd?: () => void;
}

export function ScenePanel({
  scenes,
  activeSceneId,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
  onAdd,
}: ScenePanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function handleDrop(targetSceneId: string) {
    if (!draggingId || draggingId === targetSceneId) return;
    const targetIndex = scenes.findIndex((s) => s.id === targetSceneId);
    if (targetIndex === -1) return;
    onReorder(draggingId, targetIndex);
    setDraggingId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Scenes</span>
        {onAdd && (
          <button
            type="button"
            title="Add scene"
            onClick={onAdd}
            className="text-text-faint hover:text-text"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {scenes.length === 0 && (
          <p className="text-xs text-text-faint px-3 py-4 text-center">
            No scenes yet — add one from the header.
          </p>
        )}

        {scenes.map((scene) => {
          const active = scene.id === activeSceneId;
          return (
            <div
              key={scene.id}
              draggable
              onDragStart={() => setDraggingId(scene.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(scene.id)}
              onClick={() => onSelect(scene.id)}
              className={`flex items-center gap-1.5 px-2 py-1.5 text-sm cursor-pointer border-l-2 ${
                active
                  ? "bg-accent-dim border-accent text-text"
                  : "border-transparent text-text-muted hover:bg-surface-hover"
              }`}
            >
              <GripVertical size={13} className="text-text-faint shrink-0 cursor-grab" />
              <div className="shrink-0 rounded overflow-hidden border border-border/50 bg-background">
                <SceneThumbnail scene={scene} width={32} height={18} />
              </div>

              {editingId === scene.id ? (
                <input
                  autoFocus
                  defaultValue={scene.name}
                  onBlur={(e) => {
                    onRename(scene.id, e.target.value || scene.name);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-surface border border-accent rounded px-1 text-sm min-w-0"
                />
              ) : (
                <span
                  className="flex-1 truncate"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(scene.id);
                  }}
                  title="Double-click to rename"
                >
                  {scene.name}
                </span>
              )}

              <button
                type="button"
                title="Duplicate scene"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(scene.id);
                }}
                className="text-text-faint hover:text-text shrink-0"
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                title="Delete scene"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(scene.id);
                }}
                className="text-text-faint hover:text-danger shrink-0"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
