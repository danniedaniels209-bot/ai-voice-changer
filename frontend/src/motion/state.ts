/**
 * Motion Studio editor state: a snapshot-based undo/redo reducer over a
 * MotionProject. Snapshot (not diff) history is the simplest thing that's
 * correct — projects here are compact scene graphs (shape/text data, no
 * embedded media bytes), so cloning the whole project per edit is cheap
 * enough, and it sidesteps an entire class of "undo replayed a diff wrong"
 * bugs a patch-based history would risk.
 */

import type {
  AnimatableProperty,
  AudioTrack,
  AudioTrackKind,
  Keyframe,
  MotionLayer,
  MotionProject,
  MotionScene,
  Transform,
} from "../types/motion";
import { resolveTransformAtTime } from "./easing";

const MAX_HISTORY = 50;

export interface EditorState {
  project: MotionProject;
  activeSceneId: string;
  selectedLayerIds: string[];
  past: MotionProject[];
  future: MotionProject[];
  dirty: boolean;
  // Playback position — deliberately NOT part of undo history; scrubbing
  // the timeline isn't an edit anyone would want to "undo".
  playheadMs: number;
}

export type EditorAction =
  | { type: "LOAD_PROJECT"; project: MotionProject }
  | { type: "MARK_SAVED"; project: MotionProject }
  | { type: "SET_ACTIVE_SCENE"; sceneId: string }
  | { type: "SELECT_LAYERS"; ids: string[] }
  | { type: "ADD_LAYER"; layer: MotionLayer }
  | { type: "ADD_LAYERS"; layers: MotionLayer[] }
  | { type: "DELETE_SELECTED_LAYERS" }
  | { type: "UPDATE_TRANSFORM"; layerId: string; patch: Partial<Transform> }
  | { type: "UPDATE_LAYER"; layerId: string; patch: Partial<MotionLayer> }
  | { type: "RENAME_LAYER"; layerId: string; name: string }
  | { type: "TOGGLE_LOCK"; layerId: string }
  | { type: "TOGGLE_HIDDEN"; layerId: string }
  | { type: "REORDER_LAYER"; layerId: string; toIndex: number }
  | { type: "SET_SCENE_BACKGROUND"; color: string }
  | { type: "SET_PLAYHEAD"; timeMs: number }
  | { type: "SET_KEYFRAME"; layerId: string; property: AnimatableProperty; timeMs: number; value: number }
  | { type: "UPDATE_KEYFRAME"; layerId: string; keyframeId: string; patch: Partial<Keyframe> }
  | { type: "DELETE_KEYFRAME"; layerId: string; keyframeId: string }
  | { type: "APPLY_KEYFRAMES"; layerId: string; keyframes: Keyframe[] }
  | { type: "ALIGN_LAYERS"; updates: { layerId: string; transform: Transform }[] }
  | { type: "ADD_SCENE" }
  | { type: "DUPLICATE_SCENE"; sceneId: string }
  | { type: "RENAME_SCENE"; sceneId: string; name: string }
  | { type: "DELETE_SCENE"; sceneId: string }
  | { type: "REORDER_SCENES"; sceneId: string; toIndex: number }
  | { type: "ADD_AUDIO_TRACK"; kind: AudioTrackKind }
  | { type: "RENAME_AUDIO_TRACK"; trackId: string; name: string }
  | { type: "TOGGLE_AUDIO_MUTE"; trackId: string }
  | { type: "TOGGLE_AUDIO_SOLO"; trackId: string }
  | { type: "SET_AUDIO_VOLUME"; trackId: string; volume: number }
  | { type: "DELETE_AUDIO_TRACK"; trackId: string }
  | { type: "UNDO" }
  | { type: "REDO" };

export function newId(): string {
  return crypto.randomUUID().slice(0, 12);
}

function activeScene(project: MotionProject, sceneId: string): MotionScene {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found in project`);
  return scene;
}

function withScene(
  project: MotionProject,
  sceneId: string,
  update: (scene: MotionScene) => MotionScene,
): MotionProject {
  return {
    ...project,
    scenes: project.scenes.map((s) => (s.id === sceneId ? update(s) : s)),
  };
}

function withLayer(
  scene: MotionScene,
  layerId: string,
  update: (layer: MotionLayer) => MotionLayer,
): MotionScene {
  return { ...scene, layers: scene.layers.map((l) => (l.id === layerId ? update(l) : l)) };
}

function withAudioTrack(
  scene: MotionScene,
  trackId: string,
  update: (track: AudioTrack) => AudioTrack,
): MotionScene {
  return {
    ...scene,
    audio_tracks: scene.audio_tracks.map((t) => (t.id === trackId ? update(t) : t)),
  };
}

function newScene(name: string, like?: MotionScene): MotionScene {
  return {
    id: newId(),
    name,
    width: like?.width ?? 1920,
    height: like?.height ?? 1080,
    duration_ms: like?.duration_ms ?? 5000,
    background_color: like?.background_color ?? "#0B0B0F",
    layers: [],
    audio_tracks: [],
  };
}

/** Deep-clones a scene with fresh ids throughout (scene, every layer,
 * every keyframe, every audio track) — reusing ids across scenes would
 * make e.g. "layer 3 in scene A" and "layer 3 in scene B" collide the
 * moment any code ever looks a layer up by id alone. */
function cloneScene(scene: MotionScene, name: string): MotionScene {
  return {
    ...scene,
    id: newId(),
    name,
    layers: scene.layers.map((l) => ({
      ...l,
      id: newId(),
      keyframes: l.keyframes.map((k) => ({ ...k, id: newId() })),
    })),
    audio_tracks: scene.audio_tracks.map((t) => ({
      ...t,
      id: newId(),
      volume_keyframes: t.volume_keyframes.map((k) => ({ ...k, id: newId() })),
    })),
  };
}

function newAudioTrack(kind: AudioTrackKind): AudioTrack {
  const names: Record<AudioTrackKind, string> = {
    voiceover: "Voice-over",
    music: "Music",
    sfx: "Sound Effect",
  };
  return {
    id: newId(),
    name: names[kind],
    kind,
    source_url: "",
    start_time_ms: 0,
    duration_ms: 1000,
    volume: 1,
    volume_keyframes: [],
    fade_in_ms: 0,
    fade_out_ms: 0,
    muted: false,
    solo: false,
  };
}

/** Snapshot the current project onto the undo stack before applying a
 * mutating action, and clear the redo stack — the standard "new edit
 * invalidates redo" rule. */
function snapshot(state: EditorState): Pick<EditorState, "past" | "future"> {
  const past = [...state.past, state.project].slice(-MAX_HISTORY);
  return { past, future: [] };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "LOAD_PROJECT":
      return {
        project: action.project,
        activeSceneId: action.project.scenes[0]?.id ?? "",
        selectedLayerIds: [],
        past: [],
        future: [],
        dirty: false,
        playheadMs: 0,
      };

    case "MARK_SAVED":
      // The server stamps a fresh updated_at on save — adopt it so the
      // next save's diff (if we ever add one) has an accurate base,
      // without touching undo history or selection.
      return { ...state, project: action.project, dirty: false };

    case "SET_ACTIVE_SCENE":
      return { ...state, activeSceneId: action.sceneId, selectedLayerIds: [] };

    case "SELECT_LAYERS":
      return { ...state, selectedLayerIds: action.ids };

    case "ADD_LAYER": {
      const project = withScene(state.project, state.activeSceneId, (scene) => ({
        ...scene,
        layers: [...scene.layers, action.layer],
      }));
      return {
        ...state,
        ...snapshot(state),
        project,
        selectedLayerIds: [action.layer.id],
        dirty: true,
      };
    }

    case "ADD_LAYERS": {
      // For inserting a multi-layer group (a mockup, callout, chart, ...)
      // in one gesture — one undo step for the whole group, not one per
      // layer, and the whole group ends up selected together afterward.
      if (action.layers.length === 0) return state;
      const project = withScene(state.project, state.activeSceneId, (scene) => ({
        ...scene,
        layers: [...scene.layers, ...action.layers],
      }));
      return {
        ...state,
        ...snapshot(state),
        project,
        selectedLayerIds: action.layers.map((l) => l.id),
        dirty: true,
      };
    }

    case "DELETE_SELECTED_LAYERS": {
      if (state.selectedLayerIds.length === 0) return state;
      const toDelete = new Set(state.selectedLayerIds);
      const project = withScene(state.project, state.activeSceneId, (scene) => ({
        ...scene,
        layers: scene.layers.filter((l) => !toDelete.has(l.id)),
      }));
      return { ...state, ...snapshot(state), project, selectedLayerIds: [], dirty: true };
    }

    case "UPDATE_TRANSFORM": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({
          ...layer,
          transform: { ...layer.transform, ...action.patch },
        })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "UPDATE_LAYER": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({ ...layer, ...action.patch })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "RENAME_LAYER": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({ ...layer, name: action.name })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "TOGGLE_LOCK": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({ ...layer, locked: !layer.locked })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "TOGGLE_HIDDEN": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({ ...layer, hidden: !layer.hidden })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "REORDER_LAYER": {
      const project = withScene(state.project, state.activeSceneId, (scene) => {
        const layers = [...scene.layers];
        const fromIndex = layers.findIndex((l) => l.id === action.layerId);
        if (fromIndex === -1) return scene;
        const [moved] = layers.splice(fromIndex, 1);
        layers.splice(Math.max(0, Math.min(action.toIndex, layers.length)), 0, moved);
        return { ...scene, layers };
      });
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "SET_SCENE_BACKGROUND": {
      const project = withScene(state.project, state.activeSceneId, (scene) => ({
        ...scene,
        background_color: action.color,
      }));
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "SET_PLAYHEAD":
      return { ...state, playheadMs: Math.max(0, action.timeMs) };

    case "SET_KEYFRAME": {
      // "Set keyframe" is the standard animation-tool gesture: at whatever
      // time you're scrubbed to, pin the property's CURRENT (possibly
      // already-interpolated) value there. Replaces an existing keyframe
      // at the exact same time+property instead of stacking a duplicate.
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => {
          const withoutExisting = layer.keyframes.filter(
            (k) => !(k.property === action.property && k.time_ms === action.timeMs),
          );
          const keyframe: Keyframe = {
            id: newId(),
            time_ms: action.timeMs,
            property: action.property,
            value: action.value,
            easing: "ease_in_out",
          };
          return { ...layer, keyframes: [...withoutExisting, keyframe] };
        }),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "UPDATE_KEYFRAME": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({
          ...layer,
          keyframes: layer.keyframes.map((k) =>
            k.id === action.keyframeId ? { ...k, ...action.patch } : k,
          ),
        })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "DELETE_KEYFRAME": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({
          ...layer,
          keyframes: layer.keyframes.filter((k) => k.id !== action.keyframeId),
        })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "APPLY_KEYFRAMES": {
      // A preset replaces any existing keyframes on the properties IT
      // animates (so re-applying/switching presets doesn't leave old
      // tracks mixed with new ones), but leaves keyframes on other
      // properties untouched.
      const touchedProperties = new Set(action.keyframes.map((k) => k.property));
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withLayer(scene, action.layerId, (layer) => ({
          ...layer,
          keyframes: [
            ...layer.keyframes.filter((k) => !touchedProperties.has(k.property)),
            ...action.keyframes,
          ],
        })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "ALIGN_LAYERS": {
      // One snapshot for the whole align/distribute operation — clicking
      // "align left" on 5 layers is one undo step, not five.
      if (action.updates.length === 0) return state;
      const byId = new Map(action.updates.map((u) => [u.layerId, u.transform]));
      const project = withScene(state.project, state.activeSceneId, (scene) => ({
        ...scene,
        layers: scene.layers.map((l) => (byId.has(l.id) ? { ...l, transform: byId.get(l.id)! } : l)),
      }));
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "ADD_SCENE": {
      const current = state.project.scenes.find((s) => s.id === state.activeSceneId);
      const scene = newScene(`Scene ${state.project.scenes.length + 1}`, current);
      const insertAt = state.project.scenes.findIndex((s) => s.id === state.activeSceneId) + 1;
      const scenes = [...state.project.scenes];
      scenes.splice(insertAt || scenes.length, 0, scene);
      return {
        ...state,
        ...snapshot(state),
        project: { ...state.project, scenes },
        activeSceneId: scene.id,
        selectedLayerIds: [],
        dirty: true,
      };
    }

    case "DUPLICATE_SCENE": {
      const index = state.project.scenes.findIndex((s) => s.id === action.sceneId);
      if (index === -1) return state;
      const source = state.project.scenes[index];
      const copy = cloneScene(source, `${source.name} copy`);
      const scenes = [...state.project.scenes];
      scenes.splice(index + 1, 0, copy);
      return {
        ...state,
        ...snapshot(state),
        project: { ...state.project, scenes },
        activeSceneId: copy.id,
        selectedLayerIds: [],
        dirty: true,
      };
    }

    case "RENAME_SCENE": {
      const scenes = state.project.scenes.map((s) =>
        s.id === action.sceneId ? { ...s, name: action.name } : s,
      );
      return { ...state, ...snapshot(state), project: { ...state.project, scenes }, dirty: true };
    }

    case "DELETE_SCENE": {
      // A project with zero scenes has nothing to render or export —
      // never let the last one be deleted.
      if (state.project.scenes.length <= 1) return state;
      const index = state.project.scenes.findIndex((s) => s.id === action.sceneId);
      if (index === -1) return state;
      const scenes = state.project.scenes.filter((s) => s.id !== action.sceneId);
      const activeSceneId =
        state.activeSceneId === action.sceneId
          ? (scenes[Math.min(index, scenes.length - 1)]?.id ?? scenes[0].id)
          : state.activeSceneId;
      return {
        ...state,
        ...snapshot(state),
        project: { ...state.project, scenes },
        activeSceneId,
        selectedLayerIds: [],
        dirty: true,
      };
    }

    case "REORDER_SCENES": {
      const scenes = [...state.project.scenes];
      const fromIndex = scenes.findIndex((s) => s.id === action.sceneId);
      if (fromIndex === -1) return state;
      const [moved] = scenes.splice(fromIndex, 1);
      scenes.splice(Math.max(0, Math.min(action.toIndex, scenes.length)), 0, moved);
      return { ...state, ...snapshot(state), project: { ...state.project, scenes }, dirty: true };
    }

    case "ADD_AUDIO_TRACK": {
      const project = withScene(state.project, state.activeSceneId, (scene) => ({
        ...scene,
        audio_tracks: [...scene.audio_tracks, newAudioTrack(action.kind)],
      }));
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "RENAME_AUDIO_TRACK": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withAudioTrack(scene, action.trackId, (track) => ({ ...track, name: action.name })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "TOGGLE_AUDIO_MUTE": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withAudioTrack(scene, action.trackId, (track) => ({ ...track, muted: !track.muted })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "TOGGLE_AUDIO_SOLO": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withAudioTrack(scene, action.trackId, (track) => ({ ...track, solo: !track.solo })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "SET_AUDIO_VOLUME": {
      const project = withScene(state.project, state.activeSceneId, (scene) =>
        withAudioTrack(scene, action.trackId, (track) => ({
          ...track,
          volume: Math.min(1, Math.max(0, action.volume)),
        })),
      );
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "DELETE_AUDIO_TRACK": {
      const project = withScene(state.project, state.activeSceneId, (scene) => ({
        ...scene,
        audio_tracks: scene.audio_tracks.filter((t) => t.id !== action.trackId),
      }));
      return { ...state, ...snapshot(state), project, dirty: true };
    }

    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, MAX_HISTORY),
        dirty: true,
      };
    }

    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        project: next,
        past: [...state.past, state.project].slice(-MAX_HISTORY),
        future: state.future.slice(1),
        dirty: true,
      };
    }

    default:
      return state;
  }
}

export function getActiveScene(state: EditorState): MotionScene {
  return activeScene(state.project, state.activeSceneId);
}

/** A layer's transform at the current playhead — resolved through its
 * keyframes if it has any, else its static transform unchanged. */
export function getResolvedTransform(state: EditorState, layer: MotionLayer): Transform {
  return resolveTransformAtTime(layer, state.playheadMs);
}
