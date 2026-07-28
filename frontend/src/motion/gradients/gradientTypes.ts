/**
 * Gradient fill support for Motion Studio.
 *
 * MotionLayer.gradient (types/motion.ts, mirrored in motion_studio/models.py)
 * holds one of these per layer — on the layer rather than on each shape's
 * props, so a single gradient applies regardless of whether the layer is a
 * rect, ellipse, or text, and the renderers can emit one <defs> entry per
 * layer instead of one per shape type.
 *
 * `angle_deg` follows the CSS convention (0deg points up, increasing
 * clockwise) so GradientPicker's `linear-gradient(${angle_deg}deg, …)`
 * preview matches what the SVG renderers draw. The renderers convert it to
 * an SVG gradient vector with `dx = sin(rad), dy = -cos(rad)` — SVG's own
 * 0deg would be to the right, and using it directly makes the picker preview
 * disagree with the canvas by 90 degrees.
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
  /** Angle in degrees, CSS convention: 0 = up, increasing clockwise. Used
   *  only for linear gradients. */
  angle_deg: number;
  /** Color stops (must have at least 2 stops) */
  stops: GradientStop[];
}
