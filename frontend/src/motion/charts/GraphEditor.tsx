import { useRef, useState, useMemo } from "react";
import type { MotionLayer, AnimatableProperty, Keyframe } from "../../types/motion";
import { resolveTransformAtTime } from "../easing";

interface GraphEditorProps {
  layer: MotionLayer;
  pxPerSec: number;
  durationMs: number;
  onUpdateKeyframe: (layerId: string, keyframeId: string, patch: Partial<Keyframe>) => void;
  onSelectKeyframe?: (layerId: string, keyframeId: string) => void;
}

const TRACK_HEIGHT = 120;
const PADDING_Y = 20;

export function GraphEditor({ layer, pxPerSec, durationMs, onUpdateKeyframe, onSelectKeyframe }: GraphEditorProps) {
  const supportedProps: AnimatableProperty[] = ["x", "y", "opacity"];
  const animatedProps = supportedProps.filter(p => layer.keyframes.some(k => k.property === p));

  if (animatedProps.length === 0) {
    return (
      <div className="text-xs text-text-faint p-4 text-center">
        No animated position or opacity properties on this layer. Add keyframes in the Inspector to see them here.
      </div>
    );
  }

  return (
    <div className="flex flex-col relative w-full border-t border-border/50">
      {animatedProps.map(prop => (
        <PropertyGraphTrack
          key={prop}
          layer={layer}
          property={prop}
          pxPerSec={pxPerSec}
          durationMs={durationMs}
          onUpdateKeyframe={onUpdateKeyframe}
          onSelectKeyframe={onSelectKeyframe}
        />
      ))}
    </div>
  );
}

interface PropertyGraphTrackProps {
  layer: MotionLayer;
  property: AnimatableProperty;
  pxPerSec: number;
  durationMs: number;
  onUpdateKeyframe: (layerId: string, keyframeId: string, patch: Partial<Keyframe>) => void;
  onSelectKeyframe?: (layerId: string, keyframeId: string) => void;
}

function PropertyGraphTrack({ layer, property, pxPerSec, durationMs, onUpdateKeyframe, onSelectKeyframe }: PropertyGraphTrackProps) {
  const trackRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<{ keyframeId: string; startMs: number; startVal: number; startX: number; startY: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; timeMs: number; value: number } | null>(null);

  const keyframes = useMemo(() => layer.keyframes.filter(k => k.property === property).sort((a, b) => a.time_ms - b.time_ms), [layer.keyframes, property]);

  // Determine Y scale
  const { min, max } = useMemo(() => {
    if (property === "opacity") return { min: 0, max: 1 };
    let cMin = Infinity, cMax = -Infinity;
    // Sample the curve to find min/max (accounts for bounce/overshoot)
    if (keyframes.length === 0) return { min: 0, max: 100 };
    for (let t = 0; t <= durationMs; t += 33) {
      const v = resolveTransformAtTime(layer, t)[property];
      if (v < cMin) cMin = v;
      if (v > cMax) cMax = v;
    }
    // Also check keyframe exact values just in case
    keyframes.forEach(k => {
      if (k.value < cMin) cMin = k.value;
      if (k.value > cMax) cMax = k.value;
    });
    if (cMin === cMax) {
      cMin -= 50;
      cMax += 50;
    }
    const range = cMax - cMin;
    return { min: cMin - range * 0.1, max: cMax + range * 0.1 };
  }, [layer, property, keyframes, durationMs]);

  const msToPx = (ms: number) => (ms / 1000) * pxPerSec;
  const pxToMs = (px: number) => (px / pxPerSec) * 1000;
  
  const drawHeight = TRACK_HEIGHT - PADDING_Y * 2;
  const valToPx = (val: number) => {
    const range = max - min;
    const fraction = range === 0 ? 0.5 : (val - min) / range;
    return TRACK_HEIGHT - PADDING_Y - fraction * drawHeight;
  };
  
  const pxToVal = (py: number) => {
    const fraction = (TRACK_HEIGHT - PADDING_Y - py) / drawHeight;
    return min + fraction * (max - min);
  };

  // Generate curve path
  const pathData = useMemo(() => {
    if (keyframes.length < 2) return "";
    let d = "";
    
    // For drag preview, we simulate the curve with the new keyframe position
    const previewLayer = { ...layer, keyframes: [...layer.keyframes] };
    if (dragPreview) {
      const idx = previewLayer.keyframes.findIndex(k => k.id === dragPreview.id);
      if (idx !== -1) {
        previewLayer.keyframes[idx] = { ...previewLayer.keyframes[idx], time_ms: dragPreview.timeMs, value: dragPreview.value };
      }
    }
    
    // Sort keyframes in preview
    const previewKfs = previewLayer.keyframes.filter(k => k.property === property).sort((a, b) => a.time_ms - b.time_ms);
    if (previewKfs.length < 2) return "";
    const firstTime = previewKfs[0].time_ms;
    const lastTime = previewKfs[previewKfs.length - 1].time_ms;

    let started = false;
    for (let t = firstTime; t <= lastTime; t += 33) {
      const v = resolveTransformAtTime(previewLayer, t)[property];
      const px = msToPx(t);
      const py = valToPx(v);
      if (!started) {
        d += `M${px},${py} `;
        started = true;
      } else {
        d += `L${px},${py} `;
      }
    }
    const endV = resolveTransformAtTime(previewLayer, lastTime)[property];
    d += `L${msToPx(lastTime)},${valToPx(endV)}`;
    return d;
  }, [layer, property, dragPreview, min, max, msToPx, valToPx]);

  function handlePointerDown(e: React.PointerEvent, kf: Keyframe) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      keyframeId: kf.id,
      startMs: kf.time_ms,
      startVal: kf.value,
      startX: e.clientX,
      startY: e.clientY,
    };
    setDragPreview({ id: kf.id, timeMs: kf.time_ms, value: kf.value });
    onSelectKeyframe?.(layer.id, kf.id);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag || !trackRef.current) return;
    const dxPx = e.clientX - drag.startX;
    const dyPx = e.clientY - drag.startY;
    
    const newMs = Math.max(0, drag.startMs + pxToMs(dxPx));
    const startPy = valToPx(drag.startVal);
    const newPy = startPy + dyPx;
    let newVal = pxToVal(newPy);
    
    if (property === "opacity") {
      newVal = Math.max(0, Math.min(1, newVal));
    }
    
    setDragPreview({ id: drag.keyframeId, timeMs: newMs, value: newVal });
  }

  function handlePointerUp(e: React.PointerEvent) {
    const drag = dragState.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragState.current = null;
    if (dragPreview) {
      // Don't update if it hasn't moved
      if (dragPreview.timeMs !== drag.startMs || dragPreview.value !== drag.startVal) {
        onUpdateKeyframe(layer.id, drag.keyframeId, { 
          time_ms: Math.round(dragPreview.timeMs), 
          value: property === "opacity" ? Math.round(dragPreview.value * 100) / 100 : Math.round(dragPreview.value) 
        });
      }
    }
    setDragPreview(null);
  }

  const width = Math.max(600, msToPx(durationMs) + 40);

  const colors = {
    x: "#EF4444",
    y: "#10B981",
    opacity: "#3B82F6"
  };
  const color = colors[property as keyof typeof colors] || "#8B5CF6";

  return (
    <div className="relative border-b border-border/50 group bg-surface/30 hover:bg-surface-hover/30" style={{ height: TRACK_HEIGHT }}>
      {/* Label */}
      <div className="absolute left-2 top-2 z-20 pointer-events-none">
        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded shadow-sm bg-background border border-border" style={{ color }}>
          {property}
        </span>
      </div>
      
      {/* Min/Max values display */}
      <div className="absolute left-2 bottom-2 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[9px] text-text-faint bg-background/80 px-1 rounded">Range: {min.toFixed(1)} to {max.toFixed(1)}</span>
      </div>

      <div className="absolute top-0 bottom-0 overflow-visible" style={{ width }}>
        <svg ref={trackRef} className="absolute inset-0 overflow-visible" width={width} height={TRACK_HEIGHT}>
          {/* Zero line if visible */}
          {min < 0 && max > 0 && (
            <line x1={0} y1={valToPx(0)} x2={width} y2={valToPx(0)} stroke="currentColor" className="text-border" strokeWidth={1} strokeDasharray="4 4" />
          )}
          
          {/* Interpolated curve */}
          {pathData && (
            <path
              d={pathData}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={dragPreview ? 0.6 : 0.9}
            />
          )}

          {/* Keyframe points */}
          {keyframes.map(kf => {
            const isDragging = dragPreview?.id === kf.id;
            const ms = isDragging ? dragPreview.timeMs : kf.time_ms;
            const val = isDragging ? dragPreview.value : kf.value;
            const cx = msToPx(ms);
            const cy = valToPx(val);
            
            return (
              <g
                key={kf.id}
                onPointerDown={(e) => handlePointerDown(e, kf)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="cursor-move outline-none"
              >
                {/* Larger invisible hit area */}
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                {/* Visible point */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={isDragging ? "#FFF" : color}
                  stroke="#FFF"
                  strokeWidth={1.5}
                  className="transition-colors"
                />
                <text x={cx} y={cy - 10} textAnchor="middle" fill="currentColor" className="text-[10px] text-text-muted select-none pointer-events-none">
                  {val.toFixed(property === "opacity" ? 2 : 0)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
