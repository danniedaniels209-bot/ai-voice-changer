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
  },
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
  },
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

const COLORS = {
  bezel: "#111827",
  bezelLight: "#1F2937",
  chrome: "#E5E7EB",
  chromeStroke: "#9CA3AF",
  chromeText: "#6B7280",
  shadow: "#000000",
  red: "#EF4444",
  yellow: "#F59E0B",
  green: "#059669",
  address: "#FFFFFF",
};

function framePieces(
  name: string,
  x: number,
  y: number,
  contentWidth: number,
  contentHeight: number,
  inset: { top: number; right: number; bottom: number; left: number },
  opts: { fill: string; corner_radius?: number; stroke_color?: string; stroke_width?: number },
): MotionLayer[] {
  const outerX = x - inset.left;
  const outerY = y - inset.top;
  const outerW = contentWidth + inset.left + inset.right;
  const outerH = contentHeight + inset.top + inset.bottom;

  return [
    rectLayer({
      name: `${name} top frame`,
      x: outerX,
      y: outerY,
      width: outerW,
      height: inset.top,
      ...opts,
    }),
    rectLayer({
      name: `${name} right frame`,
      x: x + contentWidth,
      y: outerY,
      width: inset.right,
      height: outerH,
      ...opts,
    }),
    rectLayer({
      name: `${name} bottom frame`,
      x: outerX,
      y: y + contentHeight,
      width: outerW,
      height: inset.bottom,
      ...opts,
    }),
    rectLayer({
      name: `${name} left frame`,
      x: outerX,
      y: outerY,
      width: inset.left,
      height: outerH,
      ...opts,
    }),
  ];
}

export function phoneFrame(
  x: number,
  y: number,
  contentWidth: number,
  contentHeight: number,
): MotionLayer[] {
  const inset = { top: 36, right: 14, bottom: 28, left: 14 };
  const outerX = x - inset.left;
  const outerY = y - inset.top;
  const outerW = contentWidth + inset.left + inset.right;
  const outerH = contentHeight + inset.top + inset.bottom;

  return [
    rectLayer({
      name: "Phone frame shadow",
      x: outerX + 8,
      y: outerY + 10,
      width: outerW,
      height: outerH,
      fill: COLORS.shadow,
      corner_radius: 38,
      opacity: 0.18,
    }),
    ...framePieces("Phone", x, y, contentWidth, contentHeight, inset, {
      fill: COLORS.bezel,
      corner_radius: 16,
      stroke_color: COLORS.bezelLight,
      stroke_width: 1,
    }),
    rectLayer({
      name: "Phone speaker",
      x: x + contentWidth / 2 - 34,
      y: outerY + 15,
      width: 68,
      height: 8,
      fill: COLORS.bezelLight,
      corner_radius: 4,
    }),
    rectLayer({
      name: "Phone home indicator",
      x: x + contentWidth / 2 - 48,
      y: y + contentHeight + 14,
      width: 96,
      height: 5,
      fill: COLORS.bezelLight,
      corner_radius: 3,
    }),
  ];
}

export function laptopFrame(
  x: number,
  y: number,
  contentWidth: number,
  contentHeight: number,
): MotionLayer[] {
  const inset = { top: 18, right: 18, bottom: 28, left: 18 };
  const outerX = x - inset.left;
  const outerY = y - inset.top;
  const outerW = contentWidth + inset.left + inset.right;
  const baseY = y + contentHeight + inset.bottom;

  return [
    rectLayer({
      name: "Laptop screen shadow",
      x: outerX + 8,
      y: outerY + 10,
      width: outerW,
      height: contentHeight + inset.top + inset.bottom,
      fill: COLORS.shadow,
      corner_radius: 12,
      opacity: 0.16,
    }),
    ...framePieces("Laptop", x, y, contentWidth, contentHeight, inset, {
      fill: COLORS.bezel,
      corner_radius: 8,
      stroke_color: COLORS.bezelLight,
      stroke_width: 1,
    }),
    rectLayer({
      name: "Laptop base",
      x: outerX - 52,
      y: baseY,
      width: outerW + 104,
      height: 24,
      fill: COLORS.chrome,
      corner_radius: 10,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    }),
    rectLayer({
      name: "Laptop trackpad notch",
      x: x + contentWidth / 2 - 52,
      y: baseY,
      width: 104,
      height: 7,
      fill: "#D1D5DB",
      corner_radius: 4,
    }),
  ];
}

export function browserChromeFrame(
  x: number,
  y: number,
  contentWidth: number,
  contentHeight: number,
): MotionLayer[] {
  const chromeH = 42;
  const inset = { top: chromeH, right: 1, bottom: 1, left: 1 };
  const outerX = x - inset.left;
  const outerY = y - inset.top;
  const outerW = contentWidth + inset.left + inset.right;

  return [
    ...framePieces("Browser", x, y, contentWidth, contentHeight, inset, {
      fill: COLORS.chrome,
      corner_radius: 6,
      stroke_color: COLORS.chromeStroke,
      stroke_width: 1,
    }),
    ellipseLayer({
      name: "Browser close dot",
      x: outerX + 14,
      y: outerY + 14,
      width: 10,
      height: 10,
      fill: COLORS.red,
    }),
    ellipseLayer({
      name: "Browser minimize dot",
      x: outerX + 32,
      y: outerY + 14,
      width: 10,
      height: 10,
      fill: COLORS.yellow,
    }),
    ellipseLayer({
      name: "Browser maximize dot",
      x: outerX + 50,
      y: outerY + 14,
      width: 10,
      height: 10,
      fill: COLORS.green,
    }),
    rectLayer({
      name: "Browser address bar",
      x: outerX + 76,
      y: outerY + 10,
      width: Math.max(80, outerW - 96),
      height: 18,
      fill: COLORS.address,
      corner_radius: 9,
      stroke_color: "#D1D5DB",
      stroke_width: 1,
    }),
    rectLayer({
      name: "Browser address text",
      x: outerX + 92,
      y: outerY + 18,
      width: Math.max(44, outerW - 140),
      height: 2,
      fill: COLORS.chromeText,
      corner_radius: 1,
      opacity: 0.55,
    }),
  ];
}

export function tabletFrame(
  x: number,
  y: number,
  contentWidth: number,
  contentHeight: number,
): MotionLayer[] {
  const inset = { top: 24, right: 24, bottom: 24, left: 24 };
  const outerX = x - inset.left;
  const outerY = y - inset.top;
  const outerW = contentWidth + inset.left + inset.right;
  const outerH = contentHeight + inset.top + inset.bottom;

  return [
    rectLayer({
      name: "Tablet frame shadow",
      x: outerX + 8,
      y: outerY + 10,
      width: outerW,
      height: outerH,
      fill: COLORS.shadow,
      corner_radius: 28,
      opacity: 0.14,
    }),
    ...framePieces("Tablet", x, y, contentWidth, contentHeight, inset, {
      fill: COLORS.bezel,
      corner_radius: 16,
      stroke_color: COLORS.bezelLight,
      stroke_width: 1,
    }),
    ellipseLayer({
      name: "Tablet camera",
      x: x + contentWidth / 2 - 4,
      y: outerY + 10,
      width: 8,
      height: 8,
      fill: COLORS.bezelLight,
    }),
  ];
}

export interface DeviceFrameDef {
  id: string;
  label: string;
  build: (x: number, y: number, contentWidth: number, contentHeight: number) => MotionLayer[];
}

export const DEVICE_FRAME_DEFINITIONS: DeviceFrameDef[] = [
  { id: "phone", label: "Phone Frame", build: phoneFrame },
  { id: "laptop", label: "Laptop Frame", build: laptopFrame },
  { id: "browser", label: "Browser Chrome", build: browserChromeFrame },
  { id: "tablet", label: "Tablet Frame", build: tabletFrame },
];
