/**
 * Cubic bezier curve editor — the standard two-control-point widget used in
 * every animation tool (After Effects, Figma, CSS cubic-bezier()). The user
 * drags two handles inside a unit square; the curved line shows the resulting
 * easing function.
 *
 * Pure React component. No external deps — just SVG + pointer events.
 */

import { useCallback, useRef } from "react";

export interface CubicBezierEditorProps {
  /** The four control values: [x1, y1, x2, y2]. All in [0, 1]. */
  value: [number, number, number, number];
  /** Called when the user moves a handle. */
  onChange: (bezier: [number, number, number, number]) => void;
  /** Canvas size in px. Default 200. */
  size?: number;
}

/** Draw the cubic bezier curve as an SVG `<path>`, in PIXEL coordinates.
 *
 *  Emitting pixels rather than unit coordinates plus a scale transform: the
 *  vertical axis spans [-0.5, 1.5] (see snapY) while the horizontal spans
 *  [0, 1], so there is no single uniform scale that maps both. A transform
 *  would also multiply the stroke width.
 *
 *  Approximates with 60 linear segments — plenty for a widget-sized curve. */
function curvePath(
  x1: number, y1: number, x2: number, y2: number, size: number,
): string {
  const pt = (t: number) => {
    const u = 1 - t;
    const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    const y = 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    return `${(x * size).toFixed(3)},${yToPx(y, size).toFixed(3)}`;
  };
  let d = `M${pt(0)} `;
  for (let i = 1; i <= 60; i++) d += `L${pt(i / 60)} `;
  return d;
}

/** X is clamped to [0, 1] — outside that the curve stops being a function of
 *  progress. */
function snapX(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

/** Y is allowed OUTSIDE [0, 1], because that is what produces overshoot
 *  (y > 1, sails past the target and settles) and anticipation (y < 0, pulls
 *  back before moving). Clamping y to the box would make every custom curve a
 *  plain ease and remove the reason to have this widget at all. Bounded to
 *  [-0.5, 1.5] so the handles stay reachable inside the drawn area. */
function snapY(v: number): number {
  return Math.round(Math.min(1.5, Math.max(-0.5, v)) * 100) / 100;
}

/** The widget draws y over [-0.5, 1.5] but the unit square over [0, 1], so
 *  everything vertical goes through this to land in the right pixel. */
const Y_RANGE = 2;
const yToPx = (y: number, size: number) => ((1.5 - y) / Y_RANGE) * size;
const pxToY = (py: number, size: number) => 1.5 - (py / size) * Y_RANGE;

export function CubicBezierEditor({ value, onChange, size = 200 }: CubicBezierEditorProps) {
  const [x1, y1, x2, y2] = value;
  const widgetRef = useRef<HTMLDivElement>(null);
  // Track which handle is being dragged, if any.
  const draggingRef = useRef<1 | 2 | null>(null);

  const pointerMove = useCallback(
    (e: PointerEvent) => {
      const target = widgetRef.current;
      if (!target || draggingRef.current === null) return;
      const rect = target.getBoundingClientRect();
      // Mouse position as fraction [0, 1] within the unit square.
      const px = snapX((e.clientX - rect.left) / rect.width);
      const py = snapY(pxToY(e.clientY - rect.top, rect.height));
      if (draggingRef.current === 1) {
        onChange([px, py, x2, y2]);
      } else {
        onChange([x1, y1, px, py]);
      }
    },
    [x1, y1, x2, y2, onChange],
  );

  const pointerUp = useCallback(() => {
    draggingRef.current = null;
    document.removeEventListener("pointermove", pointerMove);
    document.removeEventListener("pointerup", pointerUp);
  }, [pointerMove]);

  const startDrag = useCallback(
    (handle: 1 | 2) => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
      draggingRef.current = handle;
      document.addEventListener("pointermove", pointerMove);
      document.addEventListener("pointerup", pointerUp);
    },
    [pointerMove, pointerUp],
  );

  const path = curvePath(x1, y1, x2, y2, size);
  const handle1X = x1 * size;
  const handle1Y = yToPx(y1, size);
  const handle2X = x2 * size;
  const handle2Y = yToPx(y2, size);
  // Where y=0 and y=1 fall in pixels — the curve's real start and end, and
  // the band the animation travels between.
  const zeroY = yToPx(0, size);
  const oneY = yToPx(1, size);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={widgetRef}
        className="relative bg-surface border border-border rounded-lg select-none touch-none"
        style={{ width: size, height: size, cursor: "crosshair" }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          {/* The 0..1 band. Anything the curve does ABOVE the top line is
              overshoot; below the bottom line is anticipation. Drawing the
              band makes that legible instead of mysterious. */}
          <rect
            x={0}
            y={oneY}
            width={size}
            height={zeroY - oneY}
            fill="var(--color-accent, #8B5CF6)"
            opacity={0.06}
          />
          <line x1={0} y1={zeroY} x2={size} y2={zeroY} stroke="var(--color-border, #333)" strokeWidth={1} opacity={0.5} />
          <line x1={0} y1={oneY} x2={size} y2={oneY} stroke="var(--color-border, #333)" strokeWidth={1} opacity={0.5} />
          {/* Handle connector lines, anchored at the real start/end points */}
          <line
            x1={0}
            y1={zeroY}
            x2={handle1X}
            y2={handle1Y}
            stroke="var(--color-accent, #8B5CF6)"
            strokeWidth={1.5}
            opacity={0.5}
          />
          <line
            x1={size}
            y1={oneY}
            x2={handle2X}
            y2={handle2Y}
            stroke="var(--color-accent, #8B5CF6)"
            strokeWidth={1.5}
            opacity={0.5}
          />
          {/* The curve itself */}
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-accent"
            opacity={0.9}
          />
          {/* Start & end points */}
          <circle cx={0} cy={zeroY} r={3} fill="currentColor" className="text-text-muted" />
          <circle cx={size} cy={oneY} r={3} fill="currentColor" className="text-text-muted" />
          {/* Handle 1 */}
          <circle
            cx={handle1X}
            cy={handle1Y}
            r={5}
            fill="currentColor"
            className="text-accent cursor-grab"
            onPointerDown={startDrag(1)}
          />
          {/* Handle 2 */}
          <circle
            cx={handle2X}
            cy={handle2Y}
            r={5}
            fill="currentColor"
            className="text-accent cursor-grab"
            onPointerDown={startDrag(2)}
          />
        </svg>
      </div>
      {/* Readout of the four numbers, matching CSS cubic-bezier */}
      <p className="text-[10px] text-text-faint">
        cubic-bezier({x1.toFixed(2)}, {y1.toFixed(2)}, {x2.toFixed(2)}, {y2.toFixed(2)})
      </p>
    </div>
  );
}