import { useState, useCallback } from "react";
import { Lock, Unlock, Eye, EyeOff, Square, Circle, Type, Image as ImageIcon, Film, GripVertical, Search, Hexagon as PolygonIcon, Star as StarIcon, Triangle as TriangleIcon, Minus, ArrowRight, Copy, Folder as FolderIcon, FolderOpen, ChevronRight, ChevronDown, Plus } from "lucide-react";
import type { LayerType, MotionLayer } from "../types/motion";

interface LayerPanelProps {
  layers: MotionLayer[];
  selectedLayerIds: string[];
  onSelect: (ids: string[]) => void;
  onRename: (layerId: string, name: string) => void;
  onToggleLock: (layerId: string) => void;
  onToggleHidden: (layerId: string) => void;
  onReorder: (layerId: string, toIndex: number) => void;
  onDuplicate: (layerId: string) => void;
  onDelete: () => void;
  onOpenInsert?: () => void;
  onAddLayer?: (type: LayerType) => void;
}

const ICONS: Record<LayerType, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  text: Type,
  image: ImageIcon,
  video: Film,
  polygon: PolygonIcon,
  star: StarIcon,
  triangle: TriangleIcon,
  line: Minus,
  arrow: ArrowRight,
};

export function LayerPanel({
  layers,
  selectedLayerIds,
  onSelect,
  onRename,
  onToggleLock,
  onToggleHidden,
  onReorder,
  onDuplicate,
  onDelete,
  onOpenInsert,
  onAddLayer,
}: LayerPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const renderTree = useCallback(
    (layer: MotionLayer, depth: number): React.ReactNode => {
      const Icon = layer.is_folder
        ? collapsedFolders.has(layer.id)
          ? FolderIcon
          : FolderOpen
        : ICONS[layer.type];
      const selected = selectedLayerIds.includes(layer.id);
      const hasChildren = layers.some((l) => l.parent_id === layer.id);

      return (
        <div key={layer.id}>
          <div
            draggable
            onDragStart={() => setDraggingId(layer.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!draggingId || draggingId === layer.id) return;
              const targetIndex = layers.findIndex((l) => l.id === layer.id);
              onReorder(draggingId, targetIndex);
              setDraggingId(null);
            }}
            onClick={(e) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) {
                onSelect(
                  selected
                    ? selectedLayerIds.filter((id) => id !== layer.id)
                    : [...selectedLayerIds, layer.id],
                );
              } else {
                onSelect([layer.id]);
              }
            }}
            title="Click to select — Shift/Ctrl+click to select multiple"
            className={`flex items-center gap-1.5 px-2 py-1.5 text-sm cursor-pointer border-l-2 ${
              selected
                ? "bg-accent-dim border-accent text-text"
                : "border-transparent text-text-muted hover:bg-surface-hover"
            } ${layer.hidden ? "opacity-50" : ""}`}
            style={{
              ...(layer.color && !selected ? { borderLeftColor: layer.color } : {}),
              paddingLeft: 8 + depth * 16,
            }}
          >
            {layer.is_folder && hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(layer.id)) next.delete(layer.id);
                    else next.add(layer.id);
                    return next;
                  });
                }}
                className="text-text-faint hover:text-text shrink-0 p-0.5"
              >
                {collapsedFolders.has(layer.id) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
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
              title="Duplicate layer"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(layer.id);
              }}
              className="text-text-faint hover:text-text shrink-0"
            >
              <Copy size={12} />
            </button>
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
          {hasChildren && !collapsedFolders.has(layer.id) && (
            <ChildrenList parentId={layer.id} depth={depth + 1} />
          )}
        </div>
      );
    },
    [layers, selectedLayerIds, collapsedFolders, editingId, draggingId, onSelect, onRename, onReorder, onDuplicate, onToggleHidden, onToggleLock],
  );

  function ChildrenList({ parentId, depth }: { parentId: string; depth: number }) {
    const children = layers.filter((l) => l.parent_id === parentId);
    return <>{children.map((child) => renderTree(child, depth))}</>;
  }

  const topLevel = layers.filter(
    (l) => !l.parent_id || !layers.some((p) => p.id === l.parent_id),
  );

  const q = query.trim().toLowerCase();
  const orderedLayers = (q
    ? [...topLevel].reverse().filter((l) => l.name.toLowerCase().includes(q))
    : [...topLevel].reverse()
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Layers</span>
        <div className="flex items-center gap-1">
          {onAddLayer && (
            <button
              type="button"
              title="Add folder"
              onClick={(e) => {
                e.stopPropagation();
                onAddLayer("folder" as LayerType);
              }}
              className="text-text-faint hover:text-text text-xs shrink-0"
            >
              Folder
            </button>
          )}
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
      </div>

      {layers.length > 5 && (
        <div className="px-2 py-1.5 border-b border-border shrink-0">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter layers…"
              className="w-full bg-background border border-border rounded pl-6 pr-2 py-1 text-xs
                         text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {orderedLayers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-6 text-center text-text-muted mt-4">
            {q ? (
              <p className="text-xs">No layers match "{query}".</p>
            ) : (
              <>
                <Square size={24} className="mb-3 text-text-faint/70" />
                <h4 className="text-sm font-medium text-text mb-1">Scene is empty</h4>
                <p className="text-xs text-text-faint mb-4 leading-relaxed max-w-[180px]">
                  Layers appear here. Add shapes, text, or import media to start.
                </p>
                {onOpenInsert && (
                  <button
                    type="button"
                    onClick={onOpenInsert}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover hover:bg-accent hover:text-white transition-colors border border-border rounded text-xs font-medium text-text"
                  >
                    <Plus size={14} />
                    Add Layer
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {orderedLayers.map((layer) => renderTree(layer, 0))}
      </div>
    </div>
  );
}
