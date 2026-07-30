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
  Wand2,
  Spline,
  ChevronRight,
  HelpCircle,
  Grid3X3,
  AlignStartVertical,
  Magnet,
} from "lucide-react";
import { getMotionProject, saveMotionProject, uploadMotionAsset, type MotionAsset } from "../api/motion";
import { editorReducer, getResolvedTransform, newId, type EditorState } from "../motion/state";
import { resolveTransformAtTime } from "../motion/easing";
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
import { TransitionModal } from "../motion/transitions/TransitionModal";
import { applyTransitionToScene } from "../motion/transitions/applyTransitionToScene";
import { OnboardingWalkthrough } from "../motion/onboarding/OnboardingWalkthrough";
import { SubtitleImportButton } from "../motion/subtitles/SubtitleImportButton";
import type { AnimatableProperty, LayerType, MotionConnector, MotionLayer, MotionProject, MotionScene, Transform } from "../types/motion";
import { copyToClipboard, getClipboard, preparePaste, preparePasteSpecial } from "../motion/clipboard";
import { clearRecoverySnapshot, getRecoverySnapshot, saveRecoverySnapshot } from "../motion/recovery";

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

/** One frame at 30fps. Arrow-key stepping uses this; Shift+arrow jumps a
 *  full second for coarse seeking. */
const FRAME_STEP_MS = 1000 / 30;

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
  const [transitionOpen, setTransitionOpen] = useState(false);
  // LT-KEYFRAMEUI — which keyframe is currently selected for easing editing
  // in the Inspector. Null when no keyframe is selected.
  const [selectedKeyframe, setSelectedKeyframe] = useState<{ layerId: string; keyframeId: string } | null>(null);
  // Connect mode: click one layer, then a second, to join them. Held here
  // (not in MotionCanvas) because the toolbar button and the canvas both
  // need it, and it isn't project data — nothing to save or undo.
  const [connectMode, setConnectMode] = useState(false);
  const [rippleMode, setRippleMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [videoImporting, setVideoImporting] = useState(false);
  // LT-AUTOSAVE-RECOVERY: modal state for offering to restore a local snapshot.
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryProject, setRecoveryProject] = useState<MotionProject | null>(null);
  // The editor stacks fixed-height panels under the canvas. On a laptop that
  // furniture (toolbar + audio + timeline + history) can exceed half the
  // viewport and crush the canvas to a strip. Both bottom panels collapse to
  // a header bar, and the choice is remembered — audio starts collapsed
  // because most projects begin with no audio at all.
  const [audioOpen, setAudioOpen] = useState(
    () => localStorage.getItem("motion_audio_open") === "1",
  );
  const [timelineOpen, setTimelineOpen] = useState(
    () => localStorage.getItem("motion_timeline_open") !== "0",
  );
  // LT-GRIDRULERS — editor-only overlay toggles, persisted in localStorage.
  const [showGrid, setShowGrid] = useState(
    () => localStorage.getItem("motion_show_grid") === "1",
  );
  const [showRulers, setShowRulers] = useState(
    () => localStorage.getItem("motion_show_rulers") === "1",
  );
  const [snapToGrid, setSnapToGrid] = useState(
    () => localStorage.getItem("motion_snap_grid") === "1",
  );
  const [gridSize, setGridSize] = useState(() => {
    const saved = localStorage.getItem("motion_grid_size");
    return saved ? Math.max(10, Math.min(100, Number(saved))) : 20;
  });

  // LT-PANELS — resizable panel sizes persisted to localStorage.
  // Keys: leftSidebar, rightSidebar, audioHeight, timelineHeight.
  // All clamped against viewport on mount so a size saved on a large
  // monitor doesn't overflow a laptop screen.
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("motion_left_sidebar_width");
    return saved ? Math.max(180, Math.min(400, Number(saved))) : 220;
  });
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("motion_right_sidebar_width");
    return saved ? Math.max(200, Math.min(500, Number(saved))) : 260;
  });
  const [audioHeight, setAudioHeight] = useState(() => {
    const saved = localStorage.getItem("motion_audio_height");
    return saved ? Math.max(80, Math.min(300, Number(saved))) : 112;
  });
  const [timelineHeight, setTimelineHeight] = useState(() => {
    const saved = localStorage.getItem("motion_timeline_height");
    return saved ? Math.max(100, Math.min(400, Number(saved))) : 162;
  });

  // Clamp persisted sizes against current viewport on mount.
  // Runs once after first render so window.innerHeight is available.
  useEffect(() => {
    const vh = window.innerHeight;
    // Reserve: toolbar(48) + history(~60) + minimum canvas(200) + dividers(~12)
    const reserved = 48 + 60 + 200 + 12;
    const maxBottom = Math.max(80, vh - reserved - leftSidebarWidth);
    setAudioHeight((h) => Math.min(h, maxBottom * 0.6));
    setTimelineHeight((h) => Math.min(h, maxBottom * 0.6));
  }, []);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  // The keydown effect below binds once (empty deps) so it doesn't rebind on
  // every playhead tick, which means it can't close over live values. This
  // ref is refreshed each render and read inside the handler instead.
  // Same stale-closure problem as playbackRef: the keydown effect binds once.
  const selectionRef = useRef<string[]>([]);
  const rippleModeRef = useRef(false);
  const isPlayingRef = useRef(false);
  const selectedLayerStartRef = useRef<number | null>(null);
  // Keyboard nudge (LT-KEYBOARDNUDGE) needs the TRUE, unrounded offset
  // accumulated since the layer was selected — FRAME_STEP_MS is 1000/30 =
  // 33.333..., and rounding it independently on every keypress drifts: five
  // presses of Math.round(33.333) sum to 165ms, not the 167ms that rounding
  // the total once gives. Track the exact float total in trueAccum and the
  // integer amount already sent to the reducer in dispatchedSoFar; each
  // press's delta is the difference between the newly-rounded total and
  // what was dispatched last time, so the SUM of every dispatched delta
  // always equals Math.round(trueAccum) — no compounding error, and the
  // reducer only ever sees whole milliseconds (visible_start_ms is `int` on
  // the backend, so a fractional delta would fail to save once accumulated).
  const nudgeAccumRef = useRef<{ signature: string | null; trueAccum: number; dispatchedSoFar: number; baseValues: Record<string, { x: number }> }>({ signature: null, trueAccum: 0, dispatchedSoFar: 0, baseValues: {} });
  const activeSceneRef = useRef<MotionScene | null>(null);
  // LT-AUTOSAVE-RECOVERY: refs for unmount final snapshot (cleanup closure
  // captures stale values, so we read the latest via refs instead).
  const latestDirtyRef = useRef(false);
  const latestProjectRef = useRef<MotionProject | null>(null);
  // LT-PANELS drag state. These live HERE, with the other refs, and not down
  // beside their handlers — there are `Loading…` / error early returns further
  // down, so a hook declared after them doesn't run on the first render and
  // does on the next. That is React error #310 ("rendered more hooks than
  // during the previous render"), and it takes the whole editor down: the
  // canvas never mounts at all. Any new hook in this component goes above
  // those returns.
  const leftSidebarDrag = useRef<{ startX: number; startWidth: number } | null>(null);
  const rightSidebarDrag = useRef<{ startX: number; startWidth: number } | null>(null);
  const audioDrag = useRef<{ startY: number; startHeight: number } | null>(null);
  const timelineDrag = useRef<{ startY: number; startHeight: number } | null>(null);
  const playbackRef = useRef<{
    hasContent: boolean;
    toggle: () => void;
    playheadMs: number;
    durationMs: number;
  }>({
    hasContent: false,
    toggle: () => {},
    playheadMs: 0,
    durationMs: 5000,
  });

  useEffect(() => {
    if (!projectId) return;
    getMotionProject(projectId)
      .then((serverProject) => {
        dispatch({ type: "LOAD_PROJECT", project: serverProject });
        const recovery = getRecoverySnapshot(projectId);
        if (recovery && recovery.timestamp > serverProject.updated_at) {
          setRecoveryProject(recovery.project);
          setRecoveryOpen(true);
        }
      })
      .catch((err) => setLoadError(String(err)));
  }, [projectId]);

  // Autosave: debounced so a drag or a burst of edits doesn't fire a save
  // per keystroke — waits for a short pause in activity instead.
  useEffect(() => {
    if (!state.dirty || !state.project.id) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      saveRecoverySnapshot(state.project);
      setSaveStatus("saving");
      try {
        const saved = await saveMotionProject(state.project);
        dispatch({ type: "MARK_SAVED", project: saved });
        clearRecoverySnapshot(state.project.id);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("idle");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [state.dirty, state.project]);

  // LT-AUTOSAVE-RECOVERY: final snapshot on unmount so crash recovery works
  // even if the user closes the tab right after editing.
  useEffect(() => {
    return () => {
      if (latestDirtyRef.current && latestProjectRef.current) {
        saveRecoverySnapshot(latestProjectRef.current);
      }
    };
  }, []);

  // Keyboard shortcuts, ignored while typing in a text field/input so they
  // don't fight with normal editing.
  //
  // Space / arrow transport keys are listed in ShortcutsOverlay, so they have
  // to actually work — a help screen promising shortcuts the app doesn't
  // implement is worse than no help screen.
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
      } else if (mod && e.key.toLowerCase() === "c") {
        const scene = activeSceneRef.current;
        if (!scene || selectionRef.current.length === 0) return;
        e.preventDefault();
        const ids = new Set(selectionRef.current);
        const layers = scene.layers.filter((l: MotionLayer) => ids.has(l.id));
        const connectors = (scene.connectors ?? []).filter(
          (c: MotionConnector) => ids.has(c.source.layer_id) && ids.has(c.target.layer_id),
        );
        copyToClipboard(layers, connectors);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        // Paste special: static layers (no keyframes). Resolves each
        // layer's transform at the current playhead, stripping animation.
        const clip = getClipboard();
        const scene = activeSceneRef.current;
        if (!clip || !scene) return;
        e.preventDefault();
        const { layers, connectors } = preparePasteSpecial(clip, scene, playbackRef.current.playheadMs);
        if (layers.length === 0) return;
        dispatch({ type: "PASTE_LAYERS", layers, connectors });
      } else if (mod && e.key.toLowerCase() === "v") {
        const clip = getClipboard();
        const scene = activeSceneRef.current;
        if (!clip || !scene) return;
        e.preventDefault();
        const { layers, connectors } = preparePaste(clip, scene, playbackRef.current.playheadMs);
        if (layers.length === 0) return;
        dispatch({ type: "PASTE_LAYERS", layers, connectors });
      } else if (mod && e.key.toLowerCase() === "d") {
        // Ctrl/Cmd+D duplicates the selection. Browsers bind this to
        // "bookmark this page", so preventDefault is mandatory.
        const id = selectionRef.current[0];
        if (id) dispatch({ type: "DUPLICATE_LAYER", layerId: id });
      } else if (e.key.toLowerCase() === "s" && !mod && !e.shiftKey) {
        e.preventDefault();
        const id = selectionRef.current[0];
        if (id) dispatch({ type: "SPLIT_LAYER", layerId: id, timeMs: playbackRef.current.playheadMs });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        // Reading a ref set by the last render to avoid stale-closure issues.
        const ripple = rippleModeRef.current;
        dispatch({ type: ripple ? "RIPPLE_DELETE" : "DELETE_SELECTED_LAYERS" });
      } else if (!playbackRef.current.hasContent && (
        e.key === " " || e.code === "Space" ||
        e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "Home" || e.key === "End"
      )) {
        // Empty scene: swallow transport keys rather than moving a playhead
        // over nothing. preventDefault still applies so Space doesn't scroll.
        e.preventDefault();
      } else if (e.key === " " || e.code === "Space") {
        // Space is the near-universal transport toggle in video tools. It
        // also scrolls the page by default, hence preventDefault.
        e.preventDefault();
        playbackRef.current.toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // With layer(s) selected (and not playing), nudge every selected
        // layer's x position by FRAME_STEP_MS pixels (Shift = 10 frames)
        // via MOVE_LAYERS_BATCH.  Otherwise step the playhead as before.
        const selectedIds = selectionRef.current;
        if (selectedIds.length > 0 && !isPlayingRef.current) {
          e.preventDefault();
          const step = e.shiftKey ? 10 * FRAME_STEP_MS : FRAME_STEP_MS;
          const rawStep = e.key === "ArrowLeft" ? -step : step;

          const signature = selectedIds.slice().sort().join(",");
          const accum = nudgeAccumRef.current;
          if (accum.signature !== signature) {
            accum.signature = signature;
            accum.trueAccum = 0;
            accum.dispatchedSoFar = 0;
            accum.baseValues = {};
            const scene = activeSceneRef.current;
            if (scene) {
              for (const id of selectedIds) {
                const layer = scene.layers.find((l) => l.id === id);
                // RESOLVED x at the playhead, not layer.transform.x. For a
                // layer whose x is keyframed, the base transform is not what
                // is on screen — keyframe evaluation ignores it entirely — so
                // basing the nudge on it teleports the layer to base+delta.
                // Measured before this fix: a layer sitting at x=500 via
                // keyframes jumped to 33 on one ArrowRight press. Same root
                // cause as the multi-drag and multi-resize bugs; this is the
                // third time, hence the comment rather than a silent one-liner.
                if (layer) {
                  accum.baseValues[id] = {
                    x: resolveTransformAtTime(layer, playbackRef.current.playheadMs).x,
                  };
                }
              }
            }
          }
          if (Object.keys(accum.baseValues).length === 0) return;

          accum.trueAccum += rawStep;
          const roundedTotal = Math.round(accum.trueAccum);
          const delta = roundedTotal - accum.dispatchedSoFar;
          if (delta === 0) return;
          accum.dispatchedSoFar = roundedTotal;

          const updates = selectedIds.map((id) => ({
            layerId: id,
            transform: { x: (accum.baseValues[id]?.x ?? 0) + roundedTotal },
          }));
          dispatch({ type: "MOVE_LAYERS_BATCH", updates, timeMs: playbackRef.current.playheadMs });
        } else {
          // Frame stepping. Shift jumps a second at a time for coarse seeking.
          e.preventDefault();
          const step = e.shiftKey ? 1000 : FRAME_STEP_MS;
          const delta = e.key === "ArrowLeft" ? -step : step;
          const { playheadMs, durationMs } = playbackRef.current;
          const next = Math.min(durationMs, Math.max(0, playheadMs + delta));
          dispatch({ type: "SET_PLAYHEAD", timeMs: Math.round(next) });
        }
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        dispatch({
          type: "SET_PLAYHEAD",
          timeMs: e.key === "Home" ? 0 : playbackRef.current.durationMs,
        });
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
  selectionRef.current = state.selectedLayerIds;
  isPlayingRef.current = playback.isPlaying;
  rippleModeRef.current = rippleMode;
  const selectedId = state.selectedLayerIds[0];
  selectedLayerStartRef.current = selectedId && scene
    ? (scene.layers.find((l) => l.id === selectedId)?.visible_start_ms ?? null)
    : null;
  activeSceneRef.current = scene ?? null;
  latestDirtyRef.current = state.dirty;
  latestProjectRef.current = state.project;
  // Transport keys are disabled on an empty scene for the same reason the
  // timeline's buttons are — nothing to play, so Space shouldn't sweep a
  // playhead over a blank canvas.
  const sceneHasContent =
    !!scene && (scene.layers.length > 0 || scene.audio_tracks.length > 0);
  playbackRef.current = {
    hasContent: sceneHasContent,
    toggle: playback.toggle,
    playheadMs: state.playheadMs,
    durationMs: scene?.duration_ms ?? 5000,
  };

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

  function handleApplyTransition(transitionId: string) {
    // One transition = one undo step, hence the batched action rather than a
    // dispatch per layer (applyTransitionToScene returns a payload per
    // eligible layer, skipping hidden/locked ones).
    const updates = applyTransitionToScene(activeScene, transitionId, 600);
    if (updates.length === 0) return;
    dispatch({ type: "APPLY_KEYFRAMES_BATCH", updates });
  }

  function handleSceneTransition(sceneId: string, transitionId: string, durationMs: number) {
    const scene = state.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const updates = applyTransitionToScene(scene, transitionId, durationMs);
    if (updates.length === 0) return;
    dispatch({ type: "SET_SCENE_TRANSITION", sceneId, transitionId, durationMs, updates });
  }

  function handleClearSceneTransition(sceneId: string) {
    const scene = state.project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    dispatch({ type: "SET_SCENE_TRANSITION", sceneId, transitionId: null, updates: [] });
  }

  /** Click-two-layers gesture. First click arms the source, second click
   *  creates the connector. Clicking the same layer twice cancels rather
   *  than making a self-connector, which would render as a dot. */
  function handleConnectPick(layerId: string) {
    if (connectFrom === null) {
      setConnectFrom(layerId);
      return;
    }
    if (connectFrom === layerId) {
      setConnectFrom(null);
      return;
    }
    dispatch({
      type: "ADD_CONNECTOR",
      connector: {
        id: newId(),
        name: "Connector",
        // v1 anchors both ends at "center" — the model carries the full
        // side enum but there's no side-picker UI yet (see OPENCODE's
        // LT-CONNECTORS proposal).
        source: { layer_id: connectFrom, anchor: "center" },
        target: { layer_id: layerId, anchor: "center" },
        style: "curved",
        stroke_color: "#8B8B99",
        stroke_width: 2,
        dash_pattern: null,
        animated: false,
      },
    });
    // Stay in connect mode with the target armed, so chaining A->B->C is
    // three clicks rather than six.
    setConnectFrom(layerId);
  }

  /** Reuse an already-uploaded asset. No upload happens — the new layer
   *  points at the same stored file, which is the entire point of having an
   *  asset library rather than re-importing the same clip per scene. */
  function handleInsertAsset(asset: MotionAsset) {
    const type: LayerType = asset.content_type.startsWith("video/") ? "video" : "image";
    dispatch({ type: "ADD_LAYER", layer: createLayer(type, { src: asset.source_url }) });
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

  function handleRestoreLocal() {
    if (recoveryProject) {
      dispatch({ type: "LOAD_PROJECT", project: recoveryProject });
      clearRecoverySnapshot(recoveryProject.id);
      setRecoveryOpen(false);
      setRecoveryProject(null);
    }
  }

  function handleKeepServer() {
    if (recoveryProject) {
      clearRecoverySnapshot(recoveryProject.id);
      setRecoveryOpen(false);
      setRecoveryProject(null);
    }
  }

  async function handleImportVideo(file: File) {
    setVideoImporting(true);
    try {
      const uploaded = await uploadMotionAsset(file);
      dispatch({ type: "ADD_LAYER", layer: createLayer("video", { src: uploaded.source_url }) });
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setVideoImporting(false);
    }
  }

  const commands: CommandItem[] = [
    { id: "add-rect", label: "Add Rectangle", icon: "▭", onRun: () => addLayer("rect") },
    { id: "add-ellipse", label: "Add Ellipse", icon: "◯", onRun: () => addLayer("ellipse") },
    { id: "add-text", label: "Add Text", icon: "T", onRun: () => addLayer("text") },
    { id: "add-image", label: "Add Image", icon: "🖼", onRun: () => addLayer("image") },
    { id: "import-video", label: "Import Video…", icon: "🎬", onRun: () => videoInputRef.current?.click() },
    { id: "open-insert", label: "Open Insert Library…", icon: "✦", onRun: () => setInsertOpen(true) },
    { id: "animate-scene", label: "Animate scene in…", icon: "🪄", onRun: () => setTransitionOpen(true) },
    {
      id: "connect-layers",
      label: "Connect layers",
      icon: "⤳",
      onRun: () => {
        setConnectMode(true);
        setConnectFrom(null);
      },
    },
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

  function handleMoveLayers(moves: Array<{ layerId: string; x: number; y: number }>) {
    if (moves.length === 0) return;
    if (moves.length === 1) {
      applyTransformEdit(moves[0].layerId, { x: moves[0].x, y: moves[0].y });
      return;
    }
    const updates = moves.map((m) => ({
      layerId: m.layerId,
      transform: { x: m.x, y: m.y },
    }));
    dispatch({ type: "MOVE_LAYERS_BATCH", updates, timeMs: state.playheadMs });
  }

  function handleResizeLayers(moves: Array<{ layerId: string; patch: Partial<Transform> }>) {
    if (moves.length === 0) return;
    if (moves.length === 1) {
      applyTransformEdit(moves[0].layerId, moves[0].patch);
      return;
    }
    const updates = moves.map((m) => ({
      layerId: m.layerId,
      transform: m.patch,
    }));
    dispatch({ type: "MOVE_LAYERS_BATCH", updates, timeMs: state.playheadMs });
  }

  function handleRotateLayers(moves: Array<{ layerId: string; patch: Partial<Transform> }>) {
    if (moves.length === 0) return;
    if (moves.length === 1) {
      applyTransformEdit(moves[0].layerId, moves[0].patch);
      return;
    }
    const updates = moves.map((m) => ({
      layerId: m.layerId,
      transform: m.patch,
    }));
    dispatch({ type: "MOVE_LAYERS_BATCH", updates, timeMs: state.playheadMs });
  }

  // LT-PANELS — drag handlers for resizable panels.
  // Each handler clamps to sensible min/max and persists to localStorage.
  // The drag refs themselves are declared up with the other refs, ABOVE the
  // loading/error early returns — see the note there.

  function handleLeftSidebarMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    leftSidebarDrag.current = { startX: e.clientX, startWidth: leftSidebarWidth };
    window.addEventListener("mousemove", handleLeftSidebarMouseMove);
    window.addEventListener("mouseup", handleLeftSidebarMouseUp);
  }

  function handleLeftSidebarMouseMove(e: MouseEvent) {
    const drag = leftSidebarDrag.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const newWidth = Math.max(180, Math.min(400, drag.startWidth + delta));
    setLeftSidebarWidth(newWidth);
  }

  function handleLeftSidebarMouseUp() {
    leftSidebarDrag.current = null;
    window.removeEventListener("mousemove", handleLeftSidebarMouseMove);
    window.removeEventListener("mouseup", handleLeftSidebarMouseUp);
    localStorage.setItem("motion_left_sidebar_width", String(leftSidebarWidth));
  }

  function handleRightSidebarMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    rightSidebarDrag.current = { startX: e.clientX, startWidth: rightSidebarWidth };
    window.addEventListener("mousemove", handleRightSidebarMouseMove);
    window.addEventListener("mouseup", handleRightSidebarMouseUp);
  }

  function handleRightSidebarMouseMove(e: MouseEvent) {
    const drag = rightSidebarDrag.current;
    if (!drag) return;
    const delta = drag.startX - e.clientX; // inverted: drag left = wider
    const newWidth = Math.max(200, Math.min(500, drag.startWidth + delta));
    setRightSidebarWidth(newWidth);
  }

  function handleRightSidebarMouseUp() {
    rightSidebarDrag.current = null;
    window.removeEventListener("mousemove", handleRightSidebarMouseMove);
    window.removeEventListener("mouseup", handleRightSidebarMouseUp);
    localStorage.setItem("motion_right_sidebar_width", String(rightSidebarWidth));
  }

  function handleAudioMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    audioDrag.current = { startY: e.clientY, startHeight: audioHeight };
    window.addEventListener("mousemove", handleAudioMouseMove);
    window.addEventListener("mouseup", handleAudioMouseUp);
  }

  function handleAudioMouseMove(e: MouseEvent) {
    const drag = audioDrag.current;
    if (!drag) return;
    const delta = e.clientY - drag.startY;
    const newHeight = Math.max(80, Math.min(300, drag.startHeight + delta));
    setAudioHeight(newHeight);
  }

  function handleAudioMouseUp() {
    audioDrag.current = null;
    window.removeEventListener("mousemove", handleAudioMouseMove);
    window.removeEventListener("mouseup", handleAudioMouseUp);
    localStorage.setItem("motion_audio_height", String(audioHeight));
  }

  function handleTimelineMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    timelineDrag.current = { startY: e.clientY, startHeight: timelineHeight };
    window.addEventListener("mousemove", handleTimelineMouseMove);
    window.addEventListener("mouseup", handleTimelineMouseUp);
  }

  function handleTimelineMouseMove(e: MouseEvent) {
    const drag = timelineDrag.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY; // inverted: drag up = taller
    const newHeight = Math.max(100, Math.min(400, drag.startHeight + delta));
    setTimelineHeight(newHeight);
  }

  function handleTimelineMouseUp() {
    timelineDrag.current = null;
    window.removeEventListener("mousemove", handleTimelineMouseMove);
    window.removeEventListener("mouseup", handleTimelineMouseUp);
    localStorage.setItem("motion_timeline_height", String(timelineHeight));
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
          disabled={videoImporting}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
        >
          {videoImporting ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
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
          title={
            connectMode
              ? "Connect mode ON — click two layers to join them. Click here to exit."
              : "Connect layers — draw a line between two layers that follows them when they move"
          }
          onClick={() => {
            setConnectMode((on) => !on);
            setConnectFrom(null);
          }}
          className={`p-1.5 rounded ${
            connectMode
              ? "bg-accent text-white"
              : "hover:bg-surface-hover text-text-muted hover:text-text"
          }`}
        >
          <Spline size={16} />
        </button>
        <button
          type="button"
          title="Animate scene in — apply a transition to every layer at once"
          onClick={() => setTransitionOpen(true)}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <Wand2 size={16} />
        </button>
        <button
          type="button"
          title="Insert from library (video, components, charts, callouts, cursors, device frames, text reveal)"
          onClick={() => setInsertOpen(true)}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text"
        >
          <Shapes size={16} />
        </button>
        <SubtitleImportButton
          projectId={projectId}
          audioTracks={activeScene.audio_tracks}
          sceneWidth={activeScene.width}
          sceneHeight={activeScene.height}
          sceneDurationMs={activeScene.duration_ms}
          onInsertLayers={handleInsertLayers}
        />

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

        <div className="w-px h-5 bg-border mx-1.5" />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title={showGrid ? "Hide grid" : "Show grid"}
            onClick={() => { setShowGrid((v) => { const n = !v; localStorage.setItem("motion_show_grid", n ? "1" : "0"); return n; }); }}
            className={`p-1.5 rounded ${showGrid ? "bg-accent text-white" : "hover:bg-surface-hover text-text-muted hover:text-text"}`}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            type="button"
            title={snapToGrid ? "Snap to grid ON" : "Snap to grid OFF"}
            onClick={() => { setSnapToGrid((v) => { const n = !v; localStorage.setItem("motion_snap_grid", n ? "1" : "0"); return n; }); }}
            className={`p-1.5 rounded ${snapToGrid ? "bg-accent text-white" : "hover:bg-surface-hover text-text-muted hover:text-text"}`}
          >
            <Magnet size={16} />
          </button>
          {showGrid && (
            <select
              title="Grid spacing (px)"
              value={gridSize}
              onChange={(e) => { const v = Number(e.target.value); setGridSize(v); localStorage.setItem("motion_grid_size", String(v)); }}
              className="ml-0.5 h-6 w-12 rounded border border-border bg-surface text-[11px] text-text-muted outline-none cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={40}>40</option>
              <option value={80}>80</option>
              <option value={100}>100</option>
            </select>
          )}
        </div>

        <button
          type="button"
          title={showRulers ? "Hide rulers" : "Show rulers"}
          onClick={() => { setShowRulers((v) => { const n = !v; localStorage.setItem("motion_show_rulers", n ? "1" : "0"); return n; }); }}
          className={`p-1.5 rounded ${showRulers ? "bg-accent text-white" : "hover:bg-surface-hover text-text-muted hover:text-text"}`}
        >
          <AlignStartVertical size={16} />
        </button>

        <div className="w-px h-5 bg-border mx-1.5" />

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
        project={state.project}
        activeSceneId={activeScene.id}
      />

      <TransitionModal
        isOpen={transitionOpen}
        onClose={() => setTransitionOpen(false)}
        onSelect={handleApplyTransition}
      />

      <InsertLibraryModal
        isOpen={insertOpen}
        onClose={() => setInsertOpen(false)}
        onInsertLayers={handleInsertLayers}
        onImportVideo={handleImportVideo}
        onInsertAsset={handleInsertAsset}
      />

      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsOverlay isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* LT-AUTOSAVE-RECOVERY: conflict resolution modal */}
      {recoveryOpen && recoveryProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface border border-border rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-text mb-2">Recover Unsaved Changes?</h2>
            <p className="text-sm text-text-muted mb-4">
              A local snapshot from{" "}
              {new Date(getRecoverySnapshot(recoveryProject.id)?.timestamp ?? "").toLocaleString()}
              {" "}was found that is newer than the saved version on the server. What would you like to do?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleKeepServer}
                className="px-4 py-2 rounded-md border border-border text-text hover:bg-surface-hover transition-colors"
              >
                Keep Server Version
              </button>
              <button
                onClick={handleRestoreLocal}
                className="px-4 py-2 rounded-md bg-accent text-white hover:opacity-90 transition-colors"
              >
                Restore Local Snapshot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Workspace ── */}
      <div className="flex-1 flex min-h-0">
        <div className={`w-[${leftSidebarWidth}px] shrink-0 border-r border-border bg-surface flex flex-col`}>
          <div className="h-[160px] shrink-0 border-b border-border overflow-hidden">
            <ScenePanel
              scenes={state.project.scenes}
              activeSceneId={state.activeSceneId}
              onSelect={(sceneId) => dispatch({ type: "SET_ACTIVE_SCENE", sceneId })}
              onRename={(sceneId, name) => dispatch({ type: "RENAME_SCENE", sceneId, name })}
              onDuplicate={(sceneId) => dispatch({ type: "DUPLICATE_SCENE", sceneId })}
              onDelete={(sceneId) => dispatch({ type: "DELETE_SCENE", sceneId })}
              onReorder={(sceneId, toIndex) => dispatch({ type: "REORDER_SCENES", sceneId, toIndex })}
              onAdd={() => dispatch({ type: "ADD_SCENE" })}
              onApplyTransition={handleSceneTransition}
              onClearTransition={handleClearSceneTransition}
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
              onDuplicate={(layerId) => dispatch({ type: "DUPLICATE_LAYER", layerId })}
              onDelete={() => dispatch({ type: "DELETE_SELECTED_LAYERS" })}
              onOpenInsert={() => setInsertOpen(true)}
            />
          </div>
        </div>

        {/* Left sidebar resize handle */}
        <div
          onMouseDown={handleLeftSidebarMouseDown}
          className="w-1 cursor-col-resize bg-transparent hover:bg-accent/20 active:bg-accent/40 transition-colors flex items-center justify-center"
          style={{ minWidth: 4 }}
          title="Drag to resize sidebar"
        >
          <div className="w-px h-8 bg-border/50" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <MotionCanvas
            scene={activeScene}
            selectedLayerIds={state.selectedLayerIds}
            onSelect={(ids) => dispatch({ type: "SELECT_LAYERS", ids })}
            onMoveLayer={(layerId, x, y) => applyTransformEdit(layerId, { x, y })}
            onMoveLayers={handleMoveLayers}
            onResizeLayer={(layerId, patch) => applyTransformEdit(layerId, patch)}
            onResizeLayers={handleResizeLayers}
            onRotateLayers={handleRotateLayers}
            getTransform={(layer) => getResolvedTransform(state, layer)}
            playheadMs={state.playheadMs}
            isPlaying={playback.isPlaying}
            connectMode={connectMode}
            connectFromLayerId={connectFrom}
            onConnectPick={handleConnectPick}
            onOpenInsert={() => setInsertOpen(true)}
            showGrid={showGrid}
            gridSize={gridSize}
            showRulers={showRulers}
            snapToGrid={snapToGrid}
          />
        </div>

        {/* Right sidebar resize handle */}
        <div
          onMouseDown={handleRightSidebarMouseDown}
          className="w-1 cursor-col-resize bg-transparent hover:bg-accent/20 active:bg-accent/40 transition-colors flex items-center justify-center"
          style={{ minWidth: 4 }}
          title="Drag to resize inspector"
        >
          <div className="w-px h-8 bg-border/50" />
        </div>

        <div className={`w-[${rightSidebarWidth}px] shrink-0 border-l border-border bg-surface`}>
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
            selectedKeyframe={selectedKeyframe}
            onUpdateKeyframeEasing={(easing, easing_bezier) => {
              if (!selectedKeyframe) return;
              dispatch({
                type: "UPDATE_KEYFRAME",
                layerId: selectedKeyframe.layerId,
                keyframeId: selectedKeyframe.keyframeId,
                patch: { easing, easing_bezier },
              });
            }}
            onUpdateKeyframeBezier={(easing_bezier) => {
              if (!selectedKeyframe) return;
              dispatch({
                type: "UPDATE_KEYFRAME",
                layerId: selectedKeyframe.layerId,
                keyframeId: selectedKeyframe.keyframeId,
                patch: { easing_bezier },
              });
            }}
            sceneLayers={activeScene.layers}
            onBatchUpdateLayers={(updates) => dispatch({ type: "UPDATE_LAYERS_BATCH", updates })}
            onAlignLayers={(updates) => dispatch({ type: "ALIGN_LAYERS", updates })}
          />
        </div>
      </div>

      {/* ── Audio tracks ── */}
      <div className={`shrink-0 border-t border-border ${audioOpen ? `h-[${audioHeight}px]` : ""}`}>
        {!audioOpen ? (
          <button
            type="button"
            onClick={() => { setAudioOpen(true); localStorage.setItem("motion_audio_open", "1"); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-faint hover:text-text hover:bg-surface-hover"
          >
            <ChevronRight size={13} />
            <span className="uppercase tracking-wide font-semibold">Audio tracks</span>
            {activeScene.audio_tracks.length > 0 && (
              <span className="text-text-muted">({activeScene.audio_tracks.length})</span>
            )}
          </button>
        ) : (
        <AudioTrackPanel
          tracks={activeScene.audio_tracks}
          activeTrackId={activeAudioTrackId}
          onSelect={setActiveAudioTrackId}
          onRename={(trackId, name) => dispatch({ type: "RENAME_AUDIO_TRACK", trackId, name })}
          onToggleMute={(trackId) => dispatch({ type: "TOGGLE_AUDIO_MUTE", trackId })}
          onToggleSolo={(trackId) => dispatch({ type: "TOGGLE_AUDIO_SOLO", trackId })}
          onToggleDucking={(trackId) => dispatch({ type: "TOGGLE_AUDIO_DUCKING", trackId })}
          onVolumeChange={(trackId, volume) => dispatch({ type: "SET_AUDIO_VOLUME", trackId, volume })}
          onDelete={(trackId) => dispatch({ type: "DELETE_AUDIO_TRACK", trackId })}
          onAddTrack={(kind) => dispatch({ type: "ADD_AUDIO_TRACK", kind })}
          onAddMarker={(trackId, timeMs) => dispatch({ type: "ADD_AUDIO_MARKER", trackId, timeMs })}
          onUpdateMarker={(trackId, markerId, patch) => dispatch({ type: "UPDATE_AUDIO_MARKER", trackId, markerId, patch })}
          onDeleteMarker={(trackId, markerId) => dispatch({ type: "DELETE_AUDIO_MARKER", trackId, markerId })}
          onCollapse={() => { setAudioOpen(false); localStorage.setItem("motion_audio_open", "0"); }}
        />
        )}
      </div>

      {/* Audio / Timeline resize handle (only when both open) */}
      {audioOpen && timelineOpen && (
        <div
          onMouseDown={handleAudioMouseDown}
          className="h-1 cursor-row-resize bg-transparent hover:bg-accent/20 active:bg-accent/40 transition-colors flex items-center justify-center"
          title="Drag to resize audio/timeline"
        >
          <div className="w-full h-px bg-border/50" />
        </div>
      )}

      {/* ── Timeline ── */}
      <div className={`shrink-0 border-t border-border bg-surface ${timelineOpen ? `h-[${timelineHeight}px]` : ""}`}>
        {!timelineOpen ? (
          <button
            type="button"
            onClick={() => { setTimelineOpen(true); localStorage.setItem("motion_timeline_open", "1"); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-faint hover:text-text hover:bg-surface-hover"
          >
            <ChevronRight size={13} />
            <span className="uppercase tracking-wide font-semibold">Timeline</span>
          </button>
        ) : (
        <Timeline
          scene={activeScene}
          activeAudioTrack={activeScene.audio_tracks.find((t) => t.id === activeAudioTrackId)}
          playheadMs={state.playheadMs}
          selectedLayerIds={state.selectedLayerIds}
          isPlaying={playback.isPlaying}
          onScrub={(ms) => dispatch({ type: "SET_PLAYHEAD", timeMs: Math.min(ms, activeScene.duration_ms) })}
          onSelectLayer={(id) => dispatch({ type: "SELECT_LAYERS", ids: [id] })}
          onMoveKeyframe={(layerId, keyframeId, timeMs) =>
            dispatch({ type: "UPDATE_KEYFRAME", layerId, keyframeId, patch: { time_ms: Math.round(timeMs) } })
          }
          onUpdateKeyframe={(layerId, keyframeId, patch) =>
            dispatch({ type: "UPDATE_KEYFRAME", layerId, keyframeId, patch })
          }
          onDeleteKeyframe={(layerId, keyframeId) => dispatch({ type: "DELETE_KEYFRAME", layerId, keyframeId })}
          onTogglePlay={playback.toggle}
          onRetimeLayer={(layerId, deltaMs) => dispatch({ type: "RETIME_LAYER", layerId, deltaMs })}
          onTrimLayer={(layerId, startMs, endMs) => {
            // When ripple is on and the end handle is dragged, use
            // RIPPLE_TRIM to shift everything after. The start handle
            // always uses TRIM_LAYER regardless of ripple mode.
            if (rippleMode && endMs !== null) {
              dispatch({ type: "RIPPLE_TRIM", layerId, endMs });
            } else {
              dispatch({ type: "TRIM_LAYER", layerId, startMs, endMs });
            }
          }}
          rippleMode={rippleMode}
          onToggleRipple={() => setRippleMode((r) => !r)}
          onAddSceneMarker={(timeMs) => dispatch({ type: "ADD_SCENE_MARKER", timeMs: Math.round(timeMs) })}
          onUpdateSceneMarker={(markerId, patch) => dispatch({ type: "UPDATE_SCENE_MARKER", markerId, patch })}
          onDeleteSceneMarker={(markerId) => dispatch({ type: "DELETE_SCENE_MARKER", markerId })}
          onSelectKeyframe={(layerId, keyframeId) => {
            // Selecting a keyframe also selects its layer. The Inspector only
            // renders when a layer is selected, so without this, clicking a
            // keyframe on an unselected layer does nothing visible — the
            // easing panel silently fails to appear and the user has no way
            // to know they were supposed to select the layer first.
            setSelectedKeyframe({ layerId, keyframeId });
            dispatch({ type: "SELECT_LAYERS", ids: [layerId] });
          }}
          onCollapse={() => { setTimelineOpen(false); localStorage.setItem("motion_timeline_open", "0"); }}
        />
        )}
      </div>

      {/* Timeline / History resize handle (only when timeline open) */}
      {timelineOpen && (
        <div
          onMouseDown={handleTimelineMouseDown}
          className="h-1 cursor-row-resize bg-transparent hover:bg-accent/20 active:bg-accent/40 transition-colors flex items-center justify-center"
          title="Drag to resize timeline"
        >
          <div className="w-full h-px bg-border/50" />
        </div>
      )}

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

      <OnboardingWalkthrough />
    </div>
  );
}
