import { useEffect, useState, useRef } from "react";
import { Fragment } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getMotionProject, resolveMotionAssetUrl } from "../api/motion";
import type {
  AnimatableProperty,
  EasingType,
  MotionLayer,
  MotionProject,
  MotionScene,
  Transform,
} from "../types/motion";
import { isLayerVisibleAt } from "../types/motion";
import type { GradientFill } from "../motion/gradients/gradientTypes";
import type { ShadowEffect } from "../motion/shadowfx/shadowTypes";
import { lineHeight, wrapTextToLines } from "../motion/textWrap";
import { resolveConnectorEndpoints } from "../motion/connectorGeometry";
import { Connector } from "../motion/connector/Connector";
import type { ConnectorSpec } from "../motion/connector/ConnectorTypes";

function applyEasing(p: number, easing: EasingType): number {
  switch (easing) {
    case "linear":
      return p;
    case "ease_in":
      return p * p;
    case "ease_out":
      return p * (2 - p);
    case "ease_in_out":
      return p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    case "bounce": {
      let x = p;
      const n1 = 7.5625;
      const d1 = 2.75;
      if (x < 1 / d1) {
        return n1 * x * x;
      } else if (x < 2 / d1) {
        return n1 * (x -= 1.5 / d1) * x + 0.75;
      } else if (x < 2.5 / d1) {
        return n1 * (x -= 2.25 / d1) * x + 0.9375;
      } else {
        return n1 * (x -= 2.625 / d1) * x + 0.984375;
      }
    }
    case "elastic": {
      if (p === 0) return 0;
      if (p === 1) return 1;
      return -Math.pow(2, 10 * (p - 1)) * Math.sin(((p - 1) - 0.075) * ((2 * Math.PI) / 0.3));
    }
    default:
      return p;
  }
}

function evaluateProperty(layer: MotionLayer, prop: AnimatableProperty, timeMs: number): number {
  const baseValue = layer.transform[prop];
  const keyframes = (layer.keyframes || [])
    .filter((k) => k.property === prop)
    .sort((a, b) => a.time_ms - b.time_ms);

  if (keyframes.length === 0) return baseValue;
  if (timeMs <= keyframes[0].time_ms) return keyframes[0].value;
  if (timeMs >= keyframes[keyframes.length - 1].time_ms) return keyframes[keyframes.length - 1].value;

  for (let i = 0; i < keyframes.length - 1; i++) {
    const k1 = keyframes[i];
    const k2 = keyframes[i + 1];
    if (timeMs >= k1.time_ms && timeMs <= k2.time_ms) {
      const dur = k2.time_ms - k1.time_ms;
      if (dur === 0) return k2.value;
      const p = (timeMs - k1.time_ms) / dur;
      const eased = applyEasing(p, k2.easing || "ease_in_out");
      return k1.value + (k2.value - k1.value) * eased;
    }
  }
  return baseValue;
}

function getEvaluatedTransform(layer: MotionLayer, timeMs: number): Transform {
  return {
    x: evaluateProperty(layer, "x", timeMs),
    y: evaluateProperty(layer, "y", timeMs),
    width: evaluateProperty(layer, "width", timeMs),
    height: evaluateProperty(layer, "height", timeMs),
    rotation: evaluateProperty(layer, "rotation", timeMs),
    opacity: evaluateProperty(layer, "opacity", timeMs),
  };
}

/**
 * Per-layer gradient <defs>. The id is namespaced by layer id (`{id}-fill`)
 * so the gradient is reachable via `url(#id-fill)` from that layer's shape
 * without colliding with gradients on sibling layers. Angle is converted to
 * SVG userSpace coordinates with the gradient vector at the layer's local
 * origin (0..width for linear; center for radial) — applied in the
 * parent <g>'s transform so it rotates with the layer.
 */
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
  // Linear: SVG's linearGradient x1/y1/x2/y2 are normalized to the bounding
  // box (0..1) by default, so the gradient stays locked to the shape's rect
  // regardless of how the parent's <g transform> scales the layer.
  // angle_deg follows the CSS convention (0 = up, increasing clockwise) so
  // this matches GradientPicker's `linear-gradient(${angle_deg}deg, …)`
  // preview. Using SVG's own convention here instead (dx=cos, dy=sin, i.e.
  // 0deg = to the right) makes the picker disagree with the canvas by 90
  // degrees — verified in a browser, so don't "simplify" it back.
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

/**
 * Per-layer drop-shadow / glow <filter>. feDropShadow's stdDeviation drives
 * the blur radius; offset is x/y; flood-color + flood-opacity drives the
 * shadow tint and intensity. glow=true centers the offset (0,0) so the same
 * struct renders as a centered glow rather than a directional drop shadow.
 */
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

/** Compute the fill value for a layer — either the gradient url (if set) or
 *  the shape's plain solid fill. */
function resolveFill(
  layer: MotionLayer,
  solidFill: string,
): string {
  if (layer.gradient) return `url(#${layer.id}-fill)`;
  return solidFill;
}

function renderLayer(layer: MotionLayer, timeMs: number, sceneDurationMs: number) {
  if (layer.hidden) return null;
  // Same scene-time visibility gate as the editor canvas. This has to match
  // MotionCanvas exactly or the export shows layers the editor didn't.
  if (!isLayerVisibleAt(layer, sceneDurationMs, timeMs)) return null;
  const t = getEvaluatedTransform(layer, timeMs);
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
    const anchor = layer.text.align === "center" ? "middle" : layer.text.align === "right" ? "end" : "start";
    const anchorX = layer.text.align === "center" ? t.width / 2 : layer.text.align === "right" ? t.width : 0;
    // Wrap to the box width using the SAME estimator as MotionCanvas.tsx so
    // the export and the editor break at the same points. See textWrap.ts
    // for why this is deterministic rather than a getComputedTextLength /
    // canvas measureText pass (Playwright + screenshot handshake = no).
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
    } else if (layer.type === "video" && layer.video) {
      // Frame-accurate video export. The data-* attributes below are read back
      // by the seek effect in RenderFrame (it works off the DOM rather than the
      // scene graph, since it has to address the real <video> elements), which
      // seeks every video to this frame's source time and only then publishes
      // data-render-time for Playwright to screenshot on.
      //
      // preload="auto" (not "metadata") because metadata alone doesn't
      // guarantee seekable media data, and no autoPlay/loop — this element's
      // time is owned by the render handshake, not the browser's clock.
      shape = layer.video.source_url ? (
        <foreignObject width={t.width} height={t.height}>
          <video
            src={resolveMotionAssetUrl(layer.video.source_url)}
            muted
            preload="auto"
            data-trim-start={layer.video.trim_start_ms}
            data-trim-end={layer.video.trim_end_ms}
            data-playback-rate={layer.video.playback_rate}
            data-visible-start={layer.visible_start_ms ?? 0}
            style={{
              width: "100%",
              height: "100%",
              objectFit: layer.video.fit === "cover" ? "cover" : layer.video.fit === "fill" ? "fill" : "contain",
            }}
          />
        </foreignObject>
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

    // Wrap the shape in a filter group when shadow is set, so feDropShadow
  // applies before the parent's transform/opacity group composites it.
  const filteredShape = layer.shadow ? (
    <g filter={`url(#${layer.id}-shadow)`}>{shape}</g>
  ) : (
    shape
  );

  return (
    <g key={layer.id} transform={groupTransform} opacity={t.opacity}>
      {filteredShape}
    </g>
  );
}

export function RenderFrame() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const sceneId = searchParams.get("scene");
  const initialTimeMs = parseInt(searchParams.get("t") || "0", 10);

  const [requestedTimeMs, setRequestedTimeMs] = useState(initialTimeMs);
  const [readyTimeMs, setReadyTimeMs] = useState<number | null>(null);
  const [project, setProject] = useState<MotionProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    (window as any).__setRenderTime = (ms: number) => {
      setRequestedTimeMs(ms);
    };
    return () => {
      delete (window as any).__setRenderTime;
    };
  }, []);

  useEffect(() => {
    if (!ready || !project) return;
    
    generationRef.current += 1;
    const currentGen = generationRef.current;

    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) {
      setReadyTimeMs(requestedTimeMs);
      return;
    }

    const seekPromises = videos.map((video) => {
      return new Promise<void>((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn("Video seek timed out for", video.src);
            resolve();
          }
        }, 500);

        const onDone = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            video.removeEventListener("seeked", onDone);
            resolve();
          }
        };

        const trimStart = parseFloat(video.getAttribute("data-trim-start") || "0");
        const trimEnd = parseFloat(video.getAttribute("data-trim-end") || "0");
        const playbackRate = parseFloat(video.getAttribute("data-playback-rate") || "1");
        const visibleStart = parseFloat(video.getAttribute("data-visible-start") || "0");

        let targetTime_s = (trimStart + (requestedTimeMs - visibleStart) * playbackRate) / 1000;
        if (trimEnd > 0) {
          targetTime_s = Math.min(targetTime_s, trimEnd / 1000);
        }

        if (Math.abs(video.currentTime - targetTime_s) > 0.01) {
          video.addEventListener("seeked", onDone);
          video.currentTime = targetTime_s;
        } else {
          onDone();
        }
      });
    });

    Promise.all(seekPromises).then(() => {
      if (generationRef.current === currentGen) {
        setReadyTimeMs(requestedTimeMs);
      }
    });

  }, [requestedTimeMs, ready, project]);

  useEffect(() => {
    if (!projectId) return;
    getMotionProject(projectId)
      .then((proj) => {
        setProject(proj);
        setReady(true);
      })
      .catch((err) => {
        setError(String(err));
        setReady(true);
      });
  }, [projectId]);

  if (error) {
    return (
      <div id="render-frame-root" data-render-ready="true" className="w-screen h-screen bg-black text-red-500 p-4">
        {error}
      </div>
    );
  }

  if (!project || !ready) {
    return <div id="render-frame-root" data-render-ready="false" className="w-screen h-screen bg-black" />;
  }

  const scene: MotionScene | undefined = sceneId
    ? project.scenes.find((s) => s.id === sceneId)
    : project.scenes[0];

  if (!scene) {
    return (
      <div id="render-frame-root" data-render-ready="true" className="w-screen h-screen bg-black text-red-500 p-4">
        Scene not found
      </div>
    );
  }

  const isTransparent = searchParams.get("transparent") === "true" || searchParams.get("transparent") === "1";
  const bgColor = isTransparent ? "transparent" : scene.background_color;

  return (
    <div
      id="render-frame-root"
      data-render-ready="true"
      data-render-time={readyTimeMs !== null ? readyTimeMs : ""}
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        backgroundColor: bgColor,
        margin: 0,
        padding: 0,
      }}
    >
      <svg
        width={scene.width}
        height={scene.height}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {!isTransparent && <rect width={scene.width} height={scene.height} fill={scene.background_color} />}
        <defs>
          {scene.layers.map((layer) => (
            <Fragment key={`defs-${layer.id}`}>
              {layer.gradient ? renderGradientDef(layer.id, layer.gradient) : null}
              {layer.shadow ? renderShadowFilter(layer.id, layer.shadow) : null}
            </Fragment>
          ))}
        </defs>
        {scene.layers.map((layer) => renderLayer(layer, requestedTimeMs, scene.duration_ms))}
        {/* Connectors, drawn after the layers so they sit on top — identical
            to MotionCanvas.tsx. Without this block connectors are visible in
            the editor and ABSENT from the export, which is the canvas/export
            divergence that has bitten this project repeatedly (video poster
            frames, gradient angles, text wrapping). Endpoints resolve from
            the layers' transforms at requestedTimeMs, so an animated layer
            drags its connectors along in the exported frames too. */}
        {(scene.connectors ?? []).map((conn) => {
          const resolved = resolveConnectorEndpoints(conn, scene.layers, requestedTimeMs);
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
          return <Connector key={conn.id} spec={spec} currentTime={requestedTimeMs} />;
        })}
      </svg>
    </div>
  );
}
