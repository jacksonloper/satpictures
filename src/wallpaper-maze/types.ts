/**
 * Shared types for Wallpaper Maze Explorer
 */

import type { WallpaperGroupName } from "./WallpaperGroups";

// Grid cell type
export interface GridCell {
  row: number;
  col: number;
}

// Selected node in solution viewer (includes copy position)
export interface SolutionSelectedNode {
  // For square grids
  copyRow: number;
  copyCol: number;
  fundamentalRow: number;
  fundamentalCol: number;
  // For P3, also need hexagon and rhombus info
  hexRow?: number;
  hexCol?: number;
  rhombusIdx?: number;
}

// Maze solution type
export interface MazeSolution {
  parentOf: Map<string, GridCell | null>;
  distanceFromRoot: Map<string, number>;
  wallpaperGroup: WallpaperGroupName;
  vacantCells: Set<string>;
  rootRow: number;
  rootCol: number;
}

// View mode type for solution
export type SolutionViewMode = "maze" | "graph";

// Tool types for interacting with the sketchpad
export type SketchpadTool = "rootSetter" | "neighborhoodViewer" | "blockSetter";

// Constants
export const DEFAULT_LENGTH = 4;
export const DEFAULT_MULTIPLIER = 2;
export const CELL_SIZE = 40;
export const GRID_PADDING = 20;
