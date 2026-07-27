import type { ReactElement } from "react";
import type { MotionLayer } from "../../types/motion";
import { DEVICE_FRAME_DEFINITIONS, type DeviceFrameDef } from "./deviceFrames";

export interface DeviceFramePickerProps {
  onInsert: (layers: MotionLayer[]) => void;
  className?: string;
  title?: string;
}

const DEFAULT_X = 120;
const DEFAULT_Y = 120;
const DEFAULT_CONTENT_WIDTH = 360;
const DEFAULT_CONTENT_HEIGHT = 220;

function PhonePreview() {
  return (
    <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
      <rect x={22} y={3} width={20} height={42} rx={5} fill="#111827" />
      <rect x={24} y={8} width={16} height={30} rx={2} fill="none" stroke="#FFFFFF" strokeWidth={2} />
      <rect x={29} y={6} width={6} height={1.5} rx={0.75} fill="#374151" />
      <rect x={28} y={40} width={8} height={1.5} rx={0.75} fill="#374151" />
    </svg>
  );
}

function LaptopPreview() {
  return (
    <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
      <rect x={12} y={7} width={40} height={27} rx={2} fill="#111827" />
      <rect x={15} y={10} width={34} height={20} fill="none" stroke="#FFFFFF" strokeWidth={2} />
      <rect x={6} y={36} width={52} height={5} rx={2.5} fill="#E5E7EB" stroke="#9CA3AF" />
    </svg>
  );
}

function BrowserPreview() {
  return (
    <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
      <rect x={8} y={8} width={48} height={32} rx={3} fill="#E5E7EB" stroke="#9CA3AF" />
      <rect x={10} y={19} width={44} height={19} fill="none" stroke="#FFFFFF" strokeWidth={2} />
      <circle cx={13} cy={13} r={1.3} fill="#EF4444" />
      <circle cx={18} cy={13} r={1.3} fill="#F59E0B" />
      <circle cx={23} cy={13} r={1.3} fill="#059669" />
      <rect x={29} y={11} width={22} height={4} rx={2} fill="#FFFFFF" />
    </svg>
  );
}

function TabletPreview() {
  return (
    <svg viewBox="0 0 64 48" width="100%" height="100%" aria-hidden>
      <rect x={9} y={6} width={46} height={36} rx={5} fill="#111827" />
      <rect x={14} y={11} width={36} height={26} fill="none" stroke="#FFFFFF" strokeWidth={2} />
      <circle cx={32} cy={9} r={1.2} fill="#374151" />
    </svg>
  );
}

const PREVIEWS: Record<string, () => ReactElement> = {
  phone: PhonePreview,
  laptop: LaptopPreview,
  browser: BrowserPreview,
  tablet: TabletPreview,
};

function buildDefaultFrame(frame: DeviceFrameDef) {
  return frame.build(DEFAULT_X, DEFAULT_Y, DEFAULT_CONTENT_WIDTH, DEFAULT_CONTENT_HEIGHT);
}

export function DeviceFramePicker({
  onInsert,
  className = "",
  title = "Device Frames",
}: DeviceFramePickerProps) {
  return (
    <div className={`border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {DEVICE_FRAME_DEFINITIONS.map((frame) => {
          const Preview = PREVIEWS[frame.id];
          return (
            <button
              key={frame.id}
              type="button"
              onClick={() => onInsert(buildDefaultFrame(frame))}
              className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-1 py-2 transition-colors hover:border-accent hover:bg-accent-dim"
              title={`Insert ${frame.label.toLowerCase()}`}
            >
              <span className="mb-1 flex h-12 w-16 items-center justify-center">
                <Preview />
              </span>
              <span className="text-center text-[10px] leading-tight text-text-muted">
                {frame.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
