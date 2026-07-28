/**
 * Uploaded asset browser: see what you've imported, reuse it, delete what
 * you don't need.
 *
 * Without this, uploads are write-only. Importing the same clip into three
 * scenes uploads it three times, nothing is ever removed, and the assets
 * directory grows forever with no way to inspect it.
 *
 * Reuse inserts a layer pointing at the EXISTING source_url rather than
 * re-uploading — that's the whole point, and it also means the two layers
 * genuinely share one file on disk.
 */

import { useEffect, useState } from "react";
import { Trash2, Film, Image as ImageIcon, RefreshCw } from "lucide-react";
import {
  deleteMotionAsset,
  listMotionAssets,
  resolveMotionAssetUrl,
  type MotionAsset,
} from "../../api/motion";

export interface AssetLibraryPanelProps {
  /** Insert a layer that reuses this already-uploaded asset. */
  onInsertAsset: (asset: MotionAsset) => void;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isVideo(asset: MotionAsset): boolean {
  return asset.content_type.startsWith("video/");
}

export function AssetLibraryPanel({ onInsertAsset, className = "" }: AssetLibraryPanelProps) {
  const [assets, setAssets] = useState<MotionAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    setError(null);
    listMotionAssets()
      .then(setAssets)
      .catch((err) => setError(String(err)));
  }

  useEffect(refresh, []);

  async function handleDelete(asset: MotionAsset) {
    setBusyId(asset.asset_id);
    setError(null);
    try {
      await deleteMotionAsset(asset.asset_id);
      refresh();
    } catch (err) {
      // The backend returns 409 with the referencing project/scene/layer when
      // an asset is still in use. Show that verbatim — "couldn't delete" with
      // no reason is the least useful message we could give.
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`border border-border rounded-lg bg-surface p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">
          Uploaded assets
        </h3>
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          className="text-text-faint hover:text-text"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <p className="text-danger text-xs mb-2 break-words">{error}</p>}

      {assets === null ? (
        <p className="text-xs text-text-faint py-3 text-center">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="text-xs text-text-faint py-3 text-center">
          Nothing uploaded yet. Import a video above and it'll appear here for reuse.
        </p>
      ) : (
        <ul className="space-y-1 max-h-[240px] overflow-y-auto">
          {assets.map((asset) => {
            const Icon = isVideo(asset) ? Film : ImageIcon;
            return (
              <li
                key={`${asset.asset_id}/${asset.filename}`}
                className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
              >
                {isVideo(asset) ? (
                  <Icon size={14} className="text-text-faint shrink-0" />
                ) : (
                  <img
                    src={resolveMotionAssetUrl(asset.source_url)}
                    alt=""
                    className="w-6 h-6 object-cover rounded shrink-0 border border-border/50"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onInsertAsset(asset)}
                  title={`Add ${asset.filename} to the scene`}
                  className="flex-1 min-w-0 text-left hover:text-accent"
                >
                  <span className="block text-xs truncate">{asset.filename}</span>
                  <span className="block text-[10px] text-text-faint">
                    {formatSize(asset.size_bytes)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(asset)}
                  disabled={busyId === asset.asset_id}
                  title="Delete asset"
                  className="text-text-faint hover:text-danger disabled:opacity-40 shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
