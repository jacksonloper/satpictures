/**
 * Orbifold creation routines for P1, P2, P2hex, P3, P4, P4g, P6, cmm, pgg, and pmm wallpaper groups.
 */

import { type Int, type OrbifoldGrid } from "./orbifoldbasics";
import { createP1Grid } from "./p1";
import { createP2Grid } from "./p2";
import { createP2hexGrid } from "./p2hex";
import { createP3Grid } from "./p3";
import { createP4Grid } from "./p4";
import { createP4gGrid } from "./p4g";
import { createP6Grid } from "./p6";
import { createCmmGrid } from "./cmm";
import { createPggGrid } from "./pgg";
import { createPmmGrid } from "./pmm";
import { type ColorData, type EdgeStyleData, type WallpaperGroupType } from "./orbifoldShared";

/**
 * Create an orbifold grid for the given wallpaper group and size.
 * 
 * @param groupType - "P1", "P2", "P2hex", "P3", "P4", "P4g", "P6", "cmm", "pgg", or "pmm"
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
    case "P2hex":
      return createP2hexGrid(n, initialColors);
    case "P3":
      return createP3Grid(n, initialColors);
    case "P4":
      return createP4Grid(n, initialColors);
    case "P4g":
      return createP4gGrid(n, initialColors);
    case "P6":
      return createP6Grid(n, initialColors);
    case "cmm":
      return createCmmGrid(n, initialColors);
    case "pgg":
      return createPggGrid(n, initialColors);
    case "pmm":
      return createPmmGrid(n, initialColors);
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

export type { WallpaperGroupType, ColorData, EdgeStyleData, EdgeLinestyle, LoopStep } from "./orbifoldShared";
