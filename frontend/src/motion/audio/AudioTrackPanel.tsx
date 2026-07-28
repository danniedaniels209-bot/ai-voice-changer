import { useState, useRef } from "react";
import { Mic, Music, Volume2, VolumeX, Zap, Trash2, GripVertical } from "lucide-react";
import type { AudioTrackPanelProps, AudioTrackKind, AudioTrack, AudioMarker } from "./audioTypes";
import { Waveform } from "./WaveformCanvas";

const KIND_ICONS: Record<AudioTrackKind, typeof Mic> = {
  voiceover: Mic,
  music: Music,
  sfx: Zap,
};

const KIND_LABELS: Record<AudioTrackKind, string> = {
  voiceover: "Voice-over",
  music: "Music",
  sfx: "Sound Effect",
};

const KIND_COLORS: Record<AudioTrackKind, string> = {
  voiceover: "text-blue-400",
  music: "text-emerald-400",
  sfx: "text-amber-400",
};



function MarkerContainer({
  track,
  onAddMarker,
  onUpdateMarker,
  onDeleteMarker,
}: {
  track: AudioTrack;
  onAddMarker: (trackId: string, timeMs: number) => void;
  onUpdateMarker: (trackId: string, markerId: string, patch: Partial<AudioMarker>) => void;
  onDeleteMarker: (trackId: string, markerId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(1, track.duration_ms);

  return (
    <div 
      ref={containerRef}
      className="relative cursor-crosshair w-[100px] h-[28px] shrink-0 bg-surface-hover/50 rounded overflow-hidden group/track" 
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        onAddMarker(track.id, Math.round(percent * duration));
      }}
      title="Click to add marker"
    >
      <Waveform sourceUrl={track.source_url} width={100} height={28} className="opacity-60 pointer-events-none" />
      
      {track.markers?.map((marker) => {
        const leftPercent = (marker.time_ms / duration) * 100;
        
        return (
          <div 
            key={marker.id} 
            className="absolute top-0 bottom-0 w-px bg-yellow-400 z-10 cursor-ew-resize group/marker"
            style={{ left: `${leftPercent}%` }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              
              const handleMove = (moveEvent: PointerEvent) => {
                if (!containerRef.current) return;
                const rect = containerRef.current.getBoundingClientRect();
                const percent = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                onUpdateMarker(track.id, marker.id, { time_ms: Math.round(percent * duration) });
              };
              
              const handleUp = (upEvent: PointerEvent) => {
                (upEvent.currentTarget as HTMLDivElement)?.releasePointerCapture(upEvent.pointerId);
                window.removeEventListener("pointermove", handleMove);
                window.removeEventListener("pointerup", handleUp);
              };
              
              window.addEventListener("pointermove", handleMove);
              window.addEventListener("pointerup", handleUp);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onDeleteMarker(track.id, marker.id);
            }}
            title={`${marker.label} (Right-click to delete)`}
          >
            <div className="absolute -top-0 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-yellow-400 group-hover/marker:scale-150 transition-transform" />
          </div>
        );
      })}
    </div>
  );
}

export function AudioTrackPanel({
  tracks,
  activeTrackId,
  onSelect,
  onRename,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onDelete,
  onAddTrack,
  onAddMarker,
  onUpdateMarker,
  onDeleteMarker,
}: AudioTrackPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Audio Tracks</span>
        <div className="flex items-center gap-1">
          {(["voiceover", "music", "sfx"] as AudioTrackKind[]).map((kind) => {
            const KindIcon = KIND_ICONS[kind];
            return (
              <button
                key={kind}
                type="button"
                title={`Add ${KIND_LABELS[kind]} track`}
                onClick={() => onAddTrack(kind)}
                className={`p-1.5 rounded hover:bg-surface-hover text-text-faint hover:text-text transition-colors ${KIND_COLORS[kind]}`}
              >
                <KindIcon size={14} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Track List */}
      <div className="flex-1 overflow-y-auto">
        {tracks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center mt-6">
            <div className="w-12 h-12 rounded-full bg-surface-hover flex items-center justify-center mb-3 text-text-faint">
              <Music size={24} />
            </div>
            <h4 className="text-sm font-medium text-text mb-1">No audio tracks</h4>
            <p className="text-xs text-text-faint mb-5 leading-relaxed max-w-[200px]">
              Add voice-overs, music, or sound effects to bring your animation to life.
            </p>
            <div className="flex flex-col gap-2 w-[140px]">
              {(["voiceover", "music", "sfx"] as AudioTrackKind[]).map((kind) => {
                const KindIcon = KIND_ICONS[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onAddTrack(kind)}
                    className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md hover:border-accent hover:text-accent transition-colors text-xs font-medium w-full text-left"
                  >
                    <KindIcon size={14} className={KIND_COLORS[kind]} />
                    Add {KIND_LABELS[kind]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tracks.map((track) => {
          const Icon = KIND_ICONS[track.kind];
          const selected = activeTrackId === track.id;
          const isMuted = track.muted;
          const isSolo = track.solo;

          return (
            <div
              key={track.id}
              className={`flex items-center gap-2 px-2 py-2 border-b border-border/50 ${
                selected ? "bg-accent-dim" : "hover:bg-surface-hover"
              }`}
            >
              {/* Drag handle */}
              <GripVertical size={14} className="text-text-faint/50 cursor-grab shrink-0" />

              {/* Kind icon */}
              <Icon size={14} className={`shrink-0 ${KIND_COLORS[track.kind]}`} />

              {/* Track name - inline editable */}
              {editingId === track.id ? (
                <input
                  autoFocus
                  defaultValue={track.name}
                  onBlur={(e) => {
                    onRename(track.id, e.target.value || track.name);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-surface border border-accent rounded px-1.5 text-sm min-w-0 text-text"
                />
              ) : (
                <span
                  className="flex-1 truncate text-sm cursor-pointer"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(track.id);
                  }}
                  onClick={() => onSelect(track.id)}
                  title="Double-click to rename"
                >
                  {track.name}
                </span>
              )}

              {/* Waveform & Markers */}
              <MarkerContainer 
                track={track} 
                onAddMarker={onAddMarker} 
                onUpdateMarker={onUpdateMarker} 
                onDeleteMarker={onDeleteMarker} 
              />

              {/* Volume slider */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  title={isMuted ? "Unmute" : "Mute"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMute(track.id);
                  }}
                  className={`p-1 rounded hover:bg-surface-hover transition-colors ${
                    isMuted ? "text-danger" : "text-text-faint hover:text-text"
                  }`}
                >
                  {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>

                <button
                  type="button"
                  title={isSolo ? "Unsolo" : "Solo"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSolo(track.id);
                  }}
                  className={`p-1 rounded hover:bg-surface-hover transition-colors ${
                    isSolo ? "text-yellow-400" : "text-text-faint hover:text-text"
                  }`}
                >
                  <Zap size={13} />
                </button>

                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={track.volume}
                  onChange={(e) => {
                    e.stopPropagation();
                    onVolumeChange(track.id, parseFloat(e.target.value));
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  className="w-20 h-1.5 appearance-none bg-surface-hover rounded-full accent-accent cursor-pointer"
                />
              </div>

              {/* Delete button */}
              <button
                type="button"
                title="Delete track"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(track.id);
                }}
                className="p-1 rounded hover:bg-danger/10 text-text-faint hover:text-danger transition-colors shrink-0"
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