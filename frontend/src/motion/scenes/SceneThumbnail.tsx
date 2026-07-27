import type { MotionLayer, MotionScene, Transform } from "../../types/motion";

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
  };
}

function renderLayer(layer: MotionLayer): React.ReactNode {
  if (layer.hidden) return null;
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
    const anchor =
      layer.text.align === "center" ? "middle" : layer.text.align === "right" ? "end" : "start";
    const anchorX =
      layer.text.align === "center" ? t.width / 2 : layer.text.align === "right" ? t.width : 0;
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
  }

  return (
    <g key={layer.id} transform={groupTransform} opacity={t.opacity}>
      {shape}
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
        <rect width={sceneW} height={sceneH} fill={scene.background_color} />
        {scene.layers.map((layer) => renderLayer(layer))}
      </svg>
    </div>
  );
}
