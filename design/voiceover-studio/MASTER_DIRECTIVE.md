# Voiceover Studio — Desktop UI Master Directive

**Status:** PROPOSED. Not yet approved for implementation.
**Scope:** Full visual and structural redesign of the application shell.
**Authority:** This document is the master directive. Where any other
document, comment, or existing implementation disagrees with it, this
document wins — once it is approved.

> **Nothing in this directive has been applied to the codebase.** The
> accompanying `mockup.html` is a static, non-functional visual reference
> built to be reviewed and signed off (or rejected) before a single line of
> application code changes.

---

## 1. Product definition

Voiceover Studio is a premium desktop application combining a professional
voiceover recording studio with a complete non-linear video editor,
comparable to CapCut Desktop, Adobe Premiere Pro, and DaVinci Resolve.

It targets creators who record voiceovers, edit video, animate subtitles,
generate captions, apply effects, and export finished content **without
leaving the application**.

The design language is minimal, modern, and premium.

---

## 2. Global layout

Five primary regions:

```
---------------------------------------------------------------
|                     Top Navigation Bar                        |
---------------------------------------------------------------
| Left Toolbar | Media Browser | Preview | Inspector Panel      |
|              |               |         |                      |
|              |               |         |                      |
|              |               |         |                      |
---------------------------------------------------------------
|                  Timeline & Track Editor                      |
---------------------------------------------------------------
```

**Structural clarification derived from the reference mockup** (this detail
is not obvious from the ASCII diagram and matters for implementation): the
right-hand column is **full height** — it runs from directly beneath the top
navigation bar all the way to the bottom of the window, and is split
vertically into the **Inspector** (upper) and the **Voiceover AI** panel
(lower). The timeline therefore spans only the left and centre regions, not
the full window width.

### Region sizing (from the reference)

| Region | Size |
|---|---|
| Top navigation bar | ~56px tall (44–56px acceptable) |
| Left vertical toolbar | ~76px wide |
| Media browser | ~490px wide, resizable |
| Preview monitor | Flexible — takes remaining width, largest element on screen |
| Right column (Inspector + Voiceover AI) | ~400px wide, resizable |
| Timeline | Bottom third of the application |

---

## 3. Top navigation bar

Left → right:

- Application logo (waveform mark) + wordmark "Voiceover Studio"
- **Menu** dropdown
- Auto-save status with clock icon — e.g. `Auto saved: 10:30:15`
- *(centre)* Current project name — e.g. `New Project`
- *(right)* Layout / workspace preset selector
- **Shortcuts** button
- **Join Pro** button — secondary accent
- **Export** button — **primary accent, must stand out as the most
  prominent control in the bar**
- Window controls: minimise, maximise, close

Undo and Redo appear in the **timeline toolbar** rather than the top bar in
the reference mockup. Both placements were specified; the mockup's placement
is authoritative because it keeps editing controls adjacent to the editing
surface.

---

## 4. Left vertical toolbar

Primary navigation. **Icons with labels beneath**, stacked vertically. The
active section is highlighted with the primary accent (icon, label, and a
subtle tinted background).

Sections, in order:

`Media` · `Audio` · `Text` · `Stickers` · `Effects` · `Transitions` ·
`Filters` · `Adjustment` · `Templates`

The full specification also lists `Voice Recorder`, `Captions`, `Subtitles`,
`Animation`, `AI Tools`, and `Export` as sections. These are **deferred**:
the reference mockup shows nine, and a rail of fifteen becomes a scrolling
list, which defeats the purpose of a fixed rail. Voice Recorder, Captions and
Subtitles are reachable through the Media panel's **Record** tab and the
Voiceover AI panel; Export is in the top bar; Animation and Adjustment are
Inspector tabs. **Any change here needs an explicit decision, not a drift.**

---

## 5. Media browser

Tabs: **Import** · **Record** · **Library**
*(Recent and Collections deferred — see §4 rationale.)*

Below the tabs:
- **Import** button (primary action, pill)
- View mode toggle, sort control, filter control
- Type filter dropdown (`All ▾`) and a search field

### Asset cards

A responsive grid, 3 columns at the reference width. Each card shows:

- Thumbnail — video frame, image, or rendered audio waveform
- Filename
- Duration badge (top-right)
- `Added` badge (top-left) when the asset is already used in the timeline
- Context menu on right-click; multi-select; drag handle

Supported imports: video, audio, images, logos, fonts, motion graphics,
templates, subtitles, folders.

---

## 6. Preview monitor

Centre of the screen and the **largest element**.

Header: `Player` label, panel menu.

Transport row beneath the video:
- Current time (primary accent) and total duration
- Play / pause, frame stepping
- Fit / zoom control, aspect ratio badge (`16:9`), fullscreen

Must support: video preview, motion graphics, animated captions, live text
editing, transform handles, crop overlays, guides, safe margins, selection
boxes, and a preview-quality control.

---

## 7. Inspector panel

Right column, upper. Shows properties for the current selection.

Tabs: **Video** · **Audio** · **Speed** · **Animation** · **Adjustment**
Sub-tabs (Video): **Basic** · **Cutout** · **Mask** · **Enhance**

Each property group has a section header with a **reset** affordance, and
animatable properties carry a **keyframe diamond**.

**Video selection:** Transform (scale, uniform-scale lock, position X/Y,
rotation), alignment row, Blend (mode + opacity), Stabilize, Crop, Mask,
Speed, Motion Blur, Animation, Effects, Colour Correction, Shadow, Corner
Radius, Noise Reduction, Lens Correction.

**Text selection:** Font, weight, size, alignment, letter spacing, line
spacing, stroke, shadow, background, animation, gradient, glow, curved text.

**Audio selection:** Volume, fade, noise removal, compression, EQ, reverb,
limiter, normalise, pitch, speed, silence detection.

---

## 8. Voiceover AI panel

Right column, lower. Dedicated to voice creation.

Tabs: **Text to Speech** · **Voice Changer** · **Speech to Text**
*(Voice Cloning, Voice Library, and AI Enhancement deferred.)*

Text-to-Speech contents:
- **Select Voice** — voice card with avatar, name, and attribute chips
  (gender, age band, language), with an inline preview button
- **Voice Settings** — pitch, speed, intensity/energy, each a slider with a
  numeric stepper
- **Generate Speech** — full-width primary button

Generated audio **lands on the timeline automatically** as a new voiceover
clip. This is a hard requirement, not a convenience: the panel is part of the
editing loop, not a separate tool.

---

## 9. Timeline

Bottom third. Unlimited tracks.

Track types: video, audio, voiceover, music, sound effects, captions,
subtitles, images, shapes, animation, adjustment layers.

### Timeline toolbar

Select tool (with mode dropdown) · Undo · Redo · Split · Trim in/out ·
Delete · Crop · Marker · Text · Warning/flag · Unlink · Keyframe ·
*(right side)* Record, overflow menu.

Also specified and to be placed: Speed, Animation, Zoom, Magnet/snap, Linked
selection, Auto-ripple, Proxy toggle.

### Clips

Rounded rectangles. Hover reveals trim handles. The selected clip carries a
**primary-accent border and a soft glow**.

Per-clip operations: trim, split, ripple delete, slip, slide, crop, move,
copy, paste, duplicate, group, lock, mute, hide, rename, nested sequences,
colour labels, waveforms, snap, markers, transitions, keyframes.

### Track controls

Per track: mute, solo, lock, hide, rename, volume, expand/collapse, track
height, colour.

---

## 10. Voiceover workflow

The application must support this end-to-end without leaving it:

1. Import video → 2. Record or generate speech → 3. Voice clip lands on the
timeline → 4. AI generates captions → 5. Edit captions → 6. Apply subtitle
animations → 7. Transitions → 8. Effects → 9. Preview → 10. Export.

---

## 11. Design language

Inspired by CapCut Desktop, DaVinci Resolve, Adobe Premiere Pro, Final Cut
Pro, Linear, Raycast, and Apple Pro Apps.

**Modern, not futuristic.** Avoid excessive glassmorphism. Avoid excessive
gradients. Prioritise clarity. Generous spacing. Subtle borders. Soft
elevation. 8–12px corner radius. No visual clutter.

### Colour palette

| Token | Value |
|---|---|
| Background | `#111111` |
| Secondary surface | `#1A1A1A` |
| Panels | `#202020` |
| Borders | `rgba(255,255,255,0.06)` |
| Primary accent | `#00D2FF` |
| Secondary accent | `#7A5CFF` |
| Success | `#38D39F` |
| Warning | `#F7B731` |
| Error | `#FF5C5C` |

### Typography

Inter, then SF Pro Display. Medium weights. Large readable labels.
Consistent spacing.

---

## 12. Interaction

Hover animations at 60fps. Smooth transitions. Drag-and-drop everywhere.
Keyboard shortcuts throughout. Right-click context menus. Dockable,
resizable, collapsible panels. Persistent workspace layouts.

---

## 13. Experience goals

The application must feel like a professional creative suite, not a simple
video editor. A new user should immediately understand where to import
media, preview edits, adjust properties, and work on the timeline. It should
combine the approachability of CapCut Desktop with the depth of professional
editing software.

---

## 14. Open questions for sign-off

These need a decision before implementation, and are listed rather than
silently resolved:

1. **Deferred toolbar sections** (§4) — accept nine rail items, or design a
   scrolling/grouped rail for all fifteen?
2. **Undo/redo placement** — timeline toolbar only (per mockup), or
   duplicated in the top bar (per prose spec)?
3. **Deferred Media tabs** — are Recent and Collections needed for v1?
4. **Deferred Voiceover tabs** — Voice Cloning, Voice Library, and AI
   Enhancement: v1 or later?
5. **Migration scope** — this is a full shell redesign. The existing
   application has a working feature set behind the current shell (Motion
   Studio: masks, blend modes, colour grade, motion blur, speed ramps,
   transitions, subtitles/auto-captions, audio ducking, graph editor,
   export presets). **Does this redesign re-house those features, or
   replace them?** That answer changes the effort by an order of magnitude
   and must be settled before any code is written.
6. **"Join Pro"** implies a paid tier. Is that real, and is there billing
   behind it, or is it visual only?
