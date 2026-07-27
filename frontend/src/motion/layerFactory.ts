import type { LayerType, MotionLayer } from "../types/motion";
import { newId } from "./state";

const DEFAULT_NAMES: Record<LayerType, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  image: "Image",
  video: "Video",
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
        transform: { x: 760 + offset, y: 440 + offset, width: 400, height: 240, rotation: 0, opacity: 1 },
        rect: { fill: "#4F46E5", corner_radius: 12, stroke_color: "#000000", stroke_width: 0 },
      };
    case "ellipse":
      return {
        ...base,
        transform: { x: 810 + offset, y: 440 + offset, width: 300, height: 300, rotation: 0, opacity: 1 },
        ellipse: { fill: "#059669", stroke_color: "#000000", stroke_width: 0 },
      };
    case "text":
      return {
        ...base,
        transform: { x: 660 + offset, y: 480 + offset, width: 600, height: 100, rotation: 0, opacity: 1 },
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
        transform: { x: 710 + offset, y: 390 + offset, width: 500, height: 300, rotation: 0, opacity: 1 },
        image: { src: extra?.src ?? "", fit: "contain" },
      };
    case "video":
      return {
        ...base,
        transform: { x: 710 + offset, y: 390 + offset, width: 500, height: 300, rotation: 0, opacity: 1 },
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
  }
}
