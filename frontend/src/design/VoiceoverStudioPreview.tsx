/**
 * Voiceover Studio — interactive design prototype (LT-REDESIGN).
 *
 * This is the redesign mockup rebuilt in the application's OWN stack
 * (TypeScript + React) rather than as a dead HTML file. That matters for two
 * reasons:
 *
 *   1. It transfers. Every component here is real React with real props and
 *      real state, so an approved design becomes an implementation by moving
 *      files, not by re-authoring everything from a picture.
 *   2. It can be judged honestly. A static image can't tell you whether a
 *      400px inspector is actually usable, whether the timeline reads at a
 *      glance while scrubbing, or whether the density holds up once things
 *      move. This one you can click.
 *
 * It renders at /design-preview, OUTSIDE the existing <Layout> — this is a
 * whole-shell redesign, so nesting it inside the shell it replaces would
 * show a shell inside a shell and prove nothing.
 *
 * NOT WIRED TO ANY BACKEND. Every value is local state. No project loads, no
 * export runs, no audio decodes. It is a design artefact for review, and no
 * existing screen is affected by it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ── Design tokens, straight from MASTER_DIRECTIVE.md §11 ─────────────── */
const C = {
  bg: "#111111",
  surface2: "#1A1A1A",
  panel: "#202020",
  border: "rgba(255,255,255,0.06)",
  borderStrong: "rgba(255,255,255,0.10)",
  accent: "#00D2FF",
  accent2: "#7A5CFF",
  success: "#38D39F",
  warning: "#F7B731",
  error: "#FF5C5C",
  text: "#EDEDED",
  muted: "#9A9A9A",
  faint: "#6B6B6B",
} as const;

const FONT =
  'Inter,"SF Pro Display",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

/* ── Tiny inline icon set (no external icon dependency) ───────────────── */
type IconName =
  | "media" | "audio" | "text" | "sticker" | "effects" | "transitions"
  | "filters" | "adjust" | "templates" | "import" | "record" | "search"
  | "chevron" | "grid" | "filter" | "clock" | "keyboard" | "star" | "export"
  | "min" | "max" | "close" | "play" | "pause" | "menu" | "reset" | "diamond"
  | "undo" | "redo" | "split" | "trimIn" | "trimOut" | "trash" | "crop"
  | "marker" | "warn" | "unlink" | "keyframe" | "mic" | "more" | "lock"
  | "volume" | "eye" | "fullscreen" | "fit" | "layout";

function Icon({ name, size = 16, color }: { name: IconName; size?: number; color?: string }) {
  const p: Record<IconName, string> = {
    media: "M3 4h18v16H3zM3 9h18M9 4v5",
    audio: "M9 18V6l10-2v12M6 21a3 3 0 100-6 3 3 0 000 6zM16 19a3 3 0 100-6 3 3 0 000 6z",
    text: "M5 6h14M12 6v13M9 19h6",
    sticker: "M20 12a8 8 0 10-8 8M12 20l8-8h-5a3 3 0 00-3 3z",
    effects: "M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2",
    transitions: "M4 6l7 6-7 6zM20 6l-7 6 7 6z",
    filters: "M9 14a5 5 0 100-10 5 5 0 000 10zM15 20a5 5 0 100-10 5 5 0 000 10z",
    adjust: "M4 8h10M18 8h2M4 16h4M12 16h8M16 6a2 2 0 100 4 2 2 0 000-4zM10 14a2 2 0 100 4 2 2 0 000-4z",
    templates: "M3 8h18v11H3zM7 3h10",
    import: "M12 16V4M7 9l5-5 5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
    record: "M12 4a8 8 0 100 16 8 8 0 000-16zM12 9a3 3 0 100 6 3 3 0 000-6z",
    search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-3.5-3.5",
    chevron: "M6 9l6 6 6-6",
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z",
    filter: "M3 5h18l-7 8v6l-4 2v-8z",
    clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2",
    keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8",
    star: "M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z",
    export: "M12 16V4M7 9l5-5 5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
    min: "M5 12h14",
    max: "M5 5h14v14H5z",
    close: "M6 6l12 12M18 6L6 18",
    play: "M8 5l12 7-12 7z",
    pause: "M9 5v14M15 5v14",
    menu: "M4 7h16M4 12h16M4 17h16",
    reset: "M4 12a8 8 0 108-8H7M9 1L6 4l3 3",
    diamond: "M12 4l7 8-7 8-7-8z",
    undo: "M4 12a8 8 0 018-8h5M14 1l3 3-3 3",
    redo: "M20 12a8 8 0 00-8-8H7M10 1L7 4l3 3",
    split: "M6 3.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6 15.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 8l12 10M8 16L20 6",
    trimIn: "M8 4v16M5 8h3M5 16h3M16 4v16",
    trimOut: "M16 4v16M19 8h-3M19 16h-3M8 4v16",
    trash: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13",
    crop: "M6 2v16h16M2 6h16v16",
    marker: "M4 6h16v12H4zM9 12h6",
    warn: "M12 4l9 16H3zM12 10v4M12 17h.01",
    unlink: "M9 12a4 4 0 014-4h3M15 12a4 4 0 01-4 4H8M4 4l16 16",
    keyframe: "M3 5h18v14H3zM12 9l3 3-3 3-3-3z",
    mic: "M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3",
    more: "M5 12h14",
    lock: "M5 11h14v9H5zM8 11V8a4 4 0 018 0v3",
    volume: "M5 10v4h3l4 3V7L8 10zM16 9a4 4 0 010 6",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z",
    fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    fit: "M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3M8 9h8v6H8z",
    layout: "M3 5h18v14H3zM3 10h18",
  };
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color ?? "currentColor"} strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: "none", display: "block" }}
    >
      <path d={p[name]} />
    </svg>
  );
}

/* ── Deterministic RNG so the prototype looks identical on every open ─── */
function makeRng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
}

/* ── Generated artwork (keeps this dependency-free and offline-safe) ──── */
function NeonStage({ small = false }: { small?: boolean }) {
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden" }}>
      <div style={{
        position: "absolute", inset: 0,
        background:
          "radial-gradient(70% 90% at 22% 45%, rgba(120,40,200,.85), transparent 60%)," +
          "radial-gradient(60% 80% at 78% 55%, rgba(210,30,140,.75), transparent 62%)," +
          "radial-gradient(90% 70% at 50% 110%, rgba(40,10,70,.9), transparent 70%)," +
          "linear-gradient(160deg,#1B0B33,#0A0616)",
      }} />
      <div style={{
        position: "absolute", left: small ? "8%" : "14%", top: small ? "24%" : "30%",
        width: small ? "32%" : "26%", aspectRatio: "1.9 / 1", borderRadius: 6,
        border: `${small ? 1.5 : 2.5}px solid #FF4FD8`,
        boxShadow: `0 0 ${small ? 10 : 22}px rgba(255,79,216,.75), inset 0 0 ${small ? 8 : 16}px rgba(255,79,216,.45)`,
        display: "grid", placeItems: "center", color: "#FFD9F6", fontWeight: 800,
        fontSize: small ? 7 : 15, letterSpacing: ".12em",
        textShadow: `0 0 ${small ? 6 : 12}px rgba(255,120,220,.95)`,
      }}>ON AIR</div>
      <div style={{
        position: "absolute", right: small ? "12%" : "22%", top: small ? "8%" : "10%",
        bottom: small ? "4%" : "6%", width: small ? "26%" : "22%", borderRadius: "50% / 12%",
        background: "linear-gradient(150deg,#3A3F4A,#15181F 55%,#0B0D12)",
        boxShadow: `inset 0 0 ${small ? 10 : 22}px rgba(255,255,255,.14), 0 0 ${small ? 12 : 28}px rgba(0,0,0,.6)`,
      }} />
      <div style={{
        position: "absolute", right: small ? "17%" : "27%", top: small ? "16%" : "20%",
        width: small ? "16%" : "12%", aspectRatio: "1", borderRadius: "50%",
        background: "repeating-radial-gradient(circle,rgba(255,255,255,.16) 0 1px,transparent 1px 3px),#20242C",
      }} />
    </div>
  );
}

function Waveform({ color, seed, bars = 150, style }: {
  color: string; seed: number; bars?: number; style?: React.CSSProperties;
}) {
  const d = useMemo(() => {
    const r = makeRng(seed);
    const w = 1000, h = 100;
    let path = "";
    for (let i = 0; i < bars; i++) {
      const x = (i / bars) * w;
      // Envelope so it reads as speech/music rather than uniform noise.
      const env = 0.35 + 0.65 * Math.abs(Math.sin((i / bars) * Math.PI * 3.1 + seed));
      const a = Math.max(2, (r() * 0.75 + 0.25) * env * h * 0.46);
      path += `M${x.toFixed(1)} ${(h / 2 - a).toFixed(1)}V${(h / 2 + a).toFixed(1)}`;
    }
    return path;
  }, [seed, bars]);
  return (
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ display: "block", ...style }}>
      <path d={d} stroke={color} strokeWidth={(1000 / bars) * 0.62} opacity={0.92} />
    </svg>
  );
}

/* ── Small reusable controls ──────────────────────────────────────────── */
function Slider({ value, onChange, min = 0, max = 100 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;

  const set = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(Math.round((min + f * (max - min)) * 10) / 10);
  }, [onChange, min, max]);

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        set(e.clientX);
      }}
      onPointerMove={(e) => { if (e.buttons === 1) set(e.clientX); }}
      style={{ flex: 1, height: 14, display: "flex", alignItems: "center", cursor: "pointer", touchAction: "none" }}
    >
      <div style={{ position: "relative", width: "100%", height: 3, borderRadius: 3, background: "#3A3A3A" }}>
        <div style={{ position: "absolute", inset: "0 auto 0 0", width: `${pct}%`, background: C.accent, borderRadius: 3 }} />
        <div style={{
          position: "absolute", top: "50%", left: `${pct}%`, width: 12, height: 12, borderRadius: "50%",
          background: "#fff", transform: "translate(-50%,-50%)", boxShadow: "0 1px 4px rgba(0,0,0,.5)",
        }} />
      </div>
    </div>
  );
}

function Stepper({ value, suffix = "" }: { value: number | string; suffix?: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
      height: 26, padding: "0 6px 0 9px", background: "#181818",
      border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12,
      fontVariantNumeric: "tabular-nums", minWidth: 74,
    }}>
      <span>{value}{suffix}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, color: C.faint }}>
        <svg width="9" height="6" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 11l8-8 8 8" /></svg>
        <svg width="9" height="6" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 3l8 8 8-8" /></svg>
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      {/* 86px, not 72 — at 72 "Uniform scale" wrapped to two lines and threw
          the row's vertical rhythm out. Caught by screenshotting the real
          render; it is invisible in the markup. */}
      <span style={{ width: 86, flex: "none", color: C.muted, fontSize: 12 }}>{label}</span>
      {children}
    </div>
  );
}

/* ── Data ─────────────────────────────────────────────────────────────── */
const RAIL: { id: string; icon: IconName }[] = [
  { id: "Media", icon: "media" }, { id: "Audio", icon: "audio" },
  { id: "Text", icon: "text" }, { id: "Stickers", icon: "sticker" },
  { id: "Effects", icon: "effects" }, { id: "Transitions", icon: "transitions" },
  { id: "Filters", icon: "filters" }, { id: "Adjustment", icon: "adjust" },
  { id: "Templates", icon: "templates" },
];

type Asset = {
  name: string; dur?: string; added?: boolean;
  kind: "folder" | "neon" | "mic" | "wave" | "scene" | "logo";
  color?: string; seed?: number; sub?: string;
};
const ASSETS: Asset[] = [
  { kind: "folder", name: "Project assets", sub: "12 items" },
  { kind: "neon", name: "podcast_intro.mp4", dur: "00:18", added: true },
  { kind: "mic", name: "mic_closeup.jpg", dur: "00:39" },
  { kind: "wave", name: "voice_sample.wav", dur: "02:36", color: "#A98BFF", seed: 3 },
  { kind: "wave", name: "bg_music.mp3", dur: "03:21", added: true, color: "#4FA8FF", seed: 7 },
  { kind: "wave", name: "sound_effect.wav", dur: "00:03", color: "#4FA8FF", seed: 11 },
  { kind: "scene", name: "scene_01.mp4", dur: "00:07" },
  { kind: "neon", name: "overlay.png", dur: "00:04", added: true },
  { kind: "logo", name: "logo.png" },
];

const DURATION_MS = 45000;
const fmt = (ms: number) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), f = Math.floor((t % 1000) / 40);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `00:${p(m)}:${p(s)}:${p(f)}`;
};

/* ── The prototype ────────────────────────────────────────────────────── */
export function VoiceoverStudioPreview() {
  const [rail, setRail] = useState("Media");
  const [mediaTab, setMediaTab] = useState("Import");
  const [inspTab, setInspTab] = useState("Video");
  const [subTab, setSubTab] = useState("Basic");
  const [voTab, setVoTab] = useState("Text to Speech");

  const [scale, setScale] = useState(38);
  const [opacity, setOpacity] = useState(100);
  const [uniform, setUniform] = useState(true);
  const [blendOn, setBlendOn] = useState(true);
  const [stabilize, setStabilize] = useState(false);
  const [pitch, setPitch] = useState(50);
  const [speed, setSpeed] = useState(44);
  const [intensity, setIntensity] = useState(70);

  const [showHint, setShowHint] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(7500);
  const [selectedClip, setSelectedClip] = useState<string | null>("video");

  // Transport. Real playback so the timeline can be judged in motion — a
  // static image can't tell you whether the playhead reads at a glance.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      setPlayhead((p) => (p + dt >= DURATION_MS ? 0 : p + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Space toggles playback, like every NLE.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const lanesRef = useRef<HTMLDivElement>(null);
  const scrub = (clientX: number) => {
    const el = lanesRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPlayhead(Math.min(DURATION_MS, Math.max(0, ((clientX - r.left) / r.width) * DURATION_MS)));
  };

  const pct = (playhead / DURATION_MS) * 100;

  const S: Record<string, React.CSSProperties> = {
    tab: { display: "flex", alignItems: "center", gap: 6, height: 42, fontSize: 13, position: "relative", cursor: "pointer", color: C.muted },
    tabOn: { color: C.accent, fontWeight: 600 },
    underline: { position: "absolute", left: 0, right: 0, bottom: 0, height: 2, background: C.accent, borderRadius: "2px 2px 0 0" },
    btn: { display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7, border: `1px solid ${C.borderStrong}`, background: "#242424", color: C.text, font: "inherit", fontSize: 12.5, cursor: "pointer" },
    head: { height: 42, flex: "none", display: "flex", alignItems: "center", gap: 18, padding: "0 14px", borderBottom: `1px solid ${C.border}` },
    group: { padding: "14px 14px 4px" },
    groupHead: { display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 13, fontWeight: 600 },
    tool: { width: 29, height: 27, display: "grid", placeItems: "center", borderRadius: 6, color: C.muted, cursor: "pointer" },
    thead: { display: "flex", alignItems: "center", gap: 9, padding: "0 10px", color: C.faint },
    clipLabel: { position: "absolute", top: 0, left: 0, right: 0, height: 22, display: "flex", alignItems: "center", gap: 6, padding: "0 8px", fontSize: 11, fontWeight: 600, zIndex: 2, textShadow: "0 1px 2px rgba(0,0,0,.6)" },
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, font: `500 13px ${FONT}`, overflow: "hidden", WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        .vs-hover:hover{background:rgba(255,255,255,.06)!important;color:${C.text}!important}
        .vs-card:hover .vs-thumb{border-color:${C.borderStrong}!important}
        .vs-close:hover{background:${C.error}!important;color:#fff!important}
        .vs-scroll::-webkit-scrollbar{width:9px;height:9px}
        .vs-scroll::-webkit-scrollbar-thumb{background:#333;border-radius:6px}
        .vs-scroll::-webkit-scrollbar-track{background:transparent}
      `}</style>

      {/* ═══ Top navigation bar ═══ */}
      <div style={{ height: 52, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 12px", background: C.surface2, borderBottom: `1px solid ${C.border}`, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 600, fontSize: 14, letterSpacing: "-0.01em" }}>
          <span style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 17 }}>
            {[7, 13, 17, 11, 6].map((h, i) => (
              <i key={i} style={{ width: 2.5, height: h, borderRadius: 2, background: i === 1 || i === 3 ? C.accent2 : C.accent, display: "block" }} />
            ))}
          </span>
          Voiceover Studio
        </div>
        <div style={S.btn} className="vs-hover">Menu <Icon name="chevron" size={14} /></div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 12 }}>
          <Icon name="clock" size={14} /> Auto saved: 10:30:15
        </div>

        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", fontSize: 13.5, fontWeight: 600 }}>
          New Project
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ ...S.btn, background: "transparent", borderColor: "transparent", color: C.muted }} className="vs-hover">
          <Icon name="layout" /> <Icon name="chevron" size={14} />
        </div>
        <div style={S.btn} className="vs-hover"><Icon name="keyboard" size={14} /> Shortcuts</div>
        <div style={{ ...S.btn, background: C.accent2, borderColor: "transparent", color: "#fff", fontWeight: 600 }}>
          <Icon name="star" size={14} /> Join Pro
        </div>
        <div style={{ ...S.btn, background: C.accent, borderColor: "transparent", color: "#04222B", fontWeight: 700 }}>
          <Icon name="export" size={14} /> Export
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: 6 }}>
          {(["min", "max", "close"] as const).map((n) => (
            <button key={n} className={n === "close" ? "vs-close vs-hover" : "vs-hover"}
              style={{ width: 34, height: 30, display: "grid", placeItems: "center", background: "none", border: 0, color: C.muted, borderRadius: 6, cursor: "pointer" }}>
              <Icon name={n} size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* ═══ Main ═══ */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* ── Left rail ── */}
        <div className="vs-scroll" style={{ width: 76, flex: "none", background: C.surface2, borderRight: `1px solid ${C.border}`, padding: "6px 0", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {RAIL.map((r) => {
            const on = rail === r.id;
            return (
              <div key={r.id} onClick={() => setRail(r.id)} className={on ? "" : "vs-hover"}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "9px 4px", margin: "0 6px", borderRadius: 7, cursor: "pointer", fontSize: 10.5, color: on ? C.accent : C.faint, background: on ? "rgba(0,210,255,.12)" : "transparent" }}>
                <Icon name={r.icon} size={19} /> {r.id}
              </div>
            );
          })}
        </div>

        {/* ── Centre column ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

            {/* Media browser */}
            <div style={{ width: 490, flex: "none", background: C.panel, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={S.head}>
                {["Import", "Record", "Library"].map((t) => (
                  <div key={t} onClick={() => setMediaTab(t)} style={{ ...S.tab, ...(mediaTab === t ? S.tabOn : {}) }}>
                    {t === "Import" && <Icon name="import" size={14} />}
                    {t === "Record" && <Icon name="record" size={14} />}
                    {t}
                    {mediaTab === t && <span style={S.underline} />}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
                <div style={{ ...S.btn, background: "#0E2E38", borderColor: "rgba(0,210,255,.35)", color: C.accent, fontWeight: 600 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent }} /> Import
                </div>
                <div style={{ flex: 1 }} />
                {(["grid", "filter"] as const).map((n, i) => (
                  <div key={i} className="vs-hover" style={{ display: "flex", alignItems: "center", gap: 5, height: 26, padding: "0 9px", borderRadius: 6, color: C.muted, cursor: "pointer" }}>
                    <Icon name={n} size={14} />{n === "grid" && <Icon name="chevron" size={13} />}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px 10px" }}>
                <div className="vs-hover" style={{ display: "flex", alignItems: "center", gap: 5, height: 26, padding: "0 9px", borderRadius: 6, color: C.muted, fontSize: 12, cursor: "pointer" }}>
                  All <Icon name="chevron" size={13} />
                </div>
                <div style={{ flex: 1, height: 28, display: "flex", alignItems: "center", gap: 7, padding: "0 10px", background: "#181818", border: `1px solid ${C.border}`, borderRadius: 7, color: C.faint, fontSize: 12 }}>
                  <span style={{ flex: 1 }}>Search assets</span><Icon name="search" size={14} />
                </div>
              </div>

              <div className="vs-scroll" style={{ flex: 1, overflowY: "auto", padding: "2px 14px 14px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, alignContent: "start" }}>
                {ASSETS.map((a) => (
                  <div key={a.name} className="vs-card" style={{ cursor: "pointer" }}>
                    <div className="vs-thumb" style={{ position: "relative", aspectRatio: "16 / 11", borderRadius: 7, background: "#151515", border: `1px solid ${C.border}`, overflow: "hidden", display: "grid", placeItems: "center" }}>
                      {a.kind === "folder" && (
                        <div style={{ width: "58%", height: "58%", borderRadius: "6px 10px 10px 10px", background: "linear-gradient(160deg,#F5C451,#E0A62F)", position: "relative" }}>
                          <span style={{ position: "absolute", top: -6, left: 0, width: "44%", height: 8, borderRadius: "5px 5px 0 0", background: "#F5C451" }} />
                        </div>
                      )}
                      {a.kind === "neon" && <NeonStage small />}
                      {a.kind === "mic" && (
                        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(60% 80% at 40% 50%,#4A4F5A,#14171D 70%)" }}>
                          <div style={{ position: "absolute", left: "34%", top: "12%", bottom: "14%", width: "24%", borderRadius: "40% / 14%", background: "linear-gradient(150deg,#5A606C,#20242C)", boxShadow: "inset 0 0 14px rgba(255,255,255,.18)" }} />
                        </div>
                      )}
                      {a.kind === "scene" && (
                        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg,#2B1140,#5A1150 45%,#101020)" }}>
                          <div style={{ position: "absolute", left: "8%", top: "16%", width: "36%", height: "26%", border: "1.5px solid #FF5FD0", borderRadius: 4, boxShadow: "0 0 9px rgba(255,95,208,.7)" }} />
                        </div>
                      )}
                      {a.kind === "logo" && <span style={{ fontSize: 34, fontWeight: 800, color: "#DDD", letterSpacing: "-0.04em" }}>S</span>}
                      {a.kind === "wave" && <Waveform color={a.color!} seed={a.seed!} bars={70} style={{ width: "100%", height: "100%" }} />}
                      {a.added && <span style={{ position: "absolute", top: 6, left: 6, padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600, background: "rgba(0,0,0,.72)" }}>Added</span>}
                      {a.dur && <span style={{ position: "absolute", top: 6, right: 6, padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600, background: "rgba(0,0,0,.72)", fontVariantNumeric: "tabular-nums" }}>{a.dur}</span>}
                    </div>
                    <div style={{ marginTop: 7, fontSize: 11.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                    {a.sub && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 1 }}>{a.sub}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Player */}
            <div style={{ flex: 1, minWidth: 0, background: C.panel, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={S.head}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Player</div>
                <div style={{ flex: 1 }} />
                <Icon name="menu" color={C.faint} />
              </div>
              <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 18, minHeight: 0 }}>
                <div style={{ width: "100%", height: "100%", borderRadius: 10, position: "relative", overflow: "hidden", background: "#0A0A0F" }}>
                  <NeonStage />
                </div>
              </div>
              <div style={{ height: 46, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.accent, fontWeight: 600, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{fmt(playhead)}</span>
                <span style={{ color: C.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{fmt(DURATION_MS)}</span>
                <div style={{ flex: 1 }} />
                <div onClick={() => setPlaying((p) => !p)} className="vs-hover"
                  style={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", cursor: "pointer" }}>
                  <Icon name={playing ? "pause" : "play"} size={19} />
                </div>
                <div style={{ flex: 1 }} />
                <Icon name="fit" color={C.muted} />
                <span style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.borderStrong}`, fontSize: 11, color: C.muted }}>16:9</span>
                <Icon name="fullscreen" color={C.muted} />
              </div>
            </div>
          </div>

          {/* ── Timeline ── */}
          <div style={{ height: 300, flex: "none", background: C.surface2, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ height: 40, flex: "none", display: "flex", alignItems: "center", gap: 3, padding: "0 10px", borderBottom: `1px solid ${C.border}` }}>
              {(["undo", "redo"] as const).map((n) => <div key={n} className="vs-hover" style={S.tool}><Icon name={n} /></div>)}
              <div style={{ width: 1, height: 18, background: C.border, margin: "0 5px" }} />
              {(["split", "trimIn", "trimOut", "trash", "crop", "marker", "warn", "unlink", "keyframe"] as const).map((n) => (
                <div key={n} className="vs-hover" style={S.tool}><Icon name={n} /></div>
              ))}
              <div style={{ flex: 1 }} />
              <div className="vs-hover" style={S.tool}><Icon name="mic" /></div>
              <div className="vs-hover" style={S.tool}><Icon name="more" /></div>
            </div>

            <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
              <div style={{ width: 118, flex: "none", borderRight: `1px solid ${C.border}`, paddingTop: 26, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ ...S.thead, height: 30 }} />
                <div style={{ ...S.thead, height: 76 }}>
                  <Icon name="eye" size={14} /><Icon name="lock" size={14} /><Icon name="volume" size={14} />
                </div>
                <div style={{ ...S.thead, height: 54 }}>
                  <Icon name="eye" size={14} /><Icon name="mic" size={14} /><Icon name="volume" size={14} />
                </div>
                <div style={{ ...S.thead, height: 54 }}>
                  <Icon name="eye" size={14} /><Icon name="audio" size={14} /><Icon name="volume" size={14} />
                </div>
              </div>

              <div ref={lanesRef} style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0 }}
                onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); scrub(e.clientX); }}
                onPointerMove={(e) => { if (e.buttons === 1) scrub(e.clientX); }}
              >
                <div style={{ height: 26, display: "flex", alignItems: "flex-end", borderBottom: `1px solid ${C.border}` }}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <span key={i} style={{ flex: 1, fontSize: 10, color: C.faint, paddingLeft: 5, paddingBottom: 5, borderLeft: "1px solid rgba(255,255,255,.05)", fontVariantNumeric: "tabular-nums" }}>
                      {`00:00:${String(i * 5).padStart(2, "0")}`}
                    </span>
                  ))}
                </div>

                <div style={{ paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Text clip */}
                  <div style={{ height: 30, position: "relative" }}>
                    <div onClick={() => setSelectedClip("text")}
                      style={{ position: "absolute", top: 0, bottom: 0, left: "4%", width: "38%", borderRadius: 7, overflow: "hidden", background: "linear-gradient(180deg,#8E6BFF,#6B47E8)", border: `1px solid ${selectedClip === "text" ? C.accent : "transparent"}`, boxShadow: selectedClip === "text" ? `0 0 0 1px rgba(0,210,255,.45),0 0 14px rgba(0,210,255,.22)` : "none", cursor: "pointer" }}>
                      <div style={S.clipLabel}><Icon name="text" size={12} />WELCOME TO VOICEOVER STUDIO</div>
                    </div>
                  </div>
                  {/* Video clips */}
                  <div style={{ height: 76, position: "relative" }}>
                    <div onClick={() => setSelectedClip("video")}
                      style={{ position: "absolute", top: 0, bottom: 0, left: "4%", width: "73%", borderRadius: 7, overflow: "hidden", background: "#123039", border: `1px solid ${selectedClip === "video" ? C.accent : "transparent"}`, boxShadow: selectedClip === "video" ? `0 0 0 1px rgba(0,210,255,.45),0 0 14px rgba(0,210,255,.22)` : "none", cursor: "pointer" }}>
                      <div style={{ position: "absolute", inset: 0, display: "flex" }}>
                        {Array.from({ length: 9 }, (_, i) => (
                          <div key={i} style={{ flex: 1, borderRight: "1px solid rgba(0,0,0,.35)", background: i % 3 === 0 ? "linear-gradient(160deg,#3A1450,#7A1A6A 55%,#12121F)" : i % 3 === 1 ? "linear-gradient(160deg,#241040,#4A1858 60%,#0E0E1A)" : "linear-gradient(160deg,#1B1030,#5A1550 50%,#0A0A14)" }} />
                        ))}
                      </div>
                      <div style={S.clipLabel}>podcast_intro.mp4&nbsp;&nbsp;00:00:18:15</div>
                      {selectedClip === "video" && <>
                        <div style={{ position: "absolute", top: 6, bottom: 6, left: 4, width: 4, borderRadius: 3, background: "rgba(255,255,255,.9)" }} />
                        <div style={{ position: "absolute", top: 6, bottom: 6, right: 4, width: 4, borderRadius: 3, background: "rgba(255,255,255,.9)" }} />
                      </>}
                    </div>
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: "78%", width: "20%", borderRadius: 7, overflow: "hidden", background: "radial-gradient(60% 70% at 40% 40%,#2A3A6A,#070B18 70%)" }} />
                  </div>
                  {/* Voiceover */}
                  <div style={{ height: 54, position: "relative" }}>
                    <div onClick={() => setSelectedClip("vo")}
                      style={{ position: "absolute", inset: "0 8% 0 0", borderRadius: 7, overflow: "hidden", background: "#10333D", border: `1px solid ${selectedClip === "vo" ? C.accent : "transparent"}`, cursor: "pointer" }}>
                      <div style={S.clipLabel}>voice_sample.wav</div>
                      <Waveform color="#4FE3D6" seed={3} style={{ position: "absolute", left: 0, right: 0, top: 22, height: "calc(100% - 22px)", width: "100%" }} />
                      {[18, 38, 52, 70, 88].map((p) => (
                        <i key={p} style={{ position: "absolute", left: `${p}%`, top: 25, width: 7, height: 7, background: "#fff", transform: "rotate(45deg)", borderRadius: 1 }} />
                      ))}
                    </div>
                  </div>
                  {/* Music */}
                  <div style={{ height: 54, position: "relative" }}>
                    <div onClick={() => setSelectedClip("music")}
                      style={{ position: "absolute", inset: "0 12% 0 0", borderRadius: 7, overflow: "hidden", background: "#16233F", border: `1px solid ${selectedClip === "music" ? C.accent : "transparent"}`, cursor: "pointer" }}>
                      <div style={S.clipLabel}>bg_music.mp3</div>
                      <Waveform color="#5B9BFF" seed={9} style={{ position: "absolute", left: 0, right: 0, top: 22, height: "calc(100% - 22px)", width: "100%" }} />
                    </div>
                  </div>
                </div>

                <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pct}%`, width: 1.5, background: "#fff", zIndex: 10, pointerEvents: "none" }}>
                  <span style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 11, height: 13, background: "#fff", borderRadius: "2px 2px 3px 3px" }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right column ── */}
        <div style={{ width: 400, flex: "none", display: "flex", flexDirection: "column", minHeight: 0, background: C.panel }}>
          <div className="vs-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <div style={S.head}>
              {["Video", "Audio", "Speed", "Animation", "Adjustment"].map((t) => (
                <div key={t} onClick={() => setInspTab(t)} style={{ ...S.tab, ...(inspTab === t ? S.tabOn : {}), fontSize: 12.5 }}>
                  {t}{inspTab === t && <span style={S.underline} />}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 4, padding: "10px 14px 4px" }}>
              {["Basic", "Cutout", "Mask", "Enhance"].map((t) => (
                <div key={t} onClick={() => setSubTab(t)} className={subTab === t ? "" : "vs-hover"}
                  style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 6, fontSize: 12, cursor: "pointer", background: subTab === t ? "#2B2B2B" : "transparent", color: subTab === t ? C.text : C.muted, fontWeight: subTab === t ? 600 : 500 }}>
                  {t}
                </div>
              ))}
            </div>

            <div style={S.group}>
              <div style={S.groupHead}>
                Transform <Icon name="chevron" size={14} />
                <span style={{ marginLeft: "auto", color: C.faint }}><Icon name="reset" size={14} /></span>
              </div>
              <Row label="Scale">
                <Slider value={scale} onChange={setScale} />
                <Stepper value={Math.round(scale * 2.6)} suffix="%" />
              </Row>
              <Row label="Uniform scale">
                <div style={{ flex: 1 }} />
                <div onClick={() => setUniform((u) => !u)}
                  style={{ width: 34, height: 19, borderRadius: 10, background: uniform ? C.accent : "#3A3A3A", position: "relative", cursor: "pointer", transition: "background .15s" }}>
                  <span style={{ position: "absolute", top: 2, left: uniform ? 17 : 2, width: 15, height: 15, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
                </div>
              </Row>
              <Row label="Position">
                <span style={{ color: C.faint, fontSize: 11.5 }}>X</span><Stepper value={0} />
                <span style={{ color: C.faint, fontSize: 11.5 }}>Y</span><Stepper value={0} />
                <span style={{ color: C.faint }}><Icon name="diamond" size={14} /></span>
              </Row>
              <Row label="Rotate">
                <Stepper value="0.0°" />
                <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", border: "1px solid #4A4A4A" }} />
                </div>
                <span style={{ color: C.faint }}><Icon name="diamond" size={14} /></span>
              </Row>

              {/* Alignment row — present in the reference and initially
                  dropped here. Two trailing items are disabled because
                  distribute needs 3+ selected objects and only one clip is
                  selected in this state. */}
              <div style={{ display: "flex", gap: 2, margin: "2px 0 6px" }}>
                {["M4 4v16M8 8h10M8 16h6", "M12 4v16M7 8h10M9 16h6", "M20 4v16M6 8h10M10 16h6",
                  "M4 4h16M8 8v10M16 8v6", "M4 12h16M8 7v10M16 9v6", "M4 20h16M8 6v10M16 10v6",
                  "M4 4v16M20 4v16M9 12h6", "M4 4h16M4 20h16M12 9v6"].map((d, i) => (
                  <div key={i} className={i >= 6 ? "" : "vs-hover"}
                    style={{ flex: 1, height: 28, display: "grid", placeItems: "center", borderRadius: 5, color: i >= 6 ? "#3E3E3E" : C.muted, cursor: i >= 6 ? "default" : "pointer" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d={d} /></svg>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: 1, background: C.border, margin: "8px 14px" }} />

            <div style={S.group}>
              <div style={S.groupHead}>
                <span onClick={() => setBlendOn((b) => !b)}
                  style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${blendOn ? C.accent : "#4A4A4A"}`, background: blendOn ? C.accent : "transparent", display: "grid", placeItems: "center", cursor: "pointer" }}>
                  {blendOn && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#04222B" strokeWidth="3.5"><path d="M5 12l4 4 10-10" /></svg>}
                </span>
                Blend
                <span style={{ marginLeft: "auto", color: C.faint }}><Icon name="reset" size={14} /></span>
              </div>
              <Row label="Mode">
                <div style={{ flex: 1, height: 28, display: "flex", alignItems: "center", padding: "0 10px", background: "#181818", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }}>
                  Normal <span style={{ marginLeft: "auto", color: C.faint }}><Icon name="chevron" size={13} /></span>
                </div>
              </Row>
              <Row label="Opacity">
                <Slider value={opacity} onChange={setOpacity} />
                <Stepper value={Math.round(opacity)} suffix="%" />
              </Row>
            </div>

            <div style={{ height: 1, background: C.border, margin: "8px 14px" }} />

            <div style={{ ...S.group, paddingBottom: 16 }}>
              <div style={{ ...S.groupHead, marginBottom: 0 }}>
                <span onClick={() => setStabilize((s) => !s)}
                  style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${stabilize ? C.accent : "#4A4A4A"}`, background: stabilize ? C.accent : "transparent", display: "grid", placeItems: "center", cursor: "pointer" }}>
                  {stabilize && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#04222B" strokeWidth="3.5"><path d="M5 12l4 4 10-10" /></svg>}
                </span>
                Stabilize <Icon name="chevron" size={14} />
              </div>
            </div>
          </div>

          {/* Voiceover AI */}
          <div style={{ height: 452, flex: "none", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ padding: "12px 14px 8px", fontSize: 13, fontWeight: 600 }}>Voiceover AI</div>
            <div style={{ display: "flex", gap: 18, padding: "0 14px", borderBottom: `1px solid ${C.border}` }}>
              {["Text to Speech", "Voice Changer", "Speech to Text"].map((t) => (
                <div key={t} onClick={() => setVoTab(t)}
                  style={{ paddingBottom: 9, fontSize: 12.5, position: "relative", cursor: "pointer", color: voTab === t ? C.accent : C.muted, fontWeight: voTab === t ? 600 : 500 }}>
                  {t}{voTab === t && <span style={S.underline} />}
                </div>
              ))}
            </div>
            <div className="vs-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 14px 14px" }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Select Voice</div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: 11, background: "#181818", border: `1px solid ${C.border}`, borderRadius: 10 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", flex: "none", background: "linear-gradient(150deg,#5B7FB5,#33507A)", position: "relative", overflow: "hidden" }}>
                  <span style={{ position: "absolute", left: "50%", top: "22%", width: "38%", height: "38%", borderRadius: "50%", background: "#D8A98B", transform: "translateX(-50%)" }} />
                  <span style={{ position: "absolute", left: "50%", bottom: "-14%", width: "74%", height: "46%", borderRadius: "50% 50% 0 0", background: "#2F3E55", transform: "translateX(-50%)" }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Alex (Natural)</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {["Male", "Young Adult", "English"].map((c) => (
                      <span key={c} style={{ padding: "2px 7px", borderRadius: 5, background: "#262626", fontSize: 10.5, color: C.muted }}>{c}</span>
                    ))}
                  </div>
                </div>
                <div className="vs-hover" style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: "50%", flex: "none", border: `1px solid ${C.borderStrong}`, display: "grid", placeItems: "center", cursor: "pointer" }}>
                  <Icon name="play" size={13} />
                </div>
              </div>

              <div style={{ ...S.groupHead, margin: "18px 0 12px" }}>Voice Settings <Icon name="chevron" size={14} /></div>

              {([["Pitch", pitch, setPitch, (v: number) => Math.round((v - 50) / 5)],
                 ["Speed", speed, setSpeed, (v: number) => (v / 44).toFixed(1)],
                 ["Intensity", intensity, setIntensity, (v: number) => (v / 100).toFixed(1)]] as const).map(([lbl, val, set, fmtv]) => (
                <div key={lbl} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 9 }}>{lbl}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Slider value={val as number} onChange={set as (v: number) => void} />
                    <Stepper value={(fmtv as (v: number) => string | number)(val as number)} />
                  </div>
                </div>
              ))}

              <button style={{ width: "100%", height: 38, borderRadius: 7, border: 0, background: C.accent, color: "#04222B", font: `700 13px ${FONT}`, marginTop: 14, cursor: "pointer" }}>
                Generate Speech
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Pinned top-centre, not bottom — at the bottom it sat on top of the
          music track and hid the thing a reviewer most wants to look at.
          Dismissible so it can be cleared before screenshotting. */}
      {showHint && (
        <div onClick={() => setShowHint(false)} title="Click to dismiss"
          style={{ position: "fixed", left: "50%", top: 62, transform: "translateX(-50%)", background: "rgba(0,0,0,.86)", border: `1px solid ${C.borderStrong}`, padding: "6px 14px", borderRadius: 20, fontSize: 11, color: C.muted, zIndex: 99, cursor: "pointer", backdropFilter: "blur(6px)" }}>
          Design prototype · click the rail, tabs, sliders and timeline · Space plays · not wired to the backend
        </div>
      )}
    </div>
  );
}
