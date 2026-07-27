import type { ConnectorSpec } from "./ConnectorTypes";

const ANIM_DURATION = 2000; // ms for one full loop

function buildPath(spec: ConnectorSpec): { d: string; length: number } {
  const { from, to, style } = spec;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;

  switch (style) {
    case "straight": {
      const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
      return { d, length: Math.hypot(dx, dy) };
    }
    case "curved": {
      const offset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.4 + 30;
      const cx = mx;
      const cy = my - offset;
      const d = `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
      const approx = Math.hypot(dx, dy) * 1.2;
      return { d, length: approx };
    }
    case "orthogonal": {
      const edgeX = mx;
      const d = `M ${from.x} ${from.y} L ${edgeX} ${from.y} L ${edgeX} ${to.y} L ${to.x} ${to.y}`;
      return { d, length: Math.abs(dx) + Math.abs(dy) };
    }
    case "bezier": {
      const cpOffset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.5 + 40;
      const d =
        `M ${from.x} ${from.y}` +
        ` C ${from.x} ${my - cpOffset} ${to.x} ${my + cpOffset} ${to.x} ${to.y}`;
      const approx = Math.hypot(dx, dy) * 1.4;
      return { d, length: approx };
    }
  }
}

function getPointOnPath(pathEl: SVGPathElement, fraction: number): { x: number; y: number } | null {
  const len = pathEl.getTotalLength();
  if (len === 0) return null;
  const pt = pathEl.getPointAtLength(fraction * len);
  return { x: pt.x, y: pt.y };
}

export function Connector({ spec, currentTime }: { spec: ConnectorSpec; currentTime: number }) {
  const { d } = buildPath(spec);
  const {
    strokeColor = "#888",
    strokeWidth = 2,
    dashPattern,
    animated = false,
  } = spec;

  const pathRef = (el: SVGPathElement | null) => {
    // ref is used only when animated (to sample getPointAtLength)
    if (!animated) return;
    if (!el) return;

    const t = ((currentTime % ANIM_DURATION) + ANIM_DURATION) % ANIM_DURATION;
    const headFraction = t / ANIM_DURATION;
    const tailFraction = Math.max(0, headFraction - 0.12);

    const head = getPointOnPath(el, headFraction);
    const tail = getPointOnPath(el, tailFraction);
    if (!head || !tail) return;

    // Update dot/arrow positions via data attributes — read by the rendering loop
    const dot = el.ownerSVGElement?.querySelector(".connector-anim-dot") as SVGGElement | null;
    const arrow = el.ownerSVGElement?.querySelector(".connector-anim-arrow") as SVGGElement | null;

    if (dot) {
      dot.setAttribute("transform", `translate(${head.x},${head.y})`);
    }

    if (arrow && dot) {
      const angle = Math.atan2(head.y - tail.y, head.x - tail.x) * (180 / Math.PI);
      arrow.setAttribute("transform", `translate(${head.x},${head.y}) rotate(${angle})`);
    }
  };

  return (
    <g>
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={dashPattern ?? "none"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {animated && (
        <g>
          <circle
            className="connector-anim-dot"
            r={Math.max(3, strokeWidth + 1)}
            fill={strokeColor}
          />
          <g className="connector-anim-arrow">
            <polygon
              points="0,-4 8,0 0,4"
              fill={strokeColor}
            />
          </g>
        </g>
      )}
    </g>
  );
}
