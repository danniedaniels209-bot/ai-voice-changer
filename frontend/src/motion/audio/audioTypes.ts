/**
 * Audio track types now live in types/motion.ts (folded in from this
 * file's original draft — same shape, just promoted to the shared data
 * model since MotionScene.audio_tracks needs them). Re-exported here so
 * AudioTrackPanel.tsx's existing `from "./audioTypes"` import keeps
 * working unchanged.
 */

import type { AudioTrack, AudioTrackKind } from "../../types/motion";

export type { AudioTrack, AudioTrackKind, AudioKeyframe } from "../../types/motion";

export interface AudioTrackPanelProps {
  tracks: AudioTrack[];
  activeTrackId: string | null;
  onSelect: (trackId: string) => void;
  onRename: (trackId: string, name: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onVolumeChange: (trackId: string, volume: number) => void;
  onDelete: (trackId: string) => void;
  onAddTrack: (kind: AudioTrackKind) => void;
}
