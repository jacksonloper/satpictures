/**
 * Orbifold creation routines for P1, P2, P3, P4, and pgg wallpaper groups.
 */

import { type Int, type OrbifoldGrid } from "./orbifoldbasics";
import { createP1Grid } from "./p1";
import { createP2Grid } from "./p2";
import { createP3Grid } from "./p3";
import { createP4Grid } from "./p4";
import { createPggGrid } from "./pgg";
import { type ColorData, type EdgeStyleData, type WallpaperGroupType } from "./orbifoldShared";

/**
 * Create an orbifold grid for the given wallpaper group and size.
 * 
 * @param groupType - "P1", "P2", "P3", "P4", or "pgg"
 * @param n - Grid size (results in n×n nodes). Must be at least 2.
 * @param initialColors - Optional initial colors for each cell (row-major, n×n array)
 */
export function createOrbifoldGrid(
  groupType: WallpaperGroupType,
  n: Int,
  initialColors?: ("black" | "white")[][]
): OrbifoldGrid<ColorData, EdgeStyleData> {
  switch (groupType) {
    case "P1":
      return createP1Grid(n, initialColors);
    case "P2":
      return createP2Grid(n, initialColors);
    case "P3":
      return createP3Grid(n, initialColors);
    case "P4":
      return createP4Grid(n, initialColors);
    case "pgg":
      return createPggGrid(n, initialColors);
  }
}

export {
  coordToGridPos,
  getEdgeLinestyle,
  getNodeColor,
  glideReflectionX,
  glideReflectionY,
  REFLECTION_X,
  REFLECTION_Y,
  ROTATION_120_CCW,
  ROTATION_120_CW,
  ROTATION_180,
  ROTATION_90_CCW,
  ROTATION_90_CW,
  setEdgeLinestyle,
  setNodeColor,
  translationMatrix,
  translationWith120CCW,
  translationWith120CW,
  translationWith180,
  translationWith90CCW,
  translationWith90CW,
} from "./orbifoldShared";

export type { WallpaperGroupType, ColorData, EdgeStyleData, EdgeLinestyle } from "./orbifoldShared";
