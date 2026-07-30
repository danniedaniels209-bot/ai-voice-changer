import { useState, useCallback } from "react";
import { Lock, Unlock, Eye, EyeOff, Square, Circle, Type, Image as ImageIcon, Film, GripVertical, Search, Hexagon as PolygonIcon, Star as StarIcon, Triangle as TriangleIcon, Minus, ArrowRight, Copy, Folder as FolderIcon, FolderOpen, ChevronRight, ChevronDown, Plus, Captions } from "lucide-react";
import type { LayerType, MotionLayer } from "../types/motion";
import { visibleLayerIds, type TypeFilter } from "./layerFilter";
import { groupIdOf, groupTagText } from "./subtitles/subtitleGroup";

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

const TYPE_LABELS: Record<LayerType, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  image: "Image",
  video: "Video",
  polygon: "Polygon",
  star: "Star",
  triangle: "Triangle",
  line: "Line",
  arrow: "Arrow",
};

const TYPE_FILTER_OPTIONS = Object.keys(TYPE_LABELS) as LayerType[];

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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // LT-LAYERSEARCH. null = no filter active, render the whole tree exactly
  // as before. When a filter IS active, a layer renders only if it's a
  // match, an ancestor of one (so the path down still shows), or a
  // descendant of one (so matching a folder's name reveals its contents).
  const visibleIds = visibleLayerIds(layers, query, typeFilter);
  const filtering = visibleIds !== null;

  const renderTree = useCallback(
    (layer: MotionLayer, depth: number): React.ReactNode => {
      // LT-LAYERSEARCH: while a filter is active, a layer that isn't in
      // the computed visible set renders nothing at all — not greyed out,
      // not collapsed, absent. That's what makes "40 captions -> 3 matches"
      // actually usable instead of just highlighted noise.
      if (visibleIds && !visibleIds.has(layer.id)) return null;

      const Icon = layer.is_folder
        ? collapsedFolders.has(layer.id)
          ? FolderIcon
          : FolderOpen
        : ICONS[layer.type];
      const selected = selectedLayerIds.includes(layer.id);
      const hasChildren = layers.some((l) => l.parent_id === layer.id);
      const groupId = groupIdOf(layer);

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
            {groupId && (
              <button
                type="button"
                title="Show only this subtitle import's layers"
                onClick={(e) => {
                  e.stopPropagation();
                  // The exact tag substring, not a friendlier label — the
                  // search matches against the RAW name (see layerFilter.ts),
                  // so this is the one string guaranteed to match every
                  // layer from this import and nothing from any other one.
                  setQuery(groupTagText(groupId));
                }}
                className="text-text-faint hover:text-accent shrink-0"
              >
                <Captions size={12} />
              </button>
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
          {hasChildren && (filtering || !collapsedFolders.has(layer.id)) && (
            <ChildrenList parentId={layer.id} depth={depth + 1} />
          )}
        </div>
      );
    },
    [layers, selectedLayerIds, collapsedFolders, editingId, draggingId, visibleIds, filtering, onSelect, onRename, onReorder, onDuplicate, onToggleHidden, onToggleLock],
  );

  function ChildrenList({ parentId, depth }: { parentId: string; depth: number }) {
    const children = layers.filter((l) => l.parent_id === parentId);
    return <>{children.map((child) => renderTree(child, depth))}</>;
  }

  const topLevel = layers.filter(
    (l) => !l.parent_id || !layers.some((p) => p.id === l.parent_id),
  );

  // Top-level layers to actually render: while filtering, a top-level
  // layer only shows if IT (or something under it) is in the visible set
  // -- `renderTree` handles the recursive part, this just decides which
  // roots to start from.
  const visibleTopLevel = visibleIds ? topLevel.filter((l) => visibleIds.has(l.id)) : topLevel;
  const orderedLayers = [...visibleTopLevel].reverse();

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
        <div className="px-2 py-1.5 border-b border-border shrink-0 space-y-1.5">
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
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="w-full bg-background border border-border rounded px-1.5 py-1 text-xs
                       text-text focus:outline-none focus:border-accent"
          >
            <option value="all">All types</option>
            {TYPE_FILTER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {orderedLayers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-6 text-center text-text-muted mt-4">
            {filtering ? (
              <p className="text-xs">
                No layers match{query.trim() ? ` "${query}"` : ""}
                {typeFilter !== "all" ? ` (type: ${TYPE_LABELS[typeFilter]})` : ""}.
              </p>
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
