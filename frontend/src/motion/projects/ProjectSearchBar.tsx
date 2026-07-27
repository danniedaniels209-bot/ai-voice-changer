import { Search } from "lucide-react";
import type { ProjectSortBy } from "./filterProjects";

export interface ProjectSearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  sortBy: ProjectSortBy;
  onSortByChange: (s: ProjectSortBy) => void;
  placeholder?: string;
  className?: string;
}

export function ProjectSearchBar({
  query,
  onQueryChange,
  sortBy,
  onSortByChange,
  placeholder = "Search projects by name...",
  className = "",
}: ProjectSearchBarProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex-1">
        <Search
          size={15}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-background border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
        />
      </div>
      <select
        value={sortBy}
        onChange={(e) => onSortByChange(e.target.value as ProjectSortBy)}
        className="bg-background border border-border rounded-md px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
        title="Sort projects"
      >
        <option value="updated">Last edited</option>
        <option value="name">Name</option>
      </select>
    </div>
  );
}
