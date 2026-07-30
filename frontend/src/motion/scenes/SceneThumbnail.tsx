import { Fragment } from "react";
import { isLayerVisibleAt } from "../../types/motion";
import type { MotionLayer, MotionScene, Transform } from "../../types/motion";
import type { GradientFill } from "../gradients/gradientTypes";
import type { ShadowEffect } from "../shadowfx/shadowTypes";
import { lineHeight, wrapTextToLines } from "../textWrap";
import { isEffectivelyHidden } from "../layerTree";
import { resolveConnectorEndpoints } from "../connectorGeometry";
import { Connector } from "../connector/Connector";
import type { ConnectorSpec } from "../connector/ConnectorTypes";
import { colorGradeFilterId, isIdentityColorGrade, renderColorGradeFilter } from "../colorgrade/colorGrade";

export interface SceneThumbnailProps {
  scene: MotionScene;
  width: number;
  height: number;
}

/** Resolve a layer's transform at t=0 — the same shape RenderFrame.tsx
 * computes, but for the thumbnail we only ever draw the first frame, so
 * keyframes before 0 are honored (their first keyframe value wins per
 * interpolateProperty's clamping rule) and the rest are ignored. Keeping
 * a local copy avoids importing from the editor's easing module, which
 * pulls in resolveTransformAtTime — fine, but this keeps the thumbnail
 * self-contained and free of any editor-only dependencies. */
function transformAtRest(layer: MotionLayer): Transform {
  const t = layer.transform;
  if (layer.keyframes.length === 0) return t;

  function firstValue(prop: keyof Transform): number {
    const track = layer.keyframes
      .filter((k) => k.property === prop)
      .sort((a, b) => a.time_ms - b.time_ms);
    if (track.length === 0) return t[prop];
    return track[0].value;
  }

  return {
    x: firstValue("x"),
    y: firstValue("y"),
    width: firstValue("width"),
    height: firstValue("height"),
    rotation: firstValue("rotation"),
    opacity: firstValue("opacity"),
    blur: firstValue("blur"),
  };
}

/** Per-layer gradient <defs> — mirrors the same id-namespacing convention as
 *  MotionCanvas.tsx so the pattern stays consistent across renderers. */
function renderGradientDef(layerId: string, grad: GradientFill): React.ReactNode {
  const stops = grad.stops.map((s, i) => (
    <stop key={i} offset={s.offset} stopColor={s.color} />
  ));
  if (grad.type === "radial") {
    return (
      <radialGradient id={`${layerId}-fill`} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        {stops}
      </radialGradient>
    );
  }
  // CSS angle convention (0 = up, clockwise) — must match MotionCanvas.tsx
  // and GradientPicker's CSS preview. See the note in MotionCanvas.tsx.
  const rad = (grad.angle_deg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return (
    <linearGradient
      id={`${layerId}-fill`}
      x1={(1 - dx) / 2}
      y1={(1 - dy) / 2}
      x2={(1 + dx) / 2}
      y2={(1 + dy) / 2}
    >
      {stops}
    </linearGradient>
  );
}

/** Per-layer drop-shadow / glow <filter>. glow=true zeros the offsets so the
 *  same struct renders as a centered glow rather than a directional drop. */
function renderShadowFilter(layerId: string, shadow: ShadowEffect): React.ReactNode {
  const dx = shadow.glow ? 0 : shadow.offset_x;
  const dy = shadow.glow ? 0 : shadow.offset_y;
  return (
    <filter id={`${layerId}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow
        dx={dx}
        dy={dy}
        stdDeviation={shadow.blur}
        floodColor={shadow.color}
        floodOpacity={shadow.opacity}
      />
    </filter>
  );
}

/**
 * Per-layer gaussian blur <filter>. stdDeviation is blur/2 so the visual
 * radius matches the UI `blur` value in px.
 */
function renderBlurFilter(layerId: string, blur: number): React.ReactNode {
  return (
    <filter id={`${layerId}-blur`} x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation={blur / 2} />
    </filter>
  );
}

/** Resolve a layer's fill — gradient url if set, otherwise the shape's
 *  plain solid color. */
function resolveFill(layer: MotionLayer, solidFill: string): string {
  if (layer.gradient) return `url(#${layer.id}-fill)`;
  return solidFill;
}

function renderLayer(layer: MotionLayer, sceneDurationMs: number, layers: MotionLayer[]): React.ReactNode {
  if (isEffectivelyHidden(layer, layers)) return null;
  // The thumbnail claims to be the scene's first frame, so a layer whose
  // time window starts later genuinely isn't in it. Showing it anyway would
  // make the thumbnail disagree with both the canvas and the export.
  if (!isLayerVisibleAt(layer, sceneDurationMs, 0)) return null;
  const t = transformAtRest(layer);
  const groupTransform = `translate(${t.x} ${t.y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2})`;

  let shape: React.ReactNode = null;
  if (layer.type === "rect" && layer.rect) {
    shape = (
      <rect
        width={t.width}
        height={t.height}
        rx={layer.rect.corner_radius}
        ry={layer.rect.corner_radius}
        fill={resolveFill(layer, layer.rect.fill)}
        stroke={layer.rect.stroke_width > 0 ? layer.rect.stroke_color : "none"}
        strokeWidth={layer.rect.stroke_width}
      />
    );
  } else if (layer.type === "ellipse" && layer.ellipse) {
    shape = (
      <ellipse
        cx={t.width / 2}
        cy={t.height / 2}
        rx={t.width / 2}
        ry={t.height / 2}
        fill={resolveFill(layer, layer.ellipse.fill)}
        stroke={layer.ellipse.stroke_width > 0 ? layer.ellipse.stroke_color : "none"}
        strokeWidth={layer.ellipse.stroke_width}
      />
    );
  } else if (layer.type === "text" && layer.text) {
    const anchor =
      layer.text.align === "center" ? "middle" : layer.text.align === "right" ? "end" : "start";
    const anchorX =
      layer.text.align === "center" ? t.width / 2 : layer.text.align === "right" ? t.width : 0;
    // Same wrap helper used by MotionCanvas.tsx and RenderFrame.tsx —
    // deterministic so thumbnail matches what the editor and export show.
    const lines = wrapTextToLines(layer.text.text, {
      maxWidthPx: Math.max(0, t.width),
      fontSize: layer.text.font_size,
    });
    const lineY = lineHeight(layer.text.font_size, layer.text.line_height);
    shape = (
      <text
        x={anchorX}
        y={layer.text.font_size}
        textAnchor={anchor}
        fontFamily={layer.text.font_family}
        fontSize={layer.text.font_size}
        fontWeight={layer.text.font_weight}
        fill={resolveFill(layer, layer.text.color)}
        letterSpacing={layer.text.letter_spacing ?? 0}
        stroke={layer.text.stroke_width && layer.text.stroke_width > 0 ? layer.text.stroke_color : "none"}
        strokeWidth={layer.text.stroke_width ?? 0}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={anchorX} dy={i === 0 ? 0 : lineY}>
            {line}
          </tspan>
        ))}
      </text>
    );
    } else if (layer.type === "image" && layer.image) {
      shape = layer.image.src ? (
        <image
          href={layer.image.src}
          width={t.width}
          height={t.height}
          preserveAspectRatio={
            layer.image.fit === "cover"
              ? "xMidYMid slice"
              : layer.image.fit === "fill"
                ? "none"
                : "xMidYMid meet"
          }
        />
      ) : (
        <rect width={t.width} height={t.height} fill="#2a2a33" stroke="#444" strokeDasharray="6 4" />
      );
    } else if (layer.type === "polygon" && layer.polygon) {
      const pts = layer.polygon.points.join(" ");
      shape = (
        <polygon
          points={pts}
          fill={resolveFill(layer, layer.polygon.fill)}
          stroke={layer.polygon.stroke_width > 0 ? layer.polygon.stroke_color : "none"}
          strokeWidth={layer.polygon.stroke_width}
        />
      );
    } else if (layer.type === "star" && layer.star) {
      const cx = t.width / 2;
      const cy = t.height / 2;
      const outerR = Math.min(t.width, t.height) / 2;
      const innerR = outerR * layer.star.inner_radius_ratio;
      const starPts: number[] = [];
      for (let i = 0; i < layer.star.num_points * 2; i++) {
        const a = (Math.PI * 2 * i) / (layer.star.num_points * 2) - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        starPts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      shape = (
        <polygon
          points={starPts.join(" ")}
          fill={resolveFill(layer, layer.star.fill)}
          stroke={layer.star.stroke_width > 0 ? layer.star.stroke_color : "none"}
          strokeWidth={layer.star.stroke_width}
        />
      );
    } else if (layer.type === "triangle" && layer.triangle) {
      const triDir = layer.triangle.direction;
      let triPts: number[];
      if (triDir === "up") {
        triPts = [t.width / 2, 0, 0, t.height, t.width, t.height];
      } else if (triDir === "down") {
        triPts = [0, 0, t.width, 0, t.width / 2, t.height];
      } else if (triDir === "left") {
        triPts = [t.width, 0, t.width, t.height, 0, t.height / 2];
      } else {
        triPts = [0, 0, 0, t.height, t.width, t.height / 2];
      }
      shape = (
        <polygon
          points={triPts.join(" ")}
          fill={resolveFill(layer, layer.triangle.fill)}
          stroke={layer.triangle.stroke_width > 0 ? layer.triangle.stroke_color : "none"}
          strokeWidth={layer.triangle.stroke_width}
        />
      );
    } else if (layer.type === "line" && layer.line) {
      const lineStroke = layer.gradient ? `url(#${layer.id}-fill)` : layer.line.stroke_color;
      shape = (
        <line
          x1={layer.line.x1}
          y1={layer.line.y1}
          x2={layer.line.x2}
          y2={layer.line.y2}
          stroke={lineStroke}
          strokeWidth={layer.line.stroke_width}
          strokeLinecap="round"
        />
      );
    } else if (layer.type === "arrow" && layer.arrow) {
      const a = layer.arrow;
      const dx = a.x2 - a.x1;
      const dy = a.y2 - a.y1;
      const len = Math.hypot(dx, dy);
      const ux = len > 0 ? dx / len : 1;
      const uy = len > 0 ? dy / len : 0;
      const headAng = (a.head_angle * Math.PI) / 180;
      const baseCx = a.x2 - a.head_size * Math.cos(headAng) * ux;
      const baseCy = a.y2 - a.head_size * Math.cos(headAng) * uy;
      const hw = a.head_size * Math.sin(headAng);
      const leftPx = baseCx + hw * uy;
      const leftPy = baseCy - hw * ux;
      const rightPx = baseCx - hw * uy;
      const rightPy = baseCy + hw * ux;
      const arrowStroke = layer.gradient ? `url(#${layer.id}-fill)` : a.stroke_color;
      shape = (
        <g>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={arrowStroke} strokeWidth={a.stroke_width} strokeLinecap="round" />
          <polygon points={`${a.x2},${a.y2} ${leftPx},${leftPy} ${rightPx},${rightPy}`} fill={arrowStroke} />
        </g>
      );
    }

    let filteredShape: React.ReactNode = shape;
    if (!isIdentityColorGrade(layer.color_grade)) {
      filteredShape = <g filter={`url(#${colorGradeFilterId(layer.id)})`}>{filteredShape}</g>;
    }
    if (t.blur > 0) {
      filteredShape = <g filter={`url(#${layer.id}-blur)`}>{filteredShape}</g>;
    }
    if (layer.shadow) {
      filteredShape = <g filter={`url(#${layer.id}-shadow)`}>{filteredShape}</g>;
    }

  return (
    <g key={layer.id} transform={groupTransform} opacity={t.opacity}>
      {filteredShape}
    </g>
  );
}

export function SceneThumbnail({ scene, width, height }: SceneThumbnailProps) {
  const sceneW = scene.width || 1;
  const sceneH = scene.height || 1;
  const scale = Math.min(width / sceneW, height / sceneH);
  const scaledW = sceneW * scale;
  const scaledH = sceneH * scale;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <svg
        width={scaledW}
        height={scaledH}
        viewBox={`0 0 ${sceneW} ${sceneH}`}
        style={{ display: "block" }}
      >
        <defs>
          {scene.layers.map((layer) => {
            const t = transformAtRest(layer);
            return (
              <Fragment key={`defs-${layer.id}`}>
                {layer.gradient ? renderGradientDef(layer.id, layer.gradient) : null}
                {layer.shadow ? renderShadowFilter(layer.id, layer.shadow) : null}
                {t.blur > 0 ? renderBlurFilter(layer.id, t.blur) : null}
                {!isIdentityColorGrade(layer.color_grade)
                  ? renderColorGradeFilter(layer.id, layer.color_grade!)
                  : null}
              </Fragment>
            );
          })}
        </defs>
        <rect width={sceneW} height={sceneH} fill={scene.background_color} />
        {scene.layers.map((layer) => renderLayer(layer, scene.duration_ms, scene.layers))}
        {(scene.connectors ?? []).map((conn) => {
          const resolved = resolveConnectorEndpoints(conn, scene.layers, 0);
          if (!resolved) return null;
          const spec: ConnectorSpec = {
            from: resolved.source,
            to: resolved.target,
            style: conn.style,
            strokeColor: conn.stroke_color,
            strokeWidth: conn.stroke_width,
            dashPattern: conn.dash_pattern ?? undefined,
            animated: conn.animated,
          };
          return <Connector key={conn.id} spec={spec} currentTime={0} />;
        })}
      </svg>
    </div>
  );
}
