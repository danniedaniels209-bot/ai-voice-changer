/**
 * LT-LAYERSEARCH: which layers should be VISIBLE in LayerPanel's tree for a
 * given name/type filter.
 *
 * Pulled out as a pure function (not left inline in LayerPanel.tsx) because
 * the bug this fixes is exactly the kind that's easy to reintroduce by
 * hand: the previous version filtered only the TOP-LEVEL layer list and
 * rendered a matched parent's children unconditionally — so a query that
 * matched a CHILD's name but not its ancestor folder's name made that
 * child invisible, full stop, with no error and nothing to grep for. A
 * pure function with its own tests makes that regression visible in CI
 * instead of only in a nested project nobody happened to test by hand.
 */

import type { LayerType, MotionLayer } from "../types/motion";
import { getDescendants } from "./layerTree";

export type TypeFilter = LayerType | "all";

function matchesQuery(layer: MotionLayer, query: string): boolean {
  if (!query) return true;
  // Match against the FULL raw name, including a subtitle import's
  // ` · cc:<id>` tag (LT-CAPTIONSTYLE) — that's what lets pasting an exact
  // group tag isolate one import's layers, and stripping the tag before
  // matching would silently break that.
  return layer.name.toLowerCase().includes(query.toLowerCase());
}

function matchesType(layer: MotionLayer, typeFilter: TypeFilter): boolean {
  return typeFilter === "all" || layer.type === typeFilter;
}

/**
 * The set of layer ids that should render, given a name query and a type
 * filter. A layer is visible if:
 *   - it matches BOTH the query and the type filter itself, OR
 *   - it is an ANCESTOR of a layer that matches (so the tree path down to
 *     a match still renders, even though the ancestor's own name/type
 *     didn't match), OR
 *   - it is a DESCENDANT of a layer that matches (so matching a folder's
 *     name reveals everything inside it, which is the behavior anyone
 *     typing a folder name actually wants).
 *
 * Returns null when neither filter is active — the caller's cheap "show
 * literally everything, don't touch the tree" case, and the same shape
 * `Set | null` a caller can trivially treat as "no filtering" without a
 * separate boolean flag to keep in sync.
 */
export function visibleLayerIds(
  layers: MotionLayer[],
  query: string,
  typeFilter: TypeFilter,
): Set<string> | null {
  const q = query.trim();
  if (!q && typeFilter === "all") return null;

  const byId = new Map(layers.map((l) => [l.id, l]));
  const directMatches = layers.filter((l) => matchesQuery(l, q) && matchesType(l, typeFilter));

  const visible = new Set<string>();
  for (const match of directMatches) {
    visible.add(match.id);
    // Ancestors: walk parent_id up to the root, adding each one.
    let current: MotionLayer | undefined = match;
    const seen = new Set<string>();
    while (current?.parent_id && !seen.has(current.parent_id)) {
      seen.add(current.parent_id);
      visible.add(current.parent_id);
      current = byId.get(current.parent_id);
    }
    // Descendants: reuse the same walk DELETE_SELECTED_LAYERS' cascade
    // uses, so "what counts as inside this layer" can't drift between the
    // two features.
    for (const descId of getDescendants(match.id, layers)) {
      visible.add(descId);
    }
  }
  return visible;
}
