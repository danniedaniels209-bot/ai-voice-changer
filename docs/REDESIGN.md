# Studio Redesign — UX Architecture & Design System

Premium desktop-class redesign of the AI voice production studio.
**Zero functionality changes** — every feature we have keeps working exactly as it does;
this document only reorganizes where things live and how they look, feel, and move.

Implementation target: React + TypeScript + Tailwind CSS + Framer Motion + Lucide icons.

---

## 1. Design tokens

### 1.1 Color (dark-first; CSS variables on `:root`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B0D10` | App background |
| `--surface` | `#13161B` | Cards, panels, sidebar |
| `--elevated` | `#1B1F26` | Popovers, dialogs, hover states, inputs |
| `--border` | `rgba(255,255,255,.08)` | All hairlines |
| `--border-strong` | `rgba(255,255,255,.14)` | Focused/active outlines |
| `--primary` | `#4F8CFF` | Actions, links, active nav, progress |
| `--primary-hover` | `#6EA1FF` | Hover on primary |
| `--primary-dim` | `rgba(79,140,255,.12)` | Selected backgrounds, badges |
| `--success` | `#3CCF91` | Completed, verified, cached |
| `--warning` | `#FFB547` | GPU-needed, size caps, degraded |
| `--danger` | `#FF5F6D` | Failed, destructive |
| `--text` | `#F5F7FA` | Primary text |
| `--text-muted` | `#8A93A3` | Secondary text, labels |
| `--text-faint` | `rgba(138,147,163,.55)` | Placeholders, disabled |

Rules: no gradients except a single radial "glow" allowed behind the dashboard hero
(`radial-gradient(600px at 20% 0%, rgba(79,140,255,.07), transparent)`). No neon. Success/warning/
danger are used at 100% only for icons/text; backgrounds always use the `/12` alpha version.

### 1.2 Spacing scale

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 80` px (`space-1 … space-10`).
Cards pad 20–24. Sections separate by 32. Page gutters 32 (desktop), 16 (narrow).

### 1.3 Radius scale

| Token | px | Use |
|---|---|---|
| `r-sm` | 8 | Chips, badges, inputs inside dense rows |
| `r-md` | 12 | Buttons, inputs, list rows |
| `r-lg` | 16 | Cards, panels |
| `r-xl` | 18 | Dialogs, floating palette, video preview |
| `r-full` | 999 | Pills, avatars, toggles |

### 1.4 Elevation

| Level | Shadow | Use |
|---|---|---|
| 0 | none, border only | Cards at rest |
| 1 | `0 4px 16px rgba(0,0,0,.35)` | Hovered cards, dropdowns |
| 2 | `0 12px 40px rgba(0,0,0,.5)` | Dialogs, command palette |
| glass | `backdrop-blur(16px)` + `rgba(19,22,27,.8)` | Command palette, toasts, status bar only |

### 1.5 Motion (Framer Motion)

| Token | Value | Use |
|---|---|---|
| `dur-fast` | 120ms | Hover, press, toggle |
| `dur-base` | 200ms | Card/panel enter, tab underline |
| `dur-slow` | 320ms | Page transitions, dialog |
| `spring-ui` | `{ type:"spring", stiffness:420, damping:34 }` | Layout shifts, palette, dock |
| `spring-soft` | `{ stiffness:260, damping:28 }` | Cards morphing, progress |

Rules: pages crossfade + 8px rise (`opacity 0→1, y 8→0`, dur-slow). Lists stagger children 30ms.
Progress bars animate width with spring-soft, never jump. Skeletons shimmer at 1.4s. Nothing
instantly appears except text the user types. Respect `prefers-reduced-motion`: swap all motion
for 80ms fades.

### 1.6 Typography — Inter (fallback ui-sans-serif)

| Style | Size/weight | Use |
|---|---|---|
| `display` | 28/700, -0.5 tracking | Page titles |
| `title` | 20/600 | Card/section titles |
| `body` | 15/450 | Default |
| `label` | 13/550, uppercase 0.4 tracking, muted | Section labels, form labels |
| `mono` | 13 JetBrains Mono | Job ids, timestamps, logs |

Minimum text size anywhere: 13px. Line-height 1.5 body, 1.2 headings.

### 1.7 Grid & app shell

```
┌──────────────────────────────────────────────────────────────┐
│  Top command bar (48px, fixed)                               │
├──────────┬────────────────────────────────────┬──────────────┤
│ Sidebar  │  Content area                      │  Inspector   │
│ 232px    │  (scrolls; max-w 1200 centered     │  320px       │
│ collaps- │   on document-style pages, full-   │  (contextual,│
│ ible to  │   bleed on editor pages)           │  collapsible)│
│ 64px     │                                    │              │
├──────────┴────────────────────────────────────┴──────────────┤
│  Status bar (28px, fixed, glass)                             │
└──────────────────────────────────────────────────────────────┘
```

- Sidebar collapse animates width with `spring-ui`; icons remain, labels fade.
- Inspector exists only on screens that need it (Processing, Segment Editor, Chat, Studio).
- Panels resizable via 4px grab handles (`cursor-col-resize`, highlight `--primary` on drag).
- Below 1100px: inspector becomes an overlay sheet. Below 900px: sidebar defaults collapsed.

---

## 2. Information architecture & navigation

### 2.1 Sidebar (primary nav — five groups)

```
◆ Studio                     ← wordmark; click = Dashboard
─────────────
▸ CREATE
   ⊕  New Conversion         (Home upload flow, primary CTA styling)
   ✎  Script Studio
   ✦  AI Chat
▸ LIBRARY
   ▶  Jobs                   (badge: active count, animated pulse when processing)
   ♪  Voices
   ▣  Models
▸ SYSTEM
   ⇅  Cloud GPU
   ⚙  Settings
```

Lucide icons: `plus-circle, pen-line, sparkles, list-video, audio-lines, box, cloud, settings`.
Active item: `--primary-dim` background + 2px left `--primary` rail (shared-layout animated).
Bottom of sidebar: collapse chevron + hardware pill (`GPU · T4` green dot, or `CPU` muted).

### 2.2 Top command bar

Left: breadcrumb (`Jobs / interview.mp4 / Segments`), truncating middle segments.
Center: **search / command field** — a 320px ghost input reading `⌘K  Search or run a command`.
Right: cloud connection chip (`● Cloud GPU` green/amber/off), notifications bell, avatar-less.

### 2.3 Command palette (⌘K / Ctrl+K)

Floating glass panel (`r-xl`, elevation 2, 560px wide, top-15vh), spring-ui scale 0.98→1.
Sections: **Actions** (New conversion, Generate script, Open chat, Re-export last job),
**Navigation** (all screens), **Jobs** (fuzzy over recent job filenames), **Voices** (jump/preview).
Arrow keys + Enter; Esc closes. Every palette row shows its keyboard shortcut on the right.

### 2.4 Global keyboard shortcuts

| Keys | Action |
|---|---|
| `⌘K` | Command palette |
| `⌘N` | New conversion |
| `⌘1…7` | Sidebar destinations in order |
| `⌘\` | Toggle sidebar |
| `⌘.` | Toggle inspector |
| `Space` | Play/pause (any screen with media) |
| `⌘Enter` | Primary action of current screen (Convert / Send / Re-export) |
| `?` | Shortcut overlay (glass sheet listing everything) |

### 2.5 Feature placement review (what moves where)

| Feature today | New home | Why |
|---|---|---|
| Home mega-form (mode, voices, chain, continuity, precision, dub, compress) | **New Conversion** 3-step flow (§4) | One giant form → progressive steps; defaults hidden behind "Advanced" |
| "Use Qwen"/"Studio" header buttons | Sidebar CREATE group | Nav belongs in nav |
| Segment editor buried under Processing page | Own tab inside Job workspace (§6) | It's an editor, not a footnote |
| Dub language dropdown in tts block | Step 2 "Language" card of New Conversion + visible in Job summary | Translation is a first-class decision |
| Compress toggle under dropzone | Export options step + Export Center dialog | It's an export concern |
| Cloud GPU URL/token inside Settings | Own **Cloud GPU** screen | Deserves status, session help, not a settings field |
| Job logs textarea | Collapsible **Logs** drawer in Job workspace + full view from status bar | Debug data, off the happy path |
| Hardware status in Settings | Status bar + Cloud GPU screen | Ambient, always visible |
| Custom voice upload in Home voice picker | **Voices** screen ("Train" card) | Library owns assets |
| Script Studio's narration renderer | Stays; gains "Send to New Conversion" handoff button | Bridge the two flows |
| Settings flat list of 18 toggles | Categorized (§11) | Never overwhelm |

---

## 3. Screens

Every screen below lists: purpose → layout → key components → states → motion → shortcuts.
ASCII wireframes are desktop (≥1280px).

### 3.1 Splash (app boot / backend connecting)

Purpose: cover the 1–3s backend health check; set tone.
Full-bleed `--bg`, centered wordmark ◆ scaling 0.9→1 with spring-soft, beneath it a 2px
indeterminate shimmer line (240px). Below: rotating muted status ("Starting engine…",
"Checking ffmpeg…", "Connecting to backend…") crossfading every 800ms — driven by real
`/health` fields, not fake. Error state: card slides up — "Backend not reachable" + `Retry`
primary button + `View logs` ghost. Never traps: after 8s always shows the error card.

### 3.2 Home Dashboard

Purpose: land, see state of everything, jump back into work.

```
┌ Good evening ────────────────────────────── [⊕ New Conversion] ┐
│                                                                │
│ ┌ ACTIVE NOW ──────────────────────────────────────────────┐   │
│ │ ▶ interview.mp4   Re-voice · Chatterbox     ▓▓▓▓░░ 64%   │   │
│ │   Synthesizing narration…                   [Open]        │   │
│ └──────────────────────────────────────────────────────────┘   │
│ ┌ Recent jobs ─────────────┐ ┌ System ────────────────────┐    │
│ │ ✓ demo.mp4     2h ago    │ │ GPU   ● T4 (cloud)         │    │
│ │ ✓ intro.mp4    1d ago    │ │ Models Whisper·Demucs·Qwen │    │
│ │ ✗ clip.mp4     2d ago    │ │ Storage exports 1.2 GB     │    │
│ │            [All jobs →]  │ │ Backend ● local  ● cloud   │    │
│ └──────────────────────────┘ └────────────────────────────┘    │
│ ┌ Quick actions ───────────────────────────────────────────┐   │
│ │ [✎ Write a script] [✦ Ask AI] [♪ Voices] [⇅ Cloud GPU]  │   │
│ └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

- ACTIVE NOW card only renders when a job is processing; it morphs (shared layout id) into
  the Job workspace header when clicked. Progress bar springs; stage text crossfades.
- Recent jobs: rows with status icon (`check-circle` success, `x-circle` danger, `loader`
  spinning), filename, mode chip, relative time. Hover: elevation 1 + `Open` affordance.
- System card values are live (`/health`, exports dir size). GPU dot: green cuda, amber
  cloud-only, muted cpu.
- Empty state (no jobs ever): centered illustration-free card — "Drop a video to get started",
  full-card dropzone, muted secondary line listing modes. First-run only.
- Loading: 3 skeleton cards shimmering, staggered.

### 3.3 New Conversion (replaces Home form) — 3 steps, one screen

Purpose: the Import → configure → convert journey without a wall of controls.
Layout: centered 760px column, step cards expand/collapse accordion-style (only one open;
completed steps collapse to a summary row with ✓ and an `Edit` ghost button).

**Step 1 · Media** — large dropzone card (`r-lg`, dashed border, hover lifts + border
`--primary`). Multi-file chips appear under with per-file size + ✕. Drag-over: whole card
glows `--primary-dim`, icon `upload-cloud` bounces once (spring).

**Step 2 · Voice** — 2×2 mode cards (Re-voice / Narrate script / Voice model / Expressive),
selected card shows `--primary` border + check. Below, contextual controls for the picked mode:
voice select with inline ▶ preview buttons, engine segmented control (Fast cloud / Human-like
local), script textarea for narrate-mode, RVC model picker + pitch block for rvc.
**Language row**: "Keep original language" pill vs language grid (10 flags-free chips: Spanish,
French…), when picked shows its 2-voice select. **Advanced disclosure** (chevron accordion):
Natural continuity sliders, Precision word placement toggle, Merge-modes chain, skip separation.

**Step 3 · Export** — quality preset segmented (Low/Medium/High/Lossless), toggles: subtitles,
burn captions, vertical variant, music ducking, loudness, **Compress file size**; estimated
output note ("video stream-copied — original quality" vs "re-encode CRF 26").

Footer (sticky within column): big primary **Convert** (⌘Enter) with per-file count
("Convert 3 videos"), disabled with reason tooltip until valid. On submit the button morphs
into a progress pill then routes to the Job workspace.

Error states: per-field inline (red border + 13px danger text under control). Upload failure:
toast + file chip turns danger with retry icon.

### 3.4 Jobs (queue)

Purpose: every conversion, filterable, scannable.
Full-width table-like list (rows are cards `r-md`, 64px tall, gap 8):
status icon · filename (title) + mode/voice muted line · progress bar (only when processing) ·
duration chip · relative time · overflow menu (`ellipsis`: Open, Re-export, Reveal export,
Cancel/Delete-temp).
Top row: filter segmented control (All / Active / Done / Failed) + search field.
Rows stagger in; a finishing job's bar fills, pauses 300ms, then the row's icon crossfades
to ✓ with a small scale pop. Failed rows tint danger at 6% background.
Empty: "No jobs yet — start your first conversion" + primary CTA.
Shortcuts: `↑↓` select, `Enter` open, `⌫` delete-temp (confirm dialog).

### 3.5 Job workspace (Processing) — hub with tabs

Purpose: one home per job: watch it run, review result, edit narration, export variants.
Header: back chevron, filename (display type), status badge, mode+voice chips; right:
**Export Center** button + overflow.
Tabs (animated underline, shared layout): **Overview · Segments · Transcript · Logs**.

**Overview tab**
```
┌───────────────────────────────┬ Inspector ──────────────┐
│  ┌ Video preview (r-xl) ────┐ │ Request                 │
│  │        ▶                 │ │  Mode  Re-voice         │
│  └──────────────────────────┘ │  Voice Guy (edge)       │
│  Stage rail:                  │  Dubbed Spanish         │
│  ● Uploaded ─ ● Separated ─   │  Precision on           │
│  ◐ Synthesizing ─ ○ Mix ─ ○   │ Output                  │
│  ▓▓▓▓▓▓░░░░ 64% smooth        │  quality High           │
│                               │  subtitles .srt ✓       │
│                               │ [Open export folder]    │
└───────────────────────────────┴─────────────────────────┘
```
Stage rail nodes fill sequentially (spring), current node pulses. While processing the
preview area shows a live log ticker line (last log message, crossfade) instead of video.
Failure: rail node turns danger, card below shows error message + "Retry conversion".

**Segments tab** → §6 Segment Editor (DAW view).
**Transcript tab** — read-focused: the same segment data as flowing paragraphs with
timestamps in the gutter (mono, muted, click = seek). Inline edit on double-click routes to
the same recipe-edit call the Segment Editor uses (same feature, reading-first surface).
**Logs tab** — mono 13px, virtualized, auto-follow toggle, copy button, stage markers as
sticky separators.

### 3.6 Segment Editor (the DAW screen)

Purpose: per-line narration editing with instant audition and cheap re-export.

```
┌ Toolbar: [▶ Play] 00:41 / 03:12   voice chip · engine chip   [Re-export ⌘Enter] ┐
├──────────────────────────────────────────────────────────────┬ Inspector ───────┤
│ ┌ Video preview (sticky, 16:9, r-lg) ────────────────────┐   │ Segment 7        │
│ └────────────────────────────────────────────────────────┘   │ 00:41.2 – 00:44.8│
│ ┌ Timeline strip (fixed height 72px) ────────────────────┐   │ ▁▃▅▇▅▃▁ waveform │
│ │ |▁▂▄▆▄▂▁__|▃▅▆▅▃|____|▂▄▅▄▂|  … playhead ┃ scrubbable │   │ seed  #2  [↻]    │
│ │  blocks = segments, colored by state:                  │   │ cache ● rendered │
│ │  ● cached (success/12)  ◐ edited (primary/12)  ○ new   │   │ fit: strict ✓    │
│ └────────────────────────────────────────────────────────┘   │ [▶ Preview line] │
│ ┌ Line list (scrolls, virtualized) ──────────────────────┐   │ [Ask AI to       │
│ │ 00:03  Welcome back to the channel…        ● [▶][↻][✎] │   │  rewrite ▾]      │
│ │ 00:07  Today we're testing the new…        ● [▶][↻][✎] │   │  · punchier      │
│ │ 00:12  ▌editing inline — textarea grows    ◐ [▶][↻][✎] │   │  · simpler       │
│ │ …                                                      │   │  · fix grammar   │
│ └────────────────────────────────────────────────────────┘   │                  │
└──────────────────────────────────────────────────────────────┴──────────────────┘
```

- **Timeline strip**: one block per segment, width ∝ duration, tiny waveform thumb inside
  (drawn once from the rendered wav, cached as dataURL). Click block = seek video + scroll
  list to line (smooth). Playhead is a 1px `--primary` line with 8px glow; scrub by drag.
- **Line rows**: timestamp (mono, click=seek), text (inline edit on click — row expands with
  spring, textarea autofocus), state dot (● success = rendered & cached, ◐ primary = edited
  pending re-export, spinning loader = previewing), actions on hover: ▶ preview (plays just
  this line via `synthesize_single`), ↻ new take (bumps seed; dot pulses), ✎ focus edit.
- **Cache indicator**: rows show "cached" dot; after edits, footer bar appears (glass,
  bottom-sticky): "3 lines changed — re-export re-renders only those" + **Apply & re-export**.
- **AI suggestions** (inspector): action chips (punchier / simpler / fix grammar / translate
  tone) — these call the existing assist actions with the line text and drop the result into
  the edit field (user confirms). Marked clearly as replacing text, undoable (local undo
  stack per line, ⌘Z).
- Keyboard: `↑↓` move line, `Enter` edit, `Esc` cancel, `P` preview line, `R` new take,
  `Space` play/pause video, `⌘Enter` re-export.
- Loading: line list skeleton rows (10, staggered). Not-editable state (recipe missing):
  centered card explaining why + "Re-run conversion with Segment editor on" link to Settings.
- Preview error: row action turns danger with tooltip (engine error text).

### 3.7 Translation Studio (view, not new machinery)

Purpose: make dubbing visible and comparable — a lens over a dubbed job.
Lives as a banner/toggle inside Segments & Transcript tabs when the job has `Dubbed into`:
split columns **Original ⇄ Dubbed** line-by-line (original muted, dubbed editable — edits go
to the same recipe). Language chip + voice chip in the toolbar. Non-dubbed jobs: the tab
control simply doesn't render. Entry point for *new* dubs stays in New Conversion Step 2.

### 3.8 AI Script Studio (Notion-AI feel)

```
┌ Toolbar: title field (borderless, display type)   [⌘Enter Narrate] [Send to Conversion] ┐
├ Outline (220px) ─────┬ Editor (fluid, max-w 720 centered) ──────┬ Inspector ────────────┤
│ 1 Hook               │  # Hook                                  │ AI ASSISTANT          │
│ 2 Problem            │  Ever wondered why…                      │ topic [________]      │
│ 3 Demo               │  (typewriter-style AI insert with        │ [Generate outline]    │
│ 4 CTA                │   block highlight fading out)            │ tone/length/audience  │
│ [+ section]          │                                          │ ──────────            │
│                      │                                          │ ACTIONS (chips grid)  │
│                      │                                          │ rewrite · expand ·    │
│                      │                                          │ titles · chapters …   │
│                      │                                          │ REFERENCE OUTPUT      │
│                      │                                          │ (titles/desc results  │
│                      │                                          │  as copyable cards)   │
└──────────────────────┴──────────────────────────────────────────┴───────────────────────┘
```
- Outline drives scroll-spy; click scrolls editor; generated outline items stream in staggered.
- AI actions operate on selection (floating mini-toolbar on select: ✦ Rewrite ▾) or whole doc.
- Reference outputs (titles/description/chapters/thumbnails/keywords) render as stacked cards
  with copy buttons — never overwrite the script.
- Version history: every AI replacement pushes a local snapshot; clock icon opens a right-side
  list ("Before rewrite · 2m ago") with restore. (Local state only — no backend change.)
- Narration controls (voices, sliders, per-block preview) live in a bottom drawer that slides
  up (spring) when "Narrate" is pressed — keeps writing distraction-free.
- GPU-gated empty state: dimmed assistant panel with lock icon + "Needs a GPU session —
  connect Cloud GPU" link. Editor still fully usable manually.

### 3.9 AI Chat (Claude-Desktop feel)

```
┌ Chat ────────────────────────────────────────────┬ Context ────────────┐
│  ◆ Qwen 2.5 · ● ready on T4        [新 New chat] │ MODEL               │
│ ┌──────────────────────────────────────────────┐ │ Qwen2.5-3B          │
│ │            user bubble (right, primary)      │ │ ● loaded · cloud    │
│ │ ┌ tool timeline card ────────────────┐       │ │ GPU T4 · 6GB        │
│ │ │ ⚙ get_transcript(job 4f2a)  ✓ 0.8s │       │ │ ─────────────       │
│ │ │ ⚙ edit_segment(#3)          ✓      │       │ │ TOOLS               │
│ │ └────────────────────────────────────┘       │ │ list_jobs           │
│ │ assistant bubble (left, surface, markdown)   │ │ get_transcript      │
│ │ ┌ reference card: edited segment diff ─┐     │ │ edit_segment        │
│ │ │ was → now  [Open job]                │     │ │ list_voices         │
│ └──────────────────────────────────────────────┘ │                     │
│  suggested prompts (empty state, 4 ghost cards)  │                     │
│ ┌ composer (glass, r-lg) ──────────── [Send ⌘⏎]┐ │                     │
│ │ action chips row scrolls: Rewrite · Titles … │ │                     │
│ └──────────────────────────────────────────────┘ │                     │
└──────────────────────────────────────────────────┴─────────────────────┘
```
- Tool usage renders as a collapsed timeline card between bubbles (each call: icon, name,
  args summary, ✓/✗, expandable to see the result text). Spinner row while a round runs.
- "Reasoning cards": when the model's reply contains a tool result it acted on, the acted-on
  data shows as a quoted reference card above the answer (e.g. segment before/after with an
  `Open job` deep link).
- Composer: textarea grows to 6 lines; Enter sends, Shift+Enter newline; chips insert starter
  prompts. Streaming not available (sync endpoint) → assistant bubble appears with a 3-dot
  typing shimmer until the response lands, then text fades in.
- Model status header + GPU pill are live from `/scriptgen/status`. Unavailable: composer
  disabled with inline reason + `Connect Cloud GPU` button.
- Errors: failed send keeps the user bubble, shows retry link under it (input restored).

### 3.10 Voice Library

Purpose: browse/preview/manage every voice in one place.
Header: search field + filter chips (All · Cloud · Human-like · Custom · Dub languages ▾).
Grid of voice cards (240px, `r-lg`):
```
┌ ♪ Guy ────────────────┐
│ Classic ad narrator   │
│ male · US English     │
│ [▶ Preview]  [Use →]  │
└───────────────────────┘
```
- ▶ plays a canned sample line via the existing preview synthesis; button morphs to ⏸ with a
  thin circular progress ring.
- `Use →` opens New Conversion with the voice pre-selected.
- **Custom voices section** ("Your voices"): upload card (dashed, "Train a voice — drop a
  10-30s clean sample"), name field, then the trained card gains a `custom` badge and Delete
  in its overflow. Deleting confirms via dialog.
- Dub voices group by language accordion.
- Empty custom state: friendly explainer of what makes a good sample.

### 3.11 Voice Training (flow, inside Voice Library)

The upload card expands in place (morph) to a 2-step mini-flow: 1) drop sample → waveform
preview + duration check (warn <5s), name input; 2) confirmation card with "cloning happens
locally on first use" note. Progress: indeterminate bar during upload; success pops the new
card into the grid (layout animation).

### 3.12 Export Center (dialog, invoked from Job workspace / Jobs rows)

Glass dialog (`r-xl`, elevation 2, 520px):
- Quality preset segmented control with per-option caption (CRF/bitrate).
- Toggle list: subtitles (.srt) / burn captions / animated captions / vertical 9:16 /
  music ducking / loudness normalize / **compress file size**.
- Live summary line: "Video: stream-copy (original quality) · Audio: AAC 256k" — switches to
  amber "Video: re-encode CRF 26" when compress/burn on.
- Estimated size chip (source size × heuristic; labeled "estimate").
- GPU/queue note when a conversion is running ("starts after current job").
- Footer: ghost Cancel · primary **Export**. Export history list (last 5 outputs with reveal
  buttons) collapsed at the bottom.
- These map to existing settings + re-export; the dialog writes the settings then triggers
  the run — no new backend.

### 3.13 Cloud GPU Manager

Purpose: the Colab session ritual, first-class.
- **Status hero card**: big dot + "Connected to Tesla T4" / "Not connected", URL field,
  token field (masked, reveal eye), Test connection button (spinner → ✓/✗ with latency).
- **Session guide card**: the 3-step routine (open notebook → run cell → paste link) as a
  numbered list with copy-paste blocks; deep link to the notebook.
- **Capabilities table**: what unlocks on GPU (Whisper large-v3, htdemucs_ft, Qwen chat/
  script/dub) with lock/check icons per current status.
- Warning banner (amber) if backend responds but GPU absent.

### 3.14 Settings (§11 layout)

Two-pane: left category rail (like Linear), right content max-w 640. Each row: label +
13px muted description + control (toggle/select/path field). Search field on top filters
rows live. Reset-to-default ghost per section.

### 3.15 Logs (global) & 3.16 Diagnostics

- **Logs**: reachable from status bar clock icon — full-screen mono viewer of the backend
  session log (existing `logs/`), filter field, level chips, auto-follow, copy/export.
- **Diagnostics**: card grid over `/health`: ffmpeg found (path), CUDA/torch versions,
  resolved device, paths (temp/exports with open buttons), model presence checks. Each card
  ✓/✗ with a fix-hint line. `Copy report` button (markdown to clipboard) for support.
- Both are read-only views of data we already expose.

### 3.17 Status bar (28px, glass)

Left: backend dot + mode (`local` / `cloud`), current job ticker ("Synthesizing… 64%",
click → job). Right: GPU pill, exports-folder shortcut, logs icon, version. All 13px mono.

---

## 4. The golden workflow (what the design optimizes)

Import (drop anywhere on Dashboard/New Conversion) → Step cards (media✓ → voice/language →
export) → Convert (⌘Enter) → Job workspace Overview (stage rail live) → done: preview plays,
Segments tab badge suggests "review 12 lines" → tweak lines / AI rewrite / new takes →
footer "Apply & re-export (only 3 lines re-render)" → Export Center for variants (vertical,
compressed) → status bar + toast confirm, `Reveal file`.
Every arrow is one click or one shortcut; nothing requires visiting Settings mid-flow.

---

## 5. Component library (states: default / hover / pressed / focus / disabled / loading / success / error)

- **Button** — primary (filled `--primary`, hover `--primary-hover` + lift 1px, pressed
  scale .98, loading = spinner replaces label keeping width, success = ✓ morph 800ms);
  secondary (surface + border); ghost (text only, hover `--elevated`); danger (danger/12 bg,
  danger text). Focus: 2px `--primary` ring offset 2. Disabled: 40% opacity, no pointer.
- **Input / Textarea / Select** — `--elevated` bg, border → `--border-strong` hover →
  `--primary` focus ring; error = danger border + message; disabled dims; inline valid ✓.
- **Toggle** — 36×20 pill, knob springs; on = `--primary`; disabled 40%.
- **Slider** — 2px track, 14px knob, value bubble on drag (glass), filled left `--primary`.
- **Segmented control** — `--surface` container, active pill `--elevated` slides (layoutId).
- **Card** — `r-lg`, surface, border; hover elevation 1 + border-strong (interactive only).
- **Dialog** — center, elevation 2, scale .96→1 spring, scrim `rgba(0,0,0,.6)` fade; Esc/
  scrim closes; destructive dialogs put danger button right, focus-trapped.
- **Toast** — bottom-right glass stack, slide-in x:16→0, auto-dismiss 5s pause-on-hover,
  variants info/success/warning/danger with icon; action link optional ("Reveal file").
- **Badge/Chip** — `r-full`, 13px, tone/12 backgrounds; interactive chips get hover border.
- **Progress bar** — 4px, `r-full`, animated width spring-soft; indeterminate shimmer.
- **Skeleton** — `--elevated` blocks, 1.4s shimmer, match final layout exactly.
- **Table/List row** — 44px min, hover `--elevated`, selected `--primary-dim` + rail.
- **Tabs** — text + 2px underline sliding (layoutId); count badges.
- **Accordion** — chevron rotates 90°, height auto-animates.
- **Tooltip** — glass, 13px, 300ms delay, arrowless, 8px offset.
- **Context menu** — right-click on job rows/segment lines/voice cards; elevated panel,
  same rows as overflow menus; danger items separated.
- **Command palette / Dropdown** — §2.3 styling; dropdowns are its little sibling.
- **Waveform** — 2px bars, muted; played portion `--primary`; drawn to canvas, container `r-sm`.
- **Timeline block** — per §3.6 states (cached/edited/pending) with 12%-alpha fills.
- **Chat bubble** — user: primary bg white text `r-lg` (tail-less); assistant: surface +
  border; max-w 85%; markdown styles inside (code = elevated block, mono).
- **Tool card** — mono name + args, status icon, expandable; border-left 2px `--primary`.
- **Model badge / GPU pill** — dot + label, 13px mono, tone by status.
- **Job card / Queue item / Voice card** — as specced in their screens; all share the same
  hover/selection grammar.

---

## 6. Micro-UX rules

- **Empty states**: one icon (muted, 32px), one sentence of what this area is, one primary
  action. Never a blank panel.
- **Loading**: skeletons for structure, spinners only inside buttons; anything >400ms shows
  progress or shimmer; anything >5s shows a real status line from logs.
- **Hover**: elevation +1 and border-strong on interactive surfaces only; row actions appear
  on hover but remain reachable by keyboard focus.
- **Drag & drop**: files accepted anywhere on Dashboard/New Conversion; a full-viewport glass
  veil "Drop to start a conversion" appears on dragenter.
- **Right-click**: everywhere a list row exists (jobs, segments, voices) mirroring its
  overflow menu.
- **Tooltips**: every icon-only button; every disabled control explains why.
- **Notifications**: toasts for completions/failures even when the user is on another screen;
  clicking routes to the job.
- **Destructive actions**: always a dialog naming the thing ("Delete voice 'Danny'?"),
  danger button, never default-focused.
- **Attention order** (first/second/third): Dashboard → active job / New CTA / recents.
  New Conversion → dropzone / step 2 cards / advanced. Job → preview+rail / tabs / inspector.
  Segment Editor → line list / timeline / inspector. Chat → composer / last reply / context.

---

## 7. Implementation notes (no functional change)

- Pure frontend re-skin over the existing API; state via existing api/*.ts clients.
- New shell = `Layout.tsx` rewrite (sidebar/topbar/statusbar/inspector slots via context).
- Framer Motion + lucide-react + @radix-ui primitives (dialog/dropdown/tooltip) are the only
  new deps; Tailwind config gains the token scales above.
- Screens map 1:1 onto existing routes; new routes (`/new`, `/cloud`, `/diagnostics`) are
  views over existing endpoints only.
- Ship order (each independently commit-able): tokens+shell → Dashboard+Jobs → New
  Conversion → Job workspace+Segment Editor → Chat → Studio → Voices → Settings/Cloud/
  Diagnostics → command palette + polish pass.
