import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getMotionProject } from "../api/motion";
import type {
  AnimatableProperty,
  EasingType,
  MotionLayer,
  MotionProject,
  MotionScene,
  Transform,
} from "../types/motion";

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

function renderLayer(layer: MotionLayer, timeMs: number) {
  if (layer.hidden) return null;
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
        fill={layer.rect.fill}
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
        fill={layer.ellipse.fill}
        stroke={layer.ellipse.stroke_width > 0 ? layer.ellipse.stroke_color : "none"}
        strokeWidth={layer.ellipse.stroke_width}
      />
    );
  } else if (layer.type === "text" && layer.text) {
    const anchor = layer.text.align === "center" ? "middle" : layer.text.align === "right" ? "end" : "start";
    const anchorX = layer.text.align === "center" ? t.width / 2 : layer.text.align === "right" ? t.width : 0;
    shape = (
      <text
        x={anchorX}
        y={layer.text.font_size}
        textAnchor={anchor}
        fontFamily={layer.text.font_family}
        fontSize={layer.text.font_size}
        fontWeight={layer.text.font_weight}
        fill={layer.text.color}
      >
        {layer.text.text}
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
    // KNOWN LIMITATION, not a silent gap: frame-accurate video-in-export
    // needs the <video> to seek to this exact frame's timestamp and wait
    // for its 'seeked' event before Playwright screenshots — otherwise the
    // captured frame can be stale or blank, which would be worse than an
    // honest placeholder. Until that seek/wait handshake is built into
    // render_service.py, exported frames show the video's poster/first
    // frame (still, not silently missing) rather than a wrong frame.
    shape = layer.video.source_url ? (
      <foreignObject width={t.width} height={t.height}>
        <video
          src={layer.video.source_url}
          muted
          preload="metadata"
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
  }

  return (
    <g key={layer.id} transform={groupTransform} opacity={t.opacity}>
      {shape}
    </g>
  );
}

export function RenderFrame() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const sceneId = searchParams.get("scene");
  const initialTimeMs = parseInt(searchParams.get("t") || "0", 10);

  const [currentTimeMs, setCurrentTimeMs] = useState(initialTimeMs);
  const [project, setProject] = useState<MotionProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (window as any).__setRenderTime = (ms: number) => {
      setCurrentTimeMs(ms);
    };
    return () => {
      delete (window as any).__setRenderTime;
    };
  }, []);

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
      data-render-time={currentTimeMs}
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
        {scene.layers.map((layer) => renderLayer(layer, currentTimeMs))}
      </svg>
    </div>
  );
}
