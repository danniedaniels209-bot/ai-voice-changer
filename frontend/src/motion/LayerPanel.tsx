import { useState } from "react";
import { Lock, Unlock, Eye, EyeOff, Square, Circle, Type, Image as ImageIcon, Film, GripVertical } from "lucide-react";
import type { LayerType, MotionLayer } from "../types/motion";

interface LayerPanelProps {
  layers: MotionLayer[];
  selectedLayerIds: string[];
  onSelect: (ids: string[]) => void;
  onRename: (layerId: string, name: string) => void;
  onToggleLock: (layerId: string) => void;
  onToggleHidden: (layerId: string) => void;
  onReorder: (layerId: string, toIndex: number) => void;
  onDelete: () => void;
}

const ICONS: Record<LayerType, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  text: Type,
  image: ImageIcon,
  video: Film,
};

export function LayerPanel({
  layers,
  selectedLayerIds,
  onSelect,
  onRename,
  onToggleLock,
  onToggleHidden,
  onReorder,
  onDelete,
}: LayerPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Layer panel convention: topmost row = topmost in the stacking order
  // (rendered last / on top), so reverse the underlying bottom-to-top array.
  const displayLayers = [...layers].reverse();

  function handleDrop(targetLayerId: string) {
    if (!draggingId || draggingId === targetLayerId) return;
    const targetIndex = layers.findIndex((l) => l.id === targetLayerId);
    onReorder(draggingId, targetIndex);
    setDraggingId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Layers</span>
        {selectedLayerIds.length > 0 && (
          <button
            type="button"
            title="Delete selected layer(s)"
            onClick={onDelete}
            className="text-xs text-danger hover:opacity-80"
          >
            Delete
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {displayLayers.length === 0 && (
          <p className="text-xs text-text-faint px-3 py-4 text-center">
            No layers yet — add a shape, text, or image from the toolbar.
          </p>
        )}
        {displayLayers.map((layer) => {
          const Icon = ICONS[layer.type];
          const selected = selectedLayerIds.includes(layer.id);
          return (
            <div
              key={layer.id}
              draggable
              onDragStart={() => setDraggingId(layer.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(layer.id)}
              onClick={(e) => {
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  // Toggle: add if not selected, remove if it is — the
                  // standard multi-select gesture (needed for alignment
                  // and distribution, which require 2+ layers).
                  onSelect(
                    selected
                      ? selectedLayerIds.filter((id) => id !== layer.id)
                      : [...selectedLayerIds, layer.id],
                  );
                } else {
                  onSelect([layer.id]);
                }
              }}
              title="Click to select — Shift/Ctrl+click to select multiple (for align/distribute)"
              className={`flex items-center gap-1.5 px-2 py-1.5 text-sm cursor-pointer border-l-2 ${
                selected
                  ? "bg-accent-dim border-accent text-text"
                  : "border-transparent text-text-muted hover:bg-surface-hover"
              } ${layer.hidden ? "opacity-50" : ""}`}
            >
              <GripVertical size={13} className="text-text-faint shrink-0 cursor-grab" />
              <Icon size={14} className="shrink-0" />
              {editingId === layer.id ? (
                <input
                  autoFocus
                  defaultValue={layer.name}
                  onBlur={(e) => {
                    onRename(layer.id, e.target.value || layer.name);
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
                    setEditingId(layer.id);
                  }}
                  title="Double-click to rename"
                >
                  {layer.name}
                </span>
              )}
              <button
                type="button"
                title={layer.hidden ? "Show layer" : "Hide layer"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHidden(layer.id);
                }}
                className="text-text-faint hover:text-text shrink-0"
              >
                {layer.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                title={layer.locked ? "Unlock layer" : "Lock layer"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLock(layer.id);
                }}
                className="text-text-faint hover:text-text shrink-0"
              >
                {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
