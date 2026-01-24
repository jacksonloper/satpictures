/**
 * Type Definitions for Grid Coloring Problem
 *
 * Core types for representing grid points, edges, constraints, and solutions.
 */

/**
 * Special hatch color index - cells with this color don't need to form 
 * a connected component, but must still be disconnected from other colors
 */
export const HATCH_COLOR = -2;

/**
 * Grid type - square, hex, octagon, cairo, or cairobridge
 */
export type GridType = "square" | "hex" | "octagon" | "cairo" | "cairobridge";

/**
 * Represents a point in the grid
 */
export interface GridPoint {
  row: number;
  col: number;
}

/**
 * Grid with colors assigned to each point
 * null means the cell is blank and the solver should determine its color
 */
export interface ColorGrid {
  width: number;
  height: number;
  colors: (number | null)[][]; // colors[row][col], null = blank
}

/**
 * An edge between two adjacent grid points
 */
export interface Edge {
  u: GridPoint;
  v: GridPoint;
}

/**
 * A pathlength lower bound constraint.
 * Specifies that certain cells must be at least a minimum distance from a root cell.
 * Distance is measured via kept edges (passages, not walls).
 */
export interface PathlengthConstraint {
  /** Unique identifier for this constraint */
  id: string;
  /** Root cell position - distance is measured from here */
  root: GridPoint | null;
  /** Map from cell position key ("row,col") to minimum distance from root */
  minDistances: Record<string, number>;
}

/**
 * Solution: which edges to keep (no wall) and assigned colors for blank cells
 */
export interface GridSolution {
  /** Edges that are kept (passages, not walls) */
  keptEdges: Edge[];
  /** Edges that are blocked (walls) */
  wallEdges: Edge[];
  /** Full grid with all colors determined */
  assignedColors: number[][];
  /** 
   * Distance levels from each pathlength constraint's root.
   * Key is constraint ID, value is 2D array of distances (-1 if unreachable).
   */
  distanceLevels?: Record<string, number[][]> | null;
}
