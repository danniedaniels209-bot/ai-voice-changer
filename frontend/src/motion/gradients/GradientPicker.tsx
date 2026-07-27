import type { GradientFill, GradientStop } from "./gradientTypes";

export interface GradientPickerProps {
  value: GradientFill;
  onChange: (g: GradientFill) => void;
  className?: string;
}

export function GradientPicker({ value, onChange, className = "" }: GradientPickerProps) {
  const handleTypeChange = (type: "linear" | "radial") => {
    onChange({ ...value, type });
  };

  const handleAngleChange = (angle_deg: number) => {
    onChange({ ...value, angle_deg });
  };

  const handleStopChange = (index: number, updates: Partial<GradientStop>) => {
    const newStops = [...value.stops];
    newStops[index] = { ...newStops[index], ...updates };
    // Maintain sorted order by offset for proper gradient rendering
    newStops.sort((a, b) => a.offset - b.offset);
    onChange({ ...value, stops: newStops });
  };

  const handleAddStop = () => {
    const newStops = [...value.stops, { offset: 0.5, color: "#ffffff" }];
    newStops.sort((a, b) => a.offset - b.offset);
    onChange({ ...value, stops: newStops });
  };

  const handleRemoveStop = (index: number) => {
    if (value.stops.length <= 2) return;
    const newStops = [...value.stops];
    newStops.splice(index, 1);
    onChange({ ...value, stops: newStops });
  };

  // Build a CSS background string for the preview block
  const cssGradient =
    value.type === "linear"
      ? `linear-gradient(${value.angle_deg}deg, ${value.stops
          .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
          .join(", ")})`
      : `radial-gradient(circle, ${value.stops
          .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
          .join(", ")})`;

  return (
    <div className={`flex flex-col h-full bg-surface border-l border-border ${className}`}>
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-text">Gradient Editor</h2>
        <p className="text-sm text-text-muted mt-1">Configure linear and radial gradient fills.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Preview Area */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-text-muted">Preview</label>
          <div
            className="w-full h-24 rounded-lg border border-border shadow-inner"
            style={{ background: cssGradient }}
          />
        </div>

        {/* Type & Angle */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-text-muted">Type</label>
            <div className="flex rounded-md shadow-sm border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => handleTypeChange("linear")}
                className={`flex-1 px-2 py-1.5 text-xs font-medium focus:outline-none transition-colors ${
                  value.type === "linear"
                    ? "bg-accent text-white"
                    : "bg-surface text-text hover:bg-surface-hover"
                }`}
              >
                Linear
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange("radial")}
                className={`flex-1 px-2 py-1.5 text-xs font-medium focus:outline-none transition-colors border-l border-border ${
                  value.type === "radial"
                    ? "bg-accent text-white"
                    : "bg-surface text-text hover:bg-surface-hover"
                }`}
              >
                Radial
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-text-muted">Angle (deg)</label>
            <input
              type="number"
              value={value.angle_deg}
              onChange={(e) => handleAngleChange(Number(e.target.value))}
              disabled={value.type !== "linear"}
              className="w-full bg-surface-hover border border-border text-text text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>
        </div>

        {/* Color Stops */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-text-muted">Color Stops</label>
            <button
              onClick={handleAddStop}
              className="text-xs font-medium text-accent hover:text-accent/80 transition-colors focus:outline-none"
            >
              + Add Stop
            </button>
          </div>

          <div className="space-y-2">
            {value.stops.map((stop, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 bg-surface-hover border border-border rounded-md"
              >
                {/* Color input */}
                <input
                  type="color"
                  value={stop.color}
                  onChange={(e) => handleStopChange(idx, { color: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border-0 p-0 focus:outline-none focus:ring-2 focus:ring-accent"
                />

                {/* Offset slider */}
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={stop.offset}
                  onChange={(e) => handleStopChange(idx, { offset: Number(e.target.value) })}
                  className="flex-1 h-2 bg-border rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
                />

                {/* Offset number input */}
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={stop.offset}
                  onChange={(e) => handleStopChange(idx, { offset: Number(e.target.value) })}
                  className="w-16 bg-surface border border-border text-text text-xs rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent text-right"
                />
                
                {/* Remove button */}
                <button
                  onClick={() => handleRemoveStop(idx)}
                  disabled={value.stops.length <= 2}
                  className="p-1.5 text-text-faint hover:text-red-500 disabled:opacity-30 disabled:hover:text-text-faint transition-colors focus:outline-none"
                  title="Remove stop"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
