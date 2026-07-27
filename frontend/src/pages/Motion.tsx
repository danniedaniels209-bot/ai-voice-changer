import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Clapperboard, Trash2, X } from "lucide-react";
import {
  createMotionProject,
  deleteMotionProject,
  listMotionProjects,
  saveMotionProject,
  type MotionProjectSummary,
} from "../api/motion";
import { TemplateGallery } from "../motion/templates/TemplateGallery";
import { ProjectSearchBar } from "../motion/projects/ProjectSearchBar";
import { filterAndSortProjects, type ProjectSortBy } from "../motion/projects/filterProjects";
import type { MotionScene } from "../types/motion";

export function Motion() {
  const [projects, setProjects] = useState<MotionProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<ProjectSortBy>("updated");
  const navigate = useNavigate();

  function refresh() {
    listMotionProjects().then(setProjects).catch((err) => setError(String(err)));
  }

  useEffect(refresh, []);

  const visibleProjects = filterAndSortProjects(projects ?? [], query, sortBy);

  async function handleCreate(scene?: MotionScene) {
    setCreating(true);
    setError(null);
    try {
      let project = await createMotionProject("Untitled Project");
      if (scene) {
        project = await saveMotionProject({ ...project, scenes: [scene] });
      }
      navigate(`/motion/${project.id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
      setPickerOpen(false);
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this project? This can't be undone.")) return;
    await deleteMotionProject(id);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Motion Studio</h2>
          <p className="text-text-muted text-sm mt-1">
            Build animated explainer videos by hand — shapes, text, keyframes, and connectors.
            Nothing here is AI-generated; you're in full control.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={creating}
          className="flex items-center gap-2 bg-accent text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={16} />
          New Project
        </button>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !creating && setPickerOpen(false)}
        >
          <div
            className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
              <span className="font-semibold text-base text-text">New Project</span>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                disabled={creating}
                className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text disabled:opacity-50"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-3 border-b border-border shrink-0">
              <button
                type="button"
                onClick={() => handleCreate()}
                disabled={creating}
                className="w-full text-left flex flex-col p-3 rounded-lg border border-border bg-background hover:border-accent hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                <h3 className="text-sm font-medium text-text">Blank Project</h3>
                <p className="text-xs text-text-muted mt-0.5">Start from a single empty scene.</p>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              <TemplateGallery onSelect={(scene) => handleCreate(scene)} />
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}

      {projects === null ? (
        <p className="text-text-muted text-sm">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center text-text-muted">
          <Clapperboard size={32} className="mx-auto mb-3 opacity-60" />
          <p className="text-sm">No projects yet. Create one to open the editor.</p>
        </div>
      ) : (
        <>
          <ProjectSearchBar
            query={query}
            onQueryChange={setQuery}
            sortBy={sortBy}
            onSortByChange={setSortBy}
          />
          {visibleProjects.length === 0 ? (
            <p className="text-text-muted text-sm py-8 text-center">
              No projects match “{query}”.
            </p>
          ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {visibleProjects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/motion/${p.id}`)}
              className="text-left border border-border rounded-lg p-4 hover:bg-surface-hover hover:border-accent transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-sm truncate">{p.name}</span>
                <span
                  role="button"
                  title="Delete project"
                  onClick={(e) => handleDelete(p.id, e)}
                  className="text-text-faint hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Trash2 size={14} />
                </span>
              </div>
              <p className="text-text-muted text-xs mt-1">
                {p.scene_count} scene{p.scene_count === 1 ? "" : "s"} · updated{" "}
                {new Date(p.updated_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
          )}
        </>
      )}
    </div>
  );
}
