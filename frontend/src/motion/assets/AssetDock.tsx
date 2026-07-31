/**
 * Always-visible media dock: import once, then drag onto the timeline.
 *
 * Before this, importing meant opening the Insert modal, and the uploaded-
 * asset list lived *inside* that modal — so your media was only visible while
 * a dialog was covering the editor, and the only way to use a clip was a
 * button that dropped it wherever the code decided. Neither matches how
 * anyone actually works with footage.
 *
 * This dock stays open beside the canvas: one obvious Import button, every
 * upload listed underneath with a thumbnail, and each item draggable straight
 * onto the timeline at the point you drop it.
 *
 * Drag payload is JSON on a private MIME type (see DRAG_MIME). A private type
 * rather than "text/plain" so dropping a clip into a text field elsewhere in
 * the app can't paste a blob of JSON, and so the timeline can tell our drags
 * apart from a file dragged in from the desktop.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Loader2, Film, ImageIcon, Music, RefreshCw, Trash2 } from "lucide-react";
import {
  deleteMotionAsset,
  listMotionAssets,
  resolveMotionAssetUrl,
  uploadMotionAsset,
  type MotionAsset,
} from "../../api/motion";

/** Private drag type — see the module note on why this isn't text/plain. */
export const DRAG_MIME = "application/x-motion-asset";

export type AssetKind = "video" | "image" | "audio";

export function assetKind(asset: MotionAsset): AssetKind {
  if (asset.content_type.startsWith("video/")) return "video";
  if (asset.content_type.startsWith("audio/")) return "audio";
  return "image";
}

export interface AssetDockProps {
  /** Click-to-insert, for people who'd rather not drag (and for keyboard use
   *  — a drag-only affordance would be unreachable without a mouse). */
  onInsertAsset: (asset: MotionAsset) => void;
  /** Bumped by the parent after a drop so the list refreshes. */
  refreshToken?: number;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetDock({ onInsertAsset, refreshToken = 0 }: AssetDockProps) {
  const [assets, setAssets] = useState<MotionAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropping, setDropping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listMotionAssets()
      .then(setAssets)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refresh, [refresh, refreshToken]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        // Sequential, not Promise.all: these are large media files and the
        // backend writes them to disk. Firing ten 500MB uploads at once is a
        // good way to make the whole app unresponsive.
        for (const f of list) await uploadMotionAsset(f);
        refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setUploading(false);
      }
    },
    [refresh],
  );

  async function remove(asset: MotionAsset) {
    try {
      await deleteMotionAsset(asset.asset_id);
      refresh();
    } catch (e) {
      // The backend refuses to delete an asset a project still references,
      // which is correct — surface its reason rather than failing silently.
      setError(String(e));
    }
  }

  return (
    <div
      className={`flex flex-col min-h-0 h-full border-t border-border ${
        dropping ? "bg-accent-dim/20" : ""
      }`}
      onDragOver={(e) => {
        // Only claim the drag if it carries real files. Without this the dock
        // also swallows layer drags from the timeline.
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2 px-2 py-2 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          Media
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          className="text-text-faint hover:text-text p-1 rounded"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="px-2 pb-2 shrink-0">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            // Reset so picking the SAME file twice still fires onChange.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 bg-accent text-white rounded-md px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {uploading ? "Uploading…" : "Import media"}
        </button>
        <p className="text-[10px] text-text-faint text-center mt-1.5 leading-snug">
          or drop files here · drag an item onto the timeline
        </p>
      </div>

      {error && (
        <p className="text-danger text-[11px] px-2 pb-2 break-words shrink-0">{error}</p>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {assets === null ? (
          <p className="text-text-faint text-[11px] px-1">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="text-text-faint text-[11px] px-1 leading-snug">
            Nothing imported yet. Add a video, image, or audio file and it'll
            appear here for reuse across scenes.
          </p>
        ) : (
          <div className="space-y-1">
            {assets.map((a) => {
              const kind = assetKind(a);
              return (
                <div
                  key={a.asset_id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(a));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDoubleClick={() => onInsertAsset(a)}
                  title={`${a.filename} — drag onto the timeline, or double-click to add`}
                  className="group flex items-center gap-2 p-1 rounded-md hover:bg-surface-hover cursor-grab active:cursor-grabbing"
                >
                  <div className="w-11 h-8 rounded bg-black/40 border border-border overflow-hidden shrink-0 flex items-center justify-center text-text-faint">
                    {kind === "image" ? (
                      <img
                        src={resolveMotionAssetUrl(a.source_url)}
                        alt=""
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    ) : kind === "video" ? (
                      <video
                        src={resolveMotionAssetUrl(a.source_url)}
                        className="w-full h-full object-cover"
                        muted
                        // Nudge the browser into decoding one frame so the
                        // tile shows the clip rather than a black rectangle.
                        preload="metadata"
                      />
                    ) : (
                      <Music size={14} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-text truncate">{a.filename}</div>
                    <div className="text-[10px] text-text-faint flex items-center gap-1">
                      {kind === "video" ? <Film size={9} /> : kind === "image" ? <ImageIcon size={9} /> : <Music size={9} />}
                      {sizeLabel(a.size_bytes)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(a);
                    }}
                    title="Delete asset"
                    className="opacity-0 group-hover:opacity-100 text-text-faint hover:text-danger p-1 transition-opacity shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
