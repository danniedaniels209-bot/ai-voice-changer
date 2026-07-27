import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Square,
  Circle,
  Type,
  Image as ImageIcon,
  Undo2,
  Redo2,
  ArrowLeft,
  Check,
  Loader2,
  Film,
  Shapes,
  HelpCircle,
} from "lucide-react";
import { getMotionProject, saveMotionProject } from "../api/motion";
import { editorReducer, getResolvedTransform, type EditorState } from "../motion/state";
import { createLayer } from "../motion/layerFactory";
import { usePlaybackClock } from "../motion/usePlaybackClock";
import { applyPreset, type PresetId } from "../motion/presets/motionPresets";
import { MotionCanvas } from "../motion/MotionCanvas";
import { LayerPanel } from "../motion/LayerPanel";
import { Inspector } from "../motion/Inspector";
import { Timeline } from "../motion/Timeline";
import { ExportDialog } from "../motion/export/ExportDialog";
import { ScenePanel } from "../motion/scenes/ScenePanel";
import { AudioTrackPanel } from "../motion/audio/AudioTrackPanel";
import { InsertLibraryModal } from "../motion/insert/InsertLibraryModal";
import { AlignmentToolbar } from "../motion/align/AlignmentToolbar";
import { ALIGN_OPERATIONS, type AlignKind } from "../motion/align/alignment";
import { CommandPalette, type CommandItem } from "../motion/palette/CommandPalette";
import { ShortcutsOverlay } from "../motion/help/ShortcutsOverlay";
import { HistoryPanel } from "../motion/history/HistoryPanel";
import type { AnimatableProperty, LayerType, MotionLayer, Transform } from "../types/motion";

const INITIAL_STATE: EditorState = {
  project: { id: "", name: "", scenes: [], created_at: "", updated_at: "" },
  activeSceneId: "",
  selectedLayerIds: [],
  past: [],
  future: [],
  dirty: false,
  playheadMs: 0,
};

const AUTOSAVE_DELAY_MS = 1200;

export function MotionEditor() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(editorReducer, INITIAL_STATE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [exportOpen, setExportOpen] = useState(false);
  const [activeAudioTrackId, setActiveAudioTrackId] = useState<string | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!projectId) return;
    getMotionProject(projectId)
      .then((project) => dispatch({ type: "LOAD_PROJECT", project }))
      .catch((err) => setLoadError(String(err)));
  }, [projectId]);

  // Autosave: debounced so a drag or a burst of edits doesn't fire a save
  // per keystroke — waits for a short pause in activity instead.
  useEffect(() => {
    if (!state.dirty || !state.project.id) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const saved = await saveMotionProject(state.project);
        dispatch({ type: "MARK_SAVED", project: saved });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("idle");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [state.dirty, state.project]);

  // Keyboard shortcuts: undo/redo and delete, ignored while typing in a
  // text field/input so they don't fight with normal editing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault(); // otherwise browsers steal Ctrl+K for the address bar
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch({ type: "DELETE_SELECTED_LAYERS" });
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Hooks must run unconditionally on every render — computed with a safe
  // fallback (the project hasn't loaded yet on the first render or two, so
  // there's no real scene/duration to read) rather than after the
  // loading/error early-returns below, which would change the hook count
  // between renders and trip React's "rendered fewer/more hooks" error.
  const scene = state.project.scenes.find((s) => s.id === state.activeSceneId);
  const playback = usePlaybackClock(scene?.duration_ms ?? 5000, state.playheadMs, (ms) =>
    dispatch({ type: "SET_PLAYHEAD", timeMs: ms }),
  );

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3">
        <p className="text-danger text-sm">{loadError}</p>
        <button onClick={() => navigate("/motion")} className="text-accent text-sm hover:underline">
          Back to projects
        </button>
      </div>
    );
  }

  if (!state.project.id || !scene) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Loading…</div>
    );
  }

  const activeScene = scene; // narrowed non-null past the guard above
  const selectedLayer = activeScene.layers.find((l) => l.id === state.selectedLayerIds[0]) ?? null;

  function addLayer(type: LayerType) {
    dispatch({ type: "ADD_LAYER", layer: createLayer(type) });
  }

  function handleApplyPreset(presetId: PresetId) {
    if (!selectedLayer) return;
    const keyframes = applyPreset(presetId, selectedLayer, activeScene.duration_ms);
    dispatch({ type: "APPLY_KEYFRAMES", layerId: selectedLayer.id, keyframes });
  }

  function handleInsertLayers(layers: MotionLayer[]) {
    dispatch({ type: "ADD_LAYERS", layers });
  }

  function handleAlign(kind: AlignKind) {
    const selectedLayers = activeScene.layers.filter((l) => state.selectedLayerIds.includes(l.id));
    if (selectedLayers.length < 2) return;
    const aligned = ALIGN_OPERATIONS[kind](selectedLayers.map((l) => l.transform));
    const updates = selectedLayers.map((l, i) => ({ layerId: l.id, transform: aligned[i] }));
    dispatch({ type: "ALIGN_LAYERS", updates });
  }

  function handleImportVideo(file: File) {
    // No upload/storage backend for imported media yet — an object URL is
    // only valid for this browser tab's lifetime, so the video won't
    // survive a reload. Good enough to preview and arrange in the editor;
    // real asset persistence is a separate piece of work.
    const url = URL.createObjectURL(file);
    dispatch({ type: "ADD_LAYER", layer: createLayer("video", { src: url }) });
  }

  const commands: CommandItem[] = [
    { id: "add-rect", label: "Add Rectangle", icon: "▭", onRun: () => addLayer("rect") },
    { id: "add-ellipse", label: "Add Ellipse", icon: "◯", onRun: () => addLayer("ellipse") },
    { id: "add-text", label: "Add Text", icon: "T", onRun: () => addLayer("text") },
    { id: "add-image", label: "Add Image", icon: "🖼", onRun: () => addLayer("image") },
    { id: "import-video", label: "Import Video…", icon: "🎬", onRun: () => videoInputRef.current?.click() },
    { id: "open-insert", label: "Open Insert Library…", icon: "✦", onRun: () => setInsertOpen(true) },
    { id: "add-scene", label: "Add Scene", icon: "+", onRun: () => dispatch({ type: "ADD_SCENE" }) },
    { id: "export", label: "Export…", icon: "⬇", onRun: () => setExportOpen(true) },
    { id: "undo", label: "Undo", icon: "↶", onRun: () => dispatch({ type: "UNDO" }) },
    { id: "redo", label: "Redo", icon: "↷", onRun: () => dispatch({ type: "REDO" }) },
    {
      id: "delete-selected",
      label: "Delete Selected",
      icon: "✕",
      onRun: () => dispatch({ type: "DELETE_SELECTED_LAYERS" }),
    },
    { id: "shortcuts", label: "Keyboard Shortcuts…", icon: "⌨", onRun: () => setShortcutsOpen(true) },
  ];

  /** Dragging/resizing a layer that has NO keyframes on the affected
   * property edits its static base transform, same as M1. Once a property
   * IS animated, dragging instead pins a new keyframe at the current
   * playhead time — editing the base transform of an already-animated
   * property wouldn't even be visible (the interpolation would still win),
   * so auto-keyframing is the only behavior that makes the drag feel real. */
  function applyTransformEdit(layerId: string, patch: Partial<Transform>) {
    const layer = activeScene.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const animated = new Set(layer.keyframes.map((k) => k.property));
    const toBase: Partial<Transform> = {};
    for (const [key, value] of Object.entries(patch) as [keyof Transform, number][]) {
      if (animated.has(key as AnimatableProperty)) {
        dispatch({ type: "SET_KEYFRAME", layerId, property: key as AnimatableProperty, timeMs: state.playheadMs, value });
      } else {
        toBase[key] = value;
      }
    }
    if (Object.keys(toBase).length > 0) {
      dispatch({ type: "UPDATE_TRANSFORM", layerId, patch: toBase });
    }
  }

  return (
    <div className="flex flex-col h-full w-full min-w-0">
      {/* ── Toolbar ── */}
      <div className="h-12 shrink-0 border-b border-border flex items-center gap-1 px-2">
        <button
          type="button"
          title="Back to projects"
          onClick={() => navigate("/motion")}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-medium px-1 truncate max-w-[200px]">{state.project.name}</span>

        <div className="w-px h-5 bg-border mx-1.5" />

        <button
          type="button"
          title="Add rectangle"
          onClick={() => addLayer("rect")}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <Square size={16} />
        </button>
        <button
          type="button"
          title="Add ellipse"
          onClick={() => addLayer("ellipse")}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <Circle size={16} />
        </button>
        <button
          type="button"
          title="Add text"
          onClick={() => addLayer("text")}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <Type size={16} />
        </button>
        <button
          type="button"
          title="Add image"
          onClick={() => addLayer("image")}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <ImageIcon size={16} />
        </button>
        {/* Video gets its own toolbar button rather than living only inside
            the Insert library — footage is the usual starting point here, so
            it shouldn't take two clicks and a scroll to reach. */}
        <button
          type="button"
          title="Import video"
          onClick={() => videoInputRef.current?.click()}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <Film size={16} />
        </button>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportVideo(file);
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          title="Insert from library (video, components, charts, callouts, cursors, device frames, text reveal)"
          onClick={() => setInsertOpen(true)}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <Shapes size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1.5" />

        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: "UNDO" })}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: "REDO" })}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Redo2 size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1.5" />

        <AlignmentToolbar onAlign={handleAlign} selectedCount={state.selectedLayerIds.length} />

        <div className="flex-1" />

        <span className="text-xs text-text-faint flex items-center gap-1.5 pr-2">
          {saveStatus === "saving" && (
            <>
              <Loader2 size={12} className="animate-spin" /> Saving…
            </>
          )}
          {saveStatus === "saved" && !state.dirty && (
            <>
              <Check size={12} className="text-success" /> Saved
            </>
          )}
        </span>

        <button
          type="button"
          title="Keyboard shortcuts (?)"
          onClick={() => setShortcutsOpen(true)}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <HelpCircle size={16} />
        </button>

        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90"
        >
          <Film size={14} />
          Export
        </button>
      </div>

      <ExportDialog
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        projectId={state.project.id}
        sceneId={activeScene.id}
      />

      <InsertLibraryModal
        isOpen={insertOpen}
        onClose={() => setInsertOpen(false)}
        onInsertLayers={handleInsertLayers}
        onImportVideo={handleImportVideo}
      />

      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsOverlay isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* ── Workspace ── */}
      <div className="flex-1 flex min-h-0">
        <div className="w-[220px] shrink-0 border-r border-border bg-surface flex flex-col">
          <div className="h-[160px] shrink-0 border-b border-border">
            <ScenePanel
              scenes={state.project.scenes}
              activeSceneId={state.activeSceneId}
              onSelect={(sceneId) => dispatch({ type: "SET_ACTIVE_SCENE", sceneId })}
              onRename={(sceneId, name) => dispatch({ type: "RENAME_SCENE", sceneId, name })}
              onDuplicate={(sceneId) => dispatch({ type: "DUPLICATE_SCENE", sceneId })}
              onDelete={(sceneId) => dispatch({ type: "DELETE_SCENE", sceneId })}
              onReorder={(sceneId, toIndex) => dispatch({ type: "REORDER_SCENES", sceneId, toIndex })}
              onAdd={() => dispatch({ type: "ADD_SCENE" })}
            />
          </div>
          <div className="flex-1 min-h-0">
            <LayerPanel
              layers={activeScene.layers}
              selectedLayerIds={state.selectedLayerIds}
              onSelect={(ids) => dispatch({ type: "SELECT_LAYERS", ids })}
              onRename={(layerId, name) => dispatch({ type: "RENAME_LAYER", layerId, name })}
              onToggleLock={(layerId) => dispatch({ type: "TOGGLE_LOCK", layerId })}
              onToggleHidden={(layerId) => dispatch({ type: "TOGGLE_HIDDEN", layerId })}
              onReorder={(layerId, toIndex) => dispatch({ type: "REORDER_LAYER", layerId, toIndex })}
              onDelete={() => dispatch({ type: "DELETE_SELECTED_LAYERS" })}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <MotionCanvas
            scene={activeScene}
            selectedLayerIds={state.selectedLayerIds}
            onSelect={(ids) => dispatch({ type: "SELECT_LAYERS", ids })}
            onMoveLayer={(layerId, x, y) => applyTransformEdit(layerId, { x, y })}
            onResizeLayer={(layerId, patch) => applyTransformEdit(layerId, patch)}
            getTransform={(layer) => getResolvedTransform(state, layer)}
            playheadMs={state.playheadMs}
            isPlaying={playback.isPlaying}
          />
        </div>

        <div className="w-[260px] shrink-0 border-l border-border bg-surface">
          <Inspector
            layer={selectedLayer}
            playheadMs={state.playheadMs}
            onUpdateTransform={(patch) => selectedLayer && applyTransformEdit(selectedLayer.id, patch)}
            onUpdateLayer={(patch) =>
              selectedLayer && dispatch({ type: "UPDATE_LAYER", layerId: selectedLayer.id, patch })
            }
            onSetKeyframe={(property, value) =>
              selectedLayer &&
              dispatch({ type: "SET_KEYFRAME", layerId: selectedLayer.id, property, timeMs: state.playheadMs, value })
            }
            onApplyPreset={handleApplyPreset}
          />
        </div>
      </div>

      {/* ── Audio tracks ── */}
      <div className="h-[112px] shrink-0 border-t border-border">
        <AudioTrackPanel
          tracks={activeScene.audio_tracks}
          activeTrackId={activeAudioTrackId}
          onSelect={setActiveAudioTrackId}
          onRename={(trackId, name) => dispatch({ type: "RENAME_AUDIO_TRACK", trackId, name })}
          onToggleMute={(trackId) => dispatch({ type: "TOGGLE_AUDIO_MUTE", trackId })}
          onToggleSolo={(trackId) => dispatch({ type: "TOGGLE_AUDIO_SOLO", trackId })}
          onVolumeChange={(trackId, volume) => dispatch({ type: "SET_AUDIO_VOLUME", trackId, volume })}
          onDelete={(trackId) => dispatch({ type: "DELETE_AUDIO_TRACK", trackId })}
          onAddTrack={(kind) => dispatch({ type: "ADD_AUDIO_TRACK", kind })}
        />
      </div>

      {/* ── Timeline ── */}
      <div className="h-[162px] shrink-0 border-t border-border bg-surface">
        <Timeline
          scene={activeScene}
          playheadMs={state.playheadMs}
          selectedLayerIds={state.selectedLayerIds}
          isPlaying={playback.isPlaying}
          onScrub={(ms) => dispatch({ type: "SET_PLAYHEAD", timeMs: Math.min(ms, activeScene.duration_ms) })}
          onSelectLayer={(id) => dispatch({ type: "SELECT_LAYERS", ids: [id] })}
          onMoveKeyframe={(layerId, keyframeId, timeMs) =>
            dispatch({ type: "UPDATE_KEYFRAME", layerId, keyframeId, patch: { time_ms: Math.round(timeMs) } })
          }
          onDeleteKeyframe={(layerId, keyframeId) => dispatch({ type: "DELETE_KEYFRAME", layerId, keyframeId })}
          onTogglePlay={playback.toggle}
        />
      </div>

      {/* ── History scrubber ── */}
      <HistoryPanel
        pastCount={state.past.length}
        futureCount={state.future.length}
        onJumpBack={(steps) => {
          for (let i = 0; i < steps; i++) dispatch({ type: "UNDO" });
        }}
        onJumpForward={(steps) => {
          for (let i = 0; i < steps; i++) dispatch({ type: "REDO" });
        }}
        className="shrink-0"
      />
    </div>
  );
}
