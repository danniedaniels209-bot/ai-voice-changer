import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  PlusCircle,
  PenLine,
  Sparkles,
  ListVideo,
  Box,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Cpu,
  Zap,
  Diamond,
} from "lucide-react";
import { getHealth } from "../api/health";
import type { HealthResponse } from "../types/api";

type Item = { to: string; label: string; icon: typeof PlusCircle; end?: boolean };
type Group = { label: string; items: Item[] };

const NAV_GROUPS: Group[] = [
  {
    label: "Create",
    items: [
      { to: "/", label: "New Conversion", icon: PlusCircle, end: true },
      { to: "/studio", label: "Script Studio", icon: PenLine },
      { to: "/chat", label: "AI Chat", icon: Sparkles },
    ],
  },
  {
    label: "Library",
    items: [
      { to: "/processing", label: "Jobs", icon: ListVideo },
      { to: "/models", label: "Models", icon: Box },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings", icon: Settings }],
  },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "New Conversion",
  "/studio": "Script Studio",
  "/chat": "AI Chat",
  "/processing": "Jobs",
  "/models": "Voice Models",
  "/settings": "Settings",
};

export function Layout() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "1",
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const location = useLocation();

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  function toggleSidebar() {
    setCollapsed((c) => {
      localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      return !c;
    });
  }

  const gpu = health?.hardware;
  const title =
    PAGE_TITLES[location.pathname] ??
    (location.pathname.startsWith("/processing/") ? "Job" : "");

  return (
    <div className="h-screen flex flex-col bg-bg text-text overflow-hidden">
      <div className="flex-1 flex min-h-0">
        {/* ── Sidebar ── */}
        <aside
          className={`shrink-0 flex flex-col border-r border-border bg-surface transition-[width] duration-200 ${
            collapsed ? "w-16" : "w-[232px]"
          }`}
        >
          <NavLink
            to="/"
            className="flex items-center gap-2.5 px-4 h-14 shrink-0 border-b border-border hover:bg-surface-hover transition-colors"
          >
            <Diamond size={18} className="text-accent shrink-0" strokeWidth={2.2} />
            {!collapsed && (
              <span className="font-semibold tracking-tight text-[15px] whitespace-nowrap">
                Voice Studio
              </span>
            )}
          </NavLink>

          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                    {group.label}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          `relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                            isActive
                              ? "bg-accent-dim text-text"
                              : "text-text-muted hover:text-text hover:bg-surface-hover"
                          } ${collapsed ? "justify-center px-0" : ""}`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
                            )}
                            <Icon
                              size={17}
                              strokeWidth={2}
                              className={isActive ? "text-accent shrink-0" : "shrink-0"}
                            />
                            {!collapsed && (
                              <span className="whitespace-nowrap">{item.label}</span>
                            )}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="shrink-0 border-t border-border p-2 space-y-1">
            {gpu && (
              <div
                title={gpu.device_name ?? "CPU"}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  collapsed ? "justify-center px-0" : ""
                } ${gpu.cuda_available ? "text-success" : "text-text-muted"}`}
              >
                {gpu.cuda_available ? (
                  <Zap size={14} className="shrink-0" />
                ) : (
                  <Cpu size={14} className="shrink-0" />
                )}
                {!collapsed && (
                  <span className="truncate">
                    {gpu.cuda_available
                      ? (gpu.device_name ?? "GPU").replace("NVIDIA ", "")
                      : "CPU only"}
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={toggleSidebar}
              className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface-hover transition-colors ${
                collapsed ? "justify-center px-0" : ""
              }`}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 shrink-0 border-b border-border flex items-center px-6 gap-3">
            <h1 className="text-sm font-semibold tracking-tight text-text truncate">
              {title}
            </h1>
            <div className="flex-1" />
            {health && (
              <span
                className={`flex items-center gap-1.5 text-xs font-medium rounded-full border border-border px-2.5 py-1 ${
                  health.ffmpeg_found ? "text-text-muted" : "text-warning"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    health.ffmpeg_found ? "bg-success" : "bg-warning"
                  }`}
                />
                Backend
              </span>
            )}
          </header>

          <main className="flex-1 overflow-y-auto min-h-0">
            <div
              key={location.pathname}
              className="max-w-5xl w-full mx-auto px-8 py-8 animate-rise"
            >
              <Outlet />
            </div>
          </main>

          {/* ── Status bar ── */}
          <footer className="h-7 shrink-0 border-t border-border glass flex items-center px-4 gap-4 text-[11px] font-medium text-text-muted">
            <span className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${health ? "bg-success" : "bg-danger"}`}
              />
              {health ? "Connected" : "Backend offline"}
            </span>
            {gpu && (
              <span className="flex items-center gap-1">
                {gpu.cuda_available ? <Zap size={11} /> : <Cpu size={11} />}
                {gpu.resolved_device}
              </span>
            )}
            <div className="flex-1" />
            <span className="text-text-faint">AI Video Voice Changer</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
