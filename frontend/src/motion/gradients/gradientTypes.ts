/**
 * Draft proposal for gradient fill support in Motion Studio.
 * This file is a proposal and is not yet wired into types/motion.ts.
 */

export interface GradientStop {
  /** Stop offset from 0.0 to 1.0 */
  offset: number;
  /** Stop color in hex */
  color: string;
}

export interface GradientFill {
  /** Gradient type: linear or radial */
  type: "linear" | "radial";
  /** Angle in degrees (used only for linear gradients) */
  angle_deg: number;
  /** Color stops (must have at least 2 stops) */
  stops: GradientStop[];
}

/**
 * Proposed extensions to existing types:
 *
 * interface RectLayerProps {
 *   // ... existing fields ...
 *   gradient: GradientFill | null;
 * }
 *
 * interface EllipseLayerProps {
 *   // ... existing fields ...
 *   gradient: GradientFill | null;
 * }
 */
