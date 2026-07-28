
import { renderToStaticMarkup } from "react-dom/server";
import type { MotionLayer } from "../../types/motion";
import { newId } from "../state";
import { TECH_ICONS } from "./techIcons";

export interface TechIconLibraryPanelProps {
  onInsert: (layers: MotionLayer[]) => void;
  className?: string;
  title?: string;
}

const COLORS = {
  containerFill: "#FFFFFF",
  containerStroke: "#9CA3AF",
  iconColor: "#4F46E5",
};

/**
 * Builds a layer group for a tech icon.
 * Inserts a rounded container and an SVG image layer inside.
 */
function buildTechIconGroup(x: number, y: number, iconName: string): MotionLayer[] {
  const IconComp = TECH_ICONS[iconName];
  if (!IconComp) return [];
  
  // Render SVG to data URL
  const svgString = renderToStaticMarkup(<IconComp size={48} color={COLORS.iconColor} title={iconName} />);
  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
  
  const containerW = 96;
  const containerH = 96;
  const padding = 24;
  
  const container: MotionLayer = {
    id: newId(),
    name: `${iconName} box`,
    type: "rect",
    transform: { x, y, width: containerW, height: containerH, rotation: 0, opacity: 1 },
    locked: false,
    hidden: false,
    rect: {
      fill: COLORS.containerFill,
      corner_radius: 16,
      stroke_color: COLORS.containerStroke,
      stroke_width: 1,
    },
    ellipse: null,
    text: null,
    image: null,
    video: null,
    keyframes: [],
  };

  const image: MotionLayer = {
    id: newId(),
    name: `${iconName} icon`,
    type: "image",
    transform: { 
      x: x + padding, 
      y: y + padding, 
      width: containerW - padding * 2, 
      height: containerH - padding * 2, 
      rotation: 0, 
      opacity: 1 
    },
    locked: false,
    hidden: false,
    rect: null,
    ellipse: null,
    text: null,
    video: null,
    image: {
      src: dataUrl,
      fit: "contain"
    },
    keyframes: [],
  };

  return [container, image];
}

export function TechIconLibraryPanel({
  onInsert,
  className = "",
  title = "Tech Icons",
}: TechIconLibraryPanelProps) {
  const iconNames = Object.keys(TECH_ICONS);

  return (
    <div className={`tech-icon-library border border-border rounded-lg bg-surface p-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {iconNames.map((name) => {
          const IconComp = TECH_ICONS[name];
          return (
            <button
              key={name}
              type="button"
              onClick={() => onInsert(buildTechIconGroup(0, 0, name))}
              className="flex flex-col items-center justify-center rounded-md border border-border bg-background px-1 py-2
                         hover:bg-accent-dim hover:border-accent transition-colors"
              title={`Insert ${name} icon`}
            >
              <span className="h-8 w-8 mb-1 flex items-center justify-center text-text-muted">
                <IconComp size={24} color="currentColor" />
              </span>
              <span className="text-[10px] text-text-muted leading-tight text-center truncate w-full px-1">
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
