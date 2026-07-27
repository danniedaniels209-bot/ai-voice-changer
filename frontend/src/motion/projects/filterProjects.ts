import type { MotionProjectSummary } from "../../api/motion";

export type ProjectSortBy = "name" | "updated";

/**
 * Filter a list of project summaries by a case-insensitive substring match
 * on `name`, then sort by the requested key. The sort is STABLE — projects
 * that compare equal keep their input order, so a caller-provided ID ordering
 * (or whatever order the API returned) is preserved within equal groups.
 *
 * For `updated` we sort by `updated_at` descending (most recently edited
 * first) — the natural ordering for a "recent projects" list. For `name`
 * we sort ascending, case-insensitively.
 */
export function filterAndSortProjects(
  projects: MotionProjectSummary[],
  query: string,
  sortBy: ProjectSortBy,
): MotionProjectSummary[] {
  const q = query.trim().toLowerCase();
  const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : [...projects];

  // Stable sort: only reorder when the comparator actually distinguishes two
  // items; otherwise leave equal items in their original (filtered) order.
  const indexed = filtered.map((p, idx) => ({ p, idx }));

  indexed.sort((a, b) => {
    if (sortBy === "name") {
      const cmp = a.p.name.toLowerCase().localeCompare(b.p.name.toLowerCase());
      if (cmp !== 0) return cmp;
      return a.idx - b.idx;
    }
    // "updated" — most recent first.
    const ta = Date.parse(a.p.updated_at);
    const tb = Date.parse(b.p.updated_at);
    const taN = Number.isNaN(ta) ? 0 : ta;
    const tbN = Number.isNaN(tb) ? 0 : tb;
    if (tbN !== taN) return tbN - taN;
    return a.idx - b.idx;
  });

  return indexed.map((entry) => entry.p);
}
