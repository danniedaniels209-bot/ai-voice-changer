/**
 * Mockup & UI component factory library.
 *
 * Each factory composes existing rect/ellipse/text/image layers (the four
 * primitive layer types in types/motion.ts) into a group shaped like a common
 * UI device or widget — phone, laptop, browser window, etc. This mirrors
 * layerFactory.ts's createLayer() but returns MotionLayer[] (a group) that's
 * ready to append to a scene's layers array, rather than a single layer.
 *
 * Conventions (kept consistent with layerFactory.ts):
 *  - IDs come from newId() in ./state so they're unique per call.
 *  - All coordinates are absolute (relative to the scene's top-left), with the
 *    group anchored at the (x, y) the caller passes. Child layers are offset
 *    from that anchor so the whole group moves together when the caller shifts
 *    (x, y).
 *  - keyframes start empty; an animator adds them later.
 *  - Colors use the same default palette as layerFactory.ts (#4F46E5 indigo,
 *    #059669 emerald, #FFFFFF, plus neutral grays) so mockups share the
 *    editor's visual language.
 *
 * The factories don't read or mutate any shared state — they're pure
 * functions producing new layer objects. Safe to call from anywhere.
 */

import type { MotionLayer } from "../../types/motion";
import { newId } from "../state";

// ---------------------------------------------------------------------------
// Local helpers — keep the exports below clean. Each one builds a single
// primitive layer at an absolute position; the mockup factories compose them.
// ---------------------------------------------------------------------------

interface BaseOpts {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
}

function rectLayer(
  opts: BaseOpts & {
    fill: string;
    corner_radius?: number;
    stroke_color?: string;
    stroke_width?: number;
  }
): MotionLayer {
  return {
    id: newId(),
    name: opts.name,
    type: "rect",
    transform: {
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      rotation: opts.rotation ?? 0,
      opacity: opts.opacity ?? 1,
    },
    locked: false,
    hidden: false,
    rect: {
      fill: opts.fill,
      corner_radius: opts.corner_radius ?? 0,
      stroke_color: opts.stroke_color ?? "#000000",
      stroke_width: opts.stroke_width ?? 0,
    },
    ellipse: null,
    text: null,
    image: null,
    video: null,
    keyframes: [],
  };
}

function ellipseLayer(
  opts: BaseOpts & {
    fill: string;
    stroke_color?: string;
    stroke_width?: number;
  }
): MotionLayer {
  return {
    id: newId(),
    name: opts.name,
    type: "ellipse",
    transform: {
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      rotation: opts.rotation ?? 0,
      opacity: opts.opacity ?? 1,
    },
    locked: false,
    hidden: false,
    rect: null,
    ellipse: {
      fill: opts.fill,
      stroke_color: opts.stroke_color ?? "#000000",
      stroke_width: opts.stroke_width ?? 0,
    },
    text: null,
    image: null,
    video: null,
    keyframes: [],
  };
}

function textLayer(
  opts: BaseOpts & {
    text: string;
    font_size?: number;
    font_weight?: number;
    color?: string;
    align?: "left" | "center" | "right";
    font_family?: string;
  }
): MotionLayer {
  return {
    id: newId(),
    name: opts.name,
    type: "text",
    transform: {
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      rotation: opts.rotation ?? 0,
      opacity: opts.opacity ?? 1,
    },
    locked: false,
    hidden: false,
    rect: null,
    ellipse: null,
    text: {
      text: opts.text,
      font_family: opts.font_family ?? "Inter, Arial, sans-serif",
      font_size: opts.font_size ?? 24,
      font_weight: opts.font_weight ?? 400,
      color: opts.color ?? "#FFFFFF",
      align: opts.align ?? "left",
    },
    image: null,
    video: null,
    keyframes: [],
  };
}

// ---------------------------------------------------------------------------
// Mockup factories. Each takes at minimum (x, y) — the group's anchor — and
// returns MotionLayer[] ordered back-to-front (so the last layer paints on
// top, matching how a scene's layers array renders).
// ---------------------------------------------------------------------------

const COLORS = {
  bezel: "#1F2937", // dark gray
  bezelStroke: "#111827",
  screen: "#FFFFFF",
  accent: "#4F46E5",
  accentDim: "#818CF8",
  chrome: "#E5E7EB",
  chromeStroke: "#9CA3AF",
  text: "#374151",
  textFaint: "#9CA3AF",
  placeholder: "#F3F4F6",
  green: "#059669",
};

/**
 * Phone mockup — portrait rounded bezel with a screen, speaker notch, and
 * a home indicator bar. Layers stack bezel → screen → notch → home bar.
 */
export function phoneMockup(x: number, y: number): MotionLayer[] {
  const w = 320;
  const h = 640;
  return [
    rectLayer({
      name: "Phone bezel",
      x,
      y,
      width: w,
      height: h,
      fill: COLORS.bezel,
      corner_radius: 40,
      stroke_color: COLORS.bezelStroke,
      stroke_width: 2,
    }),
    rectLayer({
      name: "Phone screen",
      x: x + 12,
      y: y + 12,
      width: w - 24,
      height: h - 24,
      fill: COLORS.screen,
      corner_radius: 28,
    }),
    rectLayer({
      name: "Phone notch",
      x: x + w / 2 - 50,
      y: y + 24,
      width: 100,
      height: 22,
      fill: COLORS.bezel,
      corner_radius: 12,
    }),
    rectLayer({
      name: "Phone home bar",
      x: x + w / 2 - 60,
      y: y + h - 28,
      width: 120,
      height: 6,
      fill: COLORS.bezel,
      corner_radius: 3,
    }),
  ];
}

/**
 * Laptop mockup — a screen lid (chrome top + dark bezel + inner screen) and
 * a trapezoidal-ish base formed by a wide bottom rect plus a narrower top-bar
 * (approximating the keyboard deck / hinge area). Layers ordered back-to-front.
 */
export function laptopMockup(x: number, y: number): MotionLayer[] {
  const lidW = 720;
  const lidH = 460;
  const baseW = 820;
  const baseH = 28;
  const baseX = x - (baseW - lidW) / 2;
  const baseY = y + lidH;
  return [
    // base / keyboard deck (drawn first so the lid sits on top of its hinge)
    rectLayer({
      name: "Laptop base",
      x: baseX,
      y: baseY,
      width: baseW,
      height: baseH,
      fill: COLORS.chrome,
      corner_radius: 10,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    }),
    rectLayer({
      name: "Laptop hinge",
      x: baseX + 40,
      y: baseY + 8,
      width: baseW - 80,
      height: 6,
      fill: COLORS.bezelStroke,
      corner_radius: 3,
    }),
    // lid
    rectLayer({
      name: "Laptop lid",
      x,
      y,
      width: lidW,
      height: lidH,
      fill: COLORS.bezel,
      corner_radius: 16,
      stroke_color: COLORS.bezelStroke,
      stroke_width: 2,
    }),
    rectLayer({
      name: "Laptop screen",
      x: x + 16,
      y: y + 16,
      width: lidW - 32,
      height: lidH - 32,
      fill: COLORS.screen,
      corner_radius: 8,
    }),
  ];
}

/**
 * Tablet mockup — landscape rounded bezel with screen and a front-camera dot
 * (an ellipse) near the top bezel.
 */
export function tabletMockup(x: number, y: number): MotionLayer[] {
  const w = 640;
  const h = 440;
  return [
    rectLayer({
      name: "Tablet bezel",
      x,
      y,
      width: w,
      height: h,
      fill: COLORS.bezel,
      corner_radius: 28,
      stroke_color: COLORS.bezelStroke,
      stroke_width: 2,
    }),
    rectLayer({
      name: "Tablet screen",
      x: x + 16,
      y: y + 16,
      width: w - 32,
      height: h - 32,
      fill: COLORS.screen,
      corner_radius: 18,
    }),
    ellipseLayer({
      name: "Tablet camera",
      x: x + w / 2 - 5,
      y: y + 8,
      width: 10,
      height: 10,
      fill: COLORS.bezelStroke,
    }),
  ];
}

/**
 * Browser window mockup — chrome top bar (with three traffic-light dots and
 * a URL bar), content area below. Useful as a backdrop for screen recordings.
 */
export function browserWindow(x: number, y: number): MotionLayer[] {
  const w = 720;
  const h = 480;
  const barH = 44;
  return [
    rectLayer({
      name: "Browser frame",
      x,
      y,
      width: w,
      height: h,
      fill: COLORS.screen,
      corner_radius: 12,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    }),
    rectLayer({
      name: "Browser top bar",
      x,
      y,
      width: w,
      height: barH,
      fill: COLORS.chrome,
      corner_radius: 12,
    }),
    // square off the bottom edge of the top bar (cover the rounded corners)
    rectLayer({
      name: "Browser top bar square",
      x,
      y: y + barH - 12,
      width: w,
      height: 12,
      fill: COLORS.chrome,
    }),
    // traffic lights
    ellipseLayer({ name: "Traffic light red", x: x + 16, y: y + 14, width: 16, height: 16, fill: "#EF4444" }),
    ellipseLayer({ name: "Traffic light yellow", x: x + 40, y: y + 14, width: 16, height: 16, fill: "#F59E0B" }),
    ellipseLayer({ name: "Traffic light green", x: x + 64, y: y + 14, width: 16, height: 16, fill: COLORS.green }),
    // URL bar
    rectLayer({
      name: "Browser URL bar",
      x: x + 96,
      y: y + 10,
      width: w - 112,
      height: 24,
      fill: COLORS.screen,
      corner_radius: 12,
    }),
    textLayer({
      name: "Browser URL text",
      x: x + 110,
      y: y + 12,
      width: w - 140,
      height: 20,
      text: "https://example.com",
      font_size: 14,
      color: COLORS.textFaint,
    }),
  ];
}

/**
 * Desktop window mockup — like the browser window but with a plain title bar
 * (no URL bar), a title text, and a body content area.
 */
export function desktopWindow(x: number, y: number, title = "Window"): MotionLayer[] {
  const w = 600;
  const h = 420;
  const barH = 40;
  return [
    rectLayer({
      name: "Window frame",
      x,
      y,
      width: w,
      height: h,
      fill: COLORS.screen,
      corner_radius: 10,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    }),
    rectLayer({
      name: "Window title bar",
      x,
      y,
      width: w,
      height: barH,
      fill: COLORS.chrome,
      corner_radius: 10,
    }),
    rectLayer({
      name: "Window title bar square",
      x,
      y: y + barH - 10,
      width: w,
      height: 10,
      fill: COLORS.chrome,
    }),
    textLayer({
      name: "Window title",
      x: x + 16,
      y: y + 10,
      width: w - 32,
      height: 20,
      text: title,
      font_size: 14,
      font_weight: 600,
      color: COLORS.text,
    }),
    // close button (top-right)
    ellipseLayer({ name: "Window close", x: x + w - 26, y: y + 12, width: 16, height: 16, fill: "#EF4444" }),
  ];
}

/**
 * Card mockup — rounded panel with a header line, two body lines, and an
 * accent strip across the top. A generic content container.
 */
export function cardMockup(x: number, y: number): MotionLayer[] {
  const w = 360;
  const h = 220;
  return [
    rectLayer({
      name: "Card body",
      x,
      y,
      width: w,
      height: h,
      fill: COLORS.screen,
      corner_radius: 16,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    }),
    rectLayer({
      name: "Card accent",
      x,
      y,
      width: w,
      height: 8,
      fill: COLORS.accent,
      corner_radius: 8,
    }),
    rectLayer({
      name: "Card accent square",
      x,
      y: y + 4,
      width: w,
      height: 4,
      fill: COLORS.accent,
    }),
    rectLayer({
      name: "Card avatar",
      x: x + 24,
      y: y + 28,
      width: 56,
      height: 56,
      fill: COLORS.placeholder,
      corner_radius: 28,
    }),
    textLayer({
      name: "Card title",
      x: x + 96,
      y: y + 32,
      width: w - 120,
      height: 24,
      text: "Card title",
      font_size: 18,
      font_weight: 600,
      color: COLORS.text,
    }),
    textLayer({
      name: "Card subtitle",
      x: x + 96,
      y: y + 58,
      width: w - 120,
      height: 18,
      text: "Supporting text line",
      font_size: 13,
      color: COLORS.textFaint,
    }),
    rectLayer({
      name: "Card body line 1",
      x: x + 24,
      y: y + 104,
      width: w - 48,
      height: 12,
      fill: COLORS.placeholder,
      corner_radius: 6,
    }),
    rectLayer({
      name: "Card body line 2",
      x: x + 24,
      y: y + 124,
      width: (w - 48) * 0.7,
      height: 12,
      fill: COLORS.placeholder,
      corner_radius: 6,
    }),
  ];
}

/**
 * Button mockup — pill-shaped rect with centered label text. The two layers
 * share the same bounding box; the text is inset by an eighth of the button's
 * height to vertically center the baseline roughly.
 */
export function buttonMockup(
  x: number,
  y: number,
  label = "Button"
): MotionLayer[] {
  const w = 200;
  const h = 56;
  return [
    rectLayer({
      name: "Button background",
      x,
      y,
      width: w,
      height: h,
      fill: COLORS.accent,
      corner_radius: h / 2,
    }),
    textLayer({
      name: "Button label",
      x: x + 16,
      y: y + h / 2 - 12,
      width: w - 32,
      height: 24,
      text: label,
      font_size: 16,
      font_weight: 600,
      color: "#FFFFFF",
      align: "center",
    }),
  ];
}

/**
 * Simple table mockup — a header row and `rows` body rows of `cols` columns,
 * all laid out as gray placeholder rects. A real grid renderer would draw
 * lines; here we approximate with filled cells whose gaps read as gridlines.
 */
export function simpleTable(x: number, y: number, rows = 3, cols = 3): MotionLayer[] {
  const tableW = 480;
  const headerH = 40;
  const rowH = 44;
  const colW = tableW / cols;
  const gap = 2;
  const layers: MotionLayer[] = [];

  // panel background
  layers.push(
    rectLayer({
      name: "Table panel",
      x,
      y,
      width: tableW,
      height: headerH + rowH * rows,
      fill: COLORS.screen,
      corner_radius: 8,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    })
  );

  // header cells (accent-tinted)
  for (let c = 0; c < cols; c++) {
    layers.push(
      rectLayer({
        name: `Table header ${c + 1}`,
        x: x + c * colW + gap,
        y: y + gap,
        width: colW - gap * 2,
        height: headerH - gap * 2,
        fill: COLORS.placeholder,
        corner_radius: 4,
      })
    );
  }

  // body cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      layers.push(
        rectLayer({
          name: `Table cell ${r + 1},${c + 1}`,
          x: x + c * colW + gap,
          y: y + headerH + r * rowH + gap,
          width: colW - gap * 2,
          height: rowH - gap * 2,
          fill: r % 2 === 0 ? COLORS.screen : COLORS.placeholder,
          corner_radius: 4,
        })
      );
    }
  }
  return layers;
}

/**
 * Simple form mockup — a column of label + input-field pairs (rect placeholders)
 * plus a submit button at the bottom. `fields` controls how many rows appear.
 */
export function simpleForm(x: number, y: number, fields = 3): MotionLayer[] {
  const w = 360;
  const labelH = 18;
  const inputH = 36;
  const rowGap = 16;
  const rowPitch = labelH + inputH + rowGap;
  const layers: MotionLayer[] = [];

  // panel background sized to fit the rows + a button at the bottom
  const panelH = rowPitch * fields + 64;
  layers.push(
    rectLayer({
      name: "Form panel",
      x,
      y,
      width: w,
      height: panelH,
      fill: COLORS.screen,
      corner_radius: 12,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    })
  );

  for (let i = 0; i < fields; i++) {
    const rowY = y + 24 + i * rowPitch;
    layers.push(
      textLayer({
        name: `Form label ${i + 1}`,
        x: x + 24,
        y: rowY,
        width: w - 48,
        height: labelH,
        text: `Field ${i + 1}`,
        font_size: 13,
        font_weight: 500,
        color: COLORS.text,
      })
    );
    layers.push(
      rectLayer({
        name: `Form input ${i + 1}`,
        x: x + 24,
        y: rowY + labelH + 4,
        width: w - 48,
        height: inputH,
        fill: COLORS.placeholder,
        corner_radius: 8,
        stroke_color: COLORS.chromeStroke,
        stroke_width: 1,
      })
    );
  }

  // submit button centered at the bottom
  const btnW = 140;
  const btnH = 44;
  const btnX = x + (w - btnW) / 2;
  const btnY = y + panelH - btnH - 16;
  layers.push(
    rectLayer({
      name: "Form submit button",
      x: btnX,
      y: btnY,
      width: btnW,
      height: btnH,
      fill: COLORS.accent,
      corner_radius: btnH / 2,
    })
  );
  layers.push(
    textLayer({
      name: "Form submit label",
      x: btnX + 12,
      y: btnY + btnH / 2 - 12,
      width: btnW - 24,
      height: 24,
      text: "Submit",
      font_size: 15,
      font_weight: 600,
      color: "#FFFFFF",
      align: "center",
    })
  );
  return layers;
}
