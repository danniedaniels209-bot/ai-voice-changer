/**
 * Chart & diagram factory library.
 *
 * Mirrors components/mockups.ts's pattern exactly: each factory composes
 * primitive rect/ellipse/text layers into a group shaped like a common
 * chart or diagram, returning MotionLayer[] ready to append to a scene.
 * True pie wedges aren't expressible without a new shape type (only rect/
 * ellipse/text/image/video exist), so the pie chart approximates with a
 * single ellipse plus colored legend swatches rather than faking wedge
 * geometry with overlapping shapes.
 */

import type { MotionLayer } from "../../types/motion";
import { newId } from "../state";

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
      blur: 0,
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
      blur: 0,
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
      blur: 0,
    },
    locked: false,
    hidden: false,
    rect: null,
    ellipse: null,
    text: {
      text: opts.text,
      font_family: "Inter, Arial, sans-serif",
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

/** A thin rotated rect used as a "line segment" connecting two points —
 * the only way to draw a diagonal line with just rect/ellipse primitives. */
function lineSegment(name: string, x1: number, y1: number, x2: number, y2: number, color: string, thickness = 3): MotionLayer {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return rectLayer({
    name,
    x: midX - length / 2,
    y: midY - thickness / 2,
    width: length,
    height: thickness,
    rotation: angleDeg,
    fill: color,
  });
}

const COLORS = {
  panel: "#FFFFFF",
  panelStroke: "#9CA3AF",
  axis: "#9CA3AF",
  text: "#374151",
  textFaint: "#9CA3AF",
  series: ["#4F46E5", "#059669", "#F59E0B", "#EF4444", "#818CF8", "#0EA5E9"],
};

/** Bar chart — a panel with a baseline and a handful of bars at varying
 * heights, sitting on a shared axis. `values` (0-1 fractions of maxHeight)
 * controls how many bars and how tall each is. */
export function barChart(x: number, y: number, values: number[] = [0.4, 0.75, 0.55, 0.9, 0.3]): MotionLayer[] {
  const w = 480;
  const h = 320;
  const axisPad = 24;
  const maxBarH = h - axisPad * 2;
  const barGap = 16;
  const barW = (w - axisPad * 2 - barGap * (values.length - 1)) / values.length;
  const baselineY = y + h - axisPad;
  const layers: MotionLayer[] = [
    rectLayer({ name: "Bar chart panel", x, y, width: w, height: h, fill: COLORS.panel, corner_radius: 8, stroke_color: COLORS.panelStroke, stroke_width: 1 }),
    rectLayer({ name: "Bar chart axis", x: x + axisPad, y: baselineY, width: w - axisPad * 2, height: 2, fill: COLORS.axis }),
  ];
  values.forEach((v, i) => {
    const barH = Math.max(4, maxBarH * Math.min(1, Math.max(0, v)));
    const barX = x + axisPad + i * (barW + barGap);
    layers.push(
      rectLayer({
        name: `Bar ${i + 1}`,
        x: barX,
        y: baselineY - barH,
        width: barW,
        height: barH,
        fill: COLORS.series[i % COLORS.series.length],
        corner_radius: 3,
      })
    );
  });
  return layers;
}

/** Line chart — a panel with an axis and a row of data-point dots connected
 * by thin rotated-rect segments (no native line primitive exists). */
export function lineChart(x: number, y: number, values: number[] = [0.3, 0.6, 0.45, 0.8, 0.5, 0.9]): MotionLayer[] {
  const w = 480;
  const h = 320;
  const axisPad = 24;
  const plotH = h - axisPad * 2;
  const plotW = w - axisPad * 2;
  const baselineY = y + h - axisPad;
  const stepX = values.length > 1 ? plotW / (values.length - 1) : 0;
  const dotR = 6;

  const points = values.map((v, i) => ({
    x: x + axisPad + i * stepX,
    y: baselineY - plotH * Math.min(1, Math.max(0, v)),
  }));

  const layers: MotionLayer[] = [
    rectLayer({ name: "Line chart panel", x, y, width: w, height: h, fill: COLORS.panel, corner_radius: 8, stroke_color: COLORS.panelStroke, stroke_width: 1 }),
    rectLayer({ name: "Line chart axis", x: x + axisPad, y: baselineY, width: plotW, height: 2, fill: COLORS.axis }),
  ];

  for (let i = 0; i < points.length - 1; i++) {
    layers.push(lineSegment(`Line segment ${i + 1}`, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, COLORS.series[0], 3));
  }
  points.forEach((p, i) => {
    layers.push(ellipseLayer({ name: `Line point ${i + 1}`, x: p.x - dotR, y: p.y - dotR, width: dotR * 2, height: dotR * 2, fill: COLORS.series[0], stroke_color: COLORS.panel, stroke_width: 2 }));
  });
  return layers;
}

/** Pie chart — approximated as one big ellipse (the "pie" silhouette) plus
 * colored legend swatches with labels, since true wedge geometry isn't
 * expressible with rect/ellipse primitives alone. */
export function pieChart(x: number, y: number, labels: string[] = ["Series A", "Series B", "Series C"]): MotionLayer[] {
  const pieSize = 200;
  const legendX = x + pieSize + 32;
  const layers: MotionLayer[] = [
    ellipseLayer({ name: "Pie chart body", x, y, width: pieSize, height: pieSize, fill: COLORS.series[0], stroke_color: COLORS.panel, stroke_width: 3 }),
  ];
  labels.forEach((label, i) => {
    const swatchY = y + i * 32;
    layers.push(
      rectLayer({ name: `Pie legend swatch ${i + 1}`, x: legendX, y: swatchY, width: 16, height: 16, fill: COLORS.series[i % COLORS.series.length], corner_radius: 3 })
    );
    layers.push(
      textLayer({ name: `Pie legend label ${i + 1}`, x: legendX + 24, y: swatchY - 2, width: 160, height: 20, text: label, font_size: 14, color: COLORS.text })
    );
  });
  return layers;
}

/** Simple tree diagram — one root box, two child boxes, connecting line
 * segments. Boxes use plain rects; positions are fixed relative to (x, y). */
export function simpleTree(x: number, y: number): MotionLayer[] {
  const boxW = 140;
  const boxH = 48;
  const rootX = x + 170;
  const rootY = y;
  const childY = y + 120;
  const leftX = x;
  const rightX = x + 340;

  function box(name: string, bx: number, by: number, label: string): MotionLayer[] {
    return [
      rectLayer({ name, x: bx, y: by, width: boxW, height: boxH, fill: COLORS.panel, corner_radius: 8, stroke_color: COLORS.panelStroke, stroke_width: 1 }),
      textLayer({ name: `${name} label`, x: bx, y: by + boxH / 2 - 10, width: boxW, height: 20, text: label, font_size: 15, font_weight: 600, color: COLORS.text, align: "center" }),
    ];
  }

  const rootCx = rootX + boxW / 2;
  const rootBottom = rootY + boxH;
  const leftCx = leftX + boxW / 2;
  const rightCx = rightX + boxW / 2;

  return [
    ...box("Tree root", rootX, rootY, "Root"),
    lineSegment("Tree branch left", rootCx, rootBottom, leftCx, childY, COLORS.axis, 2),
    lineSegment("Tree branch right", rootCx, rootBottom, rightCx, childY, COLORS.axis, 2),
    ...box("Tree child left", leftX, childY, "Child A"),
    ...box("Tree child right", rightX, childY, "Child B"),
  ];
}

/** Simple flowchart — three boxes in a row connected by arrow-tipped
 * segments (reusing the small-triangle-as-arrowhead idea, approximated
 * with a tiny rotated square since no dedicated triangle primitive exists). */
export function simpleFlowchart(x: number, y: number, steps: string[] = ["Start", "Process", "End"]): MotionLayer[] {
  const boxW = 160;
  const boxH = 56;
  const gap = 60;
  const layers: MotionLayer[] = [];

  steps.forEach((label, i) => {
    const bx = x + i * (boxW + gap);
    layers.push(
      rectLayer({ name: `Flow box ${i + 1}`, x: bx, y, width: boxW, height: boxH, fill: COLORS.panel, corner_radius: 10, stroke_color: COLORS.panelStroke, stroke_width: 1 })
    );
    layers.push(
      textLayer({ name: `Flow box ${i + 1} label`, x: bx, y: y + boxH / 2 - 10, width: boxW, height: 20, text: label, font_size: 14, font_weight: 600, color: COLORS.text, align: "center" })
    );
    if (i < steps.length - 1) {
      const arrowY = y + boxH / 2;
      const startX = bx + boxW;
      const endX = bx + boxW + gap;
      layers.push(lineSegment(`Flow arrow ${i + 1}`, startX, arrowY, endX, arrowY, COLORS.axis, 3));
      layers.push(
        rectLayer({ name: `Flow arrowhead ${i + 1}`, x: endX - 6, y: arrowY - 6, width: 12, height: 12, rotation: 45, fill: COLORS.axis })
      );
    }
  });
  return layers;
}

/** Sticky-note grid — 3-4 colored note rects with short text, laid out in
 * a 2-column grid. Built independently from callouts/ (not imported) per
 * spec, even though the visual idea is similar. */
export function stickyNoteGrid(x: number, y: number, notes: string[] = ["Idea", "Todo", "Blocked", "Done"]): MotionLayer[] {
  const noteW = 160;
  const noteH = 120;
  const gap = 16;
  const cols = 2;
  const noteColors = ["#FEF08A", "#BBF7D0", "#FECACA", "#BFDBFE"];
  const layers: MotionLayer[] = [];

  notes.forEach((text, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const nx = x + col * (noteW + gap);
    const ny = y + row * (noteH + gap);
    layers.push(
      rectLayer({ name: `Sticky note ${i + 1}`, x: nx, y: ny, width: noteW, height: noteH, fill: noteColors[i % noteColors.length], corner_radius: 4, rotation: (i % 2 === 0 ? -2 : 2) })
    );
    layers.push(
      textLayer({ name: `Sticky note ${i + 1} text`, x: nx + 12, y: ny + 16, width: noteW - 24, height: noteH - 32, text, font_size: 15, font_weight: 500, color: "#374151" })
    );
  });
  return layers;
}
