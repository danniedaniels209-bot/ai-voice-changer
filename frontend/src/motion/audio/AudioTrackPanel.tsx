import { useState, useRef, useEffect } from "react";
import { Mic, Music, Volume2, VolumeX, Zap, Trash2, GripVertical } from "lucide-react";
import type { AudioTrackPanelProps, AudioTrackKind } from "./audioTypes";

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

/**
 * Simple waveform placeholder - generates a deterministic "waveform" shape
 * based on the track ID so it looks consistent without decoding real audio.
 */
function WaveformPlaceholder({ trackId, width = 120, height = 32, className = "" }: { trackId: string; width?: number; height?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Generate deterministic pseudo-random bars from track ID
    let seed = 0;
    for (let i = 0; i < trackId.length; i++) {
      seed = ((seed << 5) - seed) + trackId.charCodeAt(i);
      seed |= 0;
    }

    const barCount = 24;
    const barWidth = width / barCount;
    const maxHeight = height * 0.8;
    const centerY = height / 2;

    ctx.fillStyle = "rgba(99, 102, 241, 0.6)"; // indigo-400 with opacity

    for (let i = 0; i < barCount; i++) {
      // Simple LCG for deterministic "random" heights
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const normalized = (seed % 1000) / 1000;
      const barHeight = Math.max(2, normalized * maxHeight);

      const x = i * barWidth + barWidth * 0.1;
      const y = centerY - barHeight / 2;
      const w = barWidth * 0.8;

      ctx.fillRect(x, y, w, barHeight);
    }
  }, [trackId, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className={className} />;
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
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center mb-3">
              <Music size={24} className="text-text-faint" />
            </div>
            <p className="text-xs text-text-faint mb-1">No audio tracks yet</p>
            <p className="text-[10px] text-text-faint/70">Click + to add voice-over, music, or sound effects</p>
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

              {/* Waveform placeholder */}
              <WaveformPlaceholder trackId={track.id} width={100} height={28} className="opacity-60" />

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