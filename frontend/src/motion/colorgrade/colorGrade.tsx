/**
 * Brightness/contrast/saturation/hue as one SVG <filter> node, shared by
 * MotionCanvas, RenderFrame and SceneThumbnail.
 *
 * gradient/shadow/blur each have their OWN render*Filter function
 * duplicated three times, once per renderer — that's the exact shape of bug
 * that's cost this project real time this week (the easing switch and the
 * video time-mapping both drifted the same way, silently). This module
 * returns actual JSX, not just numbers, specifically so the markup itself
 * can't drift between renderers — every renderer imports THIS function,
 * none of them redefine it.
 */

import type { ColorGrade } from "../../types/motion";

const IDENTITY: ColorGrade = { brightness: 1, contrast: 1, saturation: 1, hue_deg: 0 };

/** True for null/undefined or values that visually do nothing. Callers skip
 *  rendering the <filter> AND skip wrapping the shape in it — an existing
 *  project with no color_grade must produce the exact same markup as
 *  before this feature existed, not an identity filter it happens to run
 *  through unnoticed. */
export function isIdentityColorGrade(grade: ColorGrade | null | undefined): boolean {
  if (!grade) return true;
  return (
    grade.brightness === IDENTITY.brightness &&
    grade.contrast === IDENTITY.contrast &&
    grade.saturation === IDENTITY.saturation &&
    grade.hue_deg === IDENTITY.hue_deg
  );
}

export function colorGradeFilterId(layerId: string): string {
  return `${layerId}-colorgrade`;
}

/**
 * Brightness and contrast are combined into ONE feComponentTransfer linear
 * function per channel rather than two chained passes: contrast pivots
 * around mid-gray (matching CSS's contrast()) — c' = contrast*(c-0.5)+0.5 —
 * and brightness then scales that result — c'' = brightness*c'. Expanding
 * gives a single slope/intercept: slope = brightness*contrast,
 * intercept = brightness*(0.5 - 0.5*contrast).
 *
 * Saturation and hue use feColorMatrix's built-in `saturate`/`hueRotate`
 * types rather than a hand-rolled matrix — same numbers a CSS
 * `saturate()`/`hue-rotate()` filter would use.
 *
 * colorInterpolationFilters="sRGB" pins the color space explicitly. SVG
 * filters default to linearRGB, which would make identical brightness/
 * contrast NUMBERS look different than the sRGB math they were derived
 * from. Setting it here, once, means all three renderers agree — that's
 * the actual requirement, more than matching any particular tool.
 */
export function renderColorGradeFilter(layerId: string, grade: ColorGrade): React.ReactNode {
  const slope = grade.brightness * grade.contrast;
  const intercept = grade.brightness * (0.5 - 0.5 * grade.contrast);
  const saturate = Math.max(0, grade.saturation);
  return (
    <filter
      id={colorGradeFilterId(layerId)}
      x="-20%"
      y="-20%"
      width="140%"
      height="140%"
      colorInterpolationFilters="sRGB"
    >
      <feComponentTransfer>
        <feFuncR type="linear" slope={slope} intercept={intercept} />
        <feFuncG type="linear" slope={slope} intercept={intercept} />
        <feFuncB type="linear" slope={slope} intercept={intercept} />
      </feComponentTransfer>
      <feColorMatrix type="saturate" values={String(saturate)} />
      <feColorMatrix type="hueRotate" values={String(grade.hue_deg)} />
    </filter>
  );
}
