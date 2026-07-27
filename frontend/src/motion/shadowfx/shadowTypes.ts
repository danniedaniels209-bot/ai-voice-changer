export interface ShadowEffect {
  color: string;
  blur: number;
  offset_x: number;
  offset_y: number;
  opacity: number;
  glow: boolean;
}

export const DEFAULT_SHADOW_EFFECT: ShadowEffect = {
  color: "#000000",
  blur: 16,
  offset_x: 0,
  offset_y: 8,
  opacity: 0.35,
  glow: false,
};

export const DEFAULT_GLOW_EFFECT: ShadowEffect = {
  color: "#4F46E5",
  blur: 24,
  offset_x: 0,
  offset_y: 0,
  opacity: 0.6,
  glow: true,
};
