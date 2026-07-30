/**
 * LT-TEXTONPATH — SVG <textPath> text rendering helper.
 *
 * This module is the SINGLE source of truth for rendering text layers across
 * all three renderers (MotionCanvas.tsx, RenderFrame.tsx, SceneThumbnail.tsx).
 * Per project standing rules: one shared helper, all three renderers import it,
 * none redefine it.
 *
 * When path_type is "none" (or undefined/absent), text is rendered as standard
 * multiline wrapped <text><tspan>...</text>, byte-identical to prior behavior.
 *
 * When path_type is an active path ("arc-up", "arc-down", "wave", "circle", "custom"),
 * text follows an SVG <path> using <textPath href="#...">.
 */

import React from "react";
import type { MotionLayer, Transform, TextPathType } from "../../types/motion";
import { wrapTextToLines, lineHeight } from "../textWrap";

/** Generate path `d` string for a preset or return custom path `d`. */
export function getTextPathD(
  pathType: TextPathType | undefined,
  customD: string | null | undefined,
  width: number,
  height: number,
): string | null {
  if (!pathType || pathType === "none") return null;
  if (pathType === "custom") return customD || null;

  const w = Math.max(1, width);
  const h = Math.max(1, height);

  switch (pathType) {
    case "arc-up":
      // Smooth curve arcing upwards
      return `M 0,${h * 0.85} Q ${w / 2},${h * 0.15} ${w},${h * 0.85}`;
    case "arc-down":
      // Smooth curve arcing downwards
      return `M 0,${h * 0.15} Q ${w / 2},${h * 0.85} ${w},${h * 0.15}`;
    case "wave":
      // S-curve wave across the width
      return `M 0,${h * 0.5} Q ${w * 0.25},${h * 0.1} ${w * 0.5},${h * 0.5} T ${w},${h * 0.5}`;
    case "circle": {
      // Circular / elliptical arc path
      const rx = w / 2;
      const ry = h / 2;
      return `M 0,${ry} A ${rx},${ry} 0 1,1 ${w},${ry} A ${rx},${ry} 0 1,1 0,${ry}`;
    }
    default:
      return null;
  }
}

export interface RenderTextOptions {
  layer: MotionLayer;
  transform: Transform;
  resolveFill: (layer: MotionLayer, color: string) => string;
}

/** Single shared helper for rendering text shape (with or without path). */
export function renderTextLayer({ layer, transform: t, resolveFill }: RenderTextOptions): React.ReactNode {
  if (layer.type !== "text" || !layer.text) return null;

  const pathType = layer.text.path_type;
  const pathD = getTextPathD(pathType, layer.text.path_d, t.width, t.height);

  const anchor =
    layer.text.align === "center" ? "middle" : layer.text.align === "right" ? "end" : "start";
  const anchorX =
    layer.text.align === "center" ? t.width / 2 : layer.text.align === "right" ? t.width : 0;
  const fontColor = resolveFill(layer, layer.text.color);
  const strokeColor =
    layer.text.stroke_width && layer.text.stroke_width > 0 ? layer.text.stroke_color : "none";
  const strokeWidth = layer.text.stroke_width ?? 0;
  const letterSpacing = layer.text.letter_spacing ?? 0;

  // Path rendering
  if (pathD) {
    const pathId = `tp-${layer.id}`;
    const startOffset =
      layer.text.align === "center" ? "50%" : layer.text.align === "right" ? "100%" : "0%";

    return (
      <g key={`text-path-group-${layer.id}`}>
        <defs>
          <path id={pathId} d={pathD} />
        </defs>
        <text
          fontFamily={layer.text.font_family}
          fontSize={layer.text.font_size}
          fontWeight={layer.text.font_weight}
          fill={fontColor}
          letterSpacing={letterSpacing}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        >
          <textPath href={`#${pathId}`} startOffset={startOffset} textAnchor={anchor}>
            {layer.text.text}
          </textPath>
        </text>
      </g>
    );
  }

  // Standard wrapped multiline text rendering
  const lines = wrapTextToLines(layer.text.text, {
    maxWidthPx: Math.max(0, t.width),
    fontSize: layer.text.font_size,
  });
  const lineY = lineHeight(layer.text.font_size, layer.text.line_height);

  return (
    <text
      x={anchorX}
      y={layer.text.font_size}
      textAnchor={anchor}
      fontFamily={layer.text.font_family}
      fontSize={layer.text.font_size}
      fontWeight={layer.text.font_weight}
      fill={fontColor}
      letterSpacing={letterSpacing}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={anchorX} dy={i === 0 ? 0 : lineY}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
