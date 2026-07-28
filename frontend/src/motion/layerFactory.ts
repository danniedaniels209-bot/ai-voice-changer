import type { LayerType, MotionLayer } from "../types/motion";
import { newId } from "./state";

/** Compute vertices of a regular polygon centred in `(w/2, h/2)`. Returns a
 *  flat array [x1, y1, x2, y2, …] suitable for PolygonLayerProps.points. */
function regularPolygonPoints(n: number, w: number, h: number): number[] {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return pts;
}

const DEFAULT_NAMES: Record<LayerType, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  image: "Image",
  video: "Video",
  polygon: "Polygon",
  star: "Star",
  triangle: "Triangle",
  line: "Line",
  arrow: "Arrow",
};

/** New layers spawn near the canvas center-ish rather than stacked at
 * (0,0) — each successive add nudges a little so they don't hide the one
 * before it. */
let spawnOffset = 0;

export function createLayer(type: LayerType, extra?: { src?: string }): MotionLayer {
  const offset = (spawnOffset++ % 8) * 24;
  const base = {
    id: newId(),
    name: DEFAULT_NAMES[type],
    type,
    locked: false,
    hidden: false,
    rect: null,
    ellipse: null,
    text: null,
    image: null,
    video: null,
    keyframes: [],
  };

  switch (type) {
    case "rect":
      return {
        ...base,
        transform: { x: 760 + offset, y: 440 + offset, width: 400, height: 240, rotation: 0, opacity: 1, blur: 0 },
        rect: { fill: "#4F46E5", corner_radius: 12, stroke_color: "#000000", stroke_width: 0 },
      };
    case "ellipse":
      return {
        ...base,
        transform: { x: 810 + offset, y: 440 + offset, width: 300, height: 300, rotation: 0, opacity: 1, blur: 0 },
        ellipse: { fill: "#059669", stroke_color: "#000000", stroke_width: 0 },
      };
    case "text":
      return {
        ...base,
        transform: { x: 660 + offset, y: 480 + offset, width: 600, height: 100, rotation: 0, opacity: 1, blur: 0 },
        text: {
          text: "Your text here",
          font_family: "Inter, Arial, sans-serif",
          font_size: 56,
          font_weight: 700,
          color: "#FFFFFF",
          align: "left",
        },
      };
    case "image":
      return {
        ...base,
        transform: { x: 710 + offset, y: 390 + offset, width: 500, height: 300, rotation: 0, opacity: 1, blur: 0 },
        image: { src: extra?.src ?? "", fit: "contain" },
      };
    case "video":
      return {
        ...base,
        transform: { x: 710 + offset, y: 390 + offset, width: 500, height: 300, rotation: 0, opacity: 1, blur: 0 },
        video: {
          source_url: extra?.src ?? "",
          trim_start_ms: 0,
          trim_end_ms: 0,
          playback_rate: 1,
          muted: false,
          volume: 1,
          fit: "contain",
        },
      };
    case "polygon": {
      const pw = 300;
      const ph = 300;
      return {
        ...base,
        transform: { x: 810 + offset, y: 390 + offset, width: pw, height: ph, rotation: 0, opacity: 1, blur: 0 },
        polygon: {
          fill: "#8B5CF6",
          stroke_color: "#000000",
          stroke_width: 0,
          points: regularPolygonPoints(5, pw, ph),
        },
      };
    }
    case "star": {
      const sw = 300;
      const sh = 300;
      return {
        ...base,
        transform: { x: 810 + offset, y: 390 + offset, width: sw, height: sh, rotation: 0, opacity: 1, blur: 0 },
        star: {
          fill: "#F59E0B",
          stroke_color: "#000000",
          stroke_width: 0,
          num_points: 5,
          inner_radius_ratio: 0.4,
        },
      };
    }
    case "triangle":
      return {
        ...base,
        transform: { x: 810 + offset, y: 390 + offset, width: 300, height: 300, rotation: 0, opacity: 1, blur: 0 },
        triangle: {
          fill: "#10B981",
          stroke_color: "#000000",
          stroke_width: 0,
          direction: "up",
        },
      };
    case "line":
      return {
        ...base,
        transform: { x: 760 + offset, y: 440 + offset, width: 400, height: 200, rotation: 0, opacity: 1, blur: 0 },
        line: {
          stroke_color: "#FFFFFF",
          stroke_width: 3,
          x1: 0,
          y1: 0,
          x2: 400,
          y2: 200,
        },
      };
    case "arrow":
      return {
        ...base,
        transform: { x: 760 + offset, y: 440 + offset, width: 400, height: 200, rotation: 0, opacity: 1, blur: 0 },
        arrow: {
          stroke_color: "#FFFFFF",
          stroke_width: 3,
          x1: 0,
          y1: 0,
          x2: 400,
          y2: 200,
          head_size: 16,
          head_angle: 30,
        },
      };
  }
}
