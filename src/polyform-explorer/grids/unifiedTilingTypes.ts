/**
 * Types for the Unified Polyform Tiling Solver
 */

import type { Coord } from "./types";

/** A single placement of a tile at a position with a specific transform */
export interface UnifiedPlacement {
  /** Unique identifier for the placement */
  id: number;
  /** Transform index (0 to 2*numRotations-1) */
  transformIndex: number;
  /** Coordinates this placement covers (absolute, after transform and translation) */
  cells: Coord[];
  /** 
   * Original cells in tile coordinates (before transform/translation).
   * These map 1:1 with 'cells' and are useful for looking up edge state.
   */
  originalCells?: Coord[];
}

/** Result of tiling attempt */
export interface UnifiedTilingResult {
  satisfiable: boolean;
  /** Placements that are used in the solution (if SAT) */
  placements?: UnifiedPlacement[];
  /** Stats about the SAT problem */
  stats: {
    numVariables: number;
    numClauses: number;
    numPlacements: number;
  };
  /** Count of placements used for each tile type (when multiple tiles) */
  tileTypeCounts?: number[];
}

/**
 * Edge adjacency violation - when two adjacent cells have disagreeing edge values
 */
export interface EdgeAdjacencyViolation {
  /** First cell coordinate */
  cell1: Coord;
  /** Edge index in first cell */
  edgeIdx1: number;
  /** Edge value in first cell */
  value1: boolean;
  /** Second cell coordinate (neighbor) */
  cell2: Coord;
  /** Edge index in second cell */
  edgeIdx2: number;
  /** Edge value in second cell */
  value2: boolean;
  /** Placement index for cell1 (if known) */
  placementIdx1?: number;
  /** Placement index for cell2 (if known) */
  placementIdx2?: number;
}

/**
 * Information about a single shared edge between two placed cells
 */
export interface EdgeInfo {
  /** First cell coordinate */
  cell1: Coord;
  /** Edge index in first cell */
  edgeIdx1: number;
  /** Edge value in first cell */
  value1: boolean;
  /** Second cell coordinate (neighbor) */
  cell2: Coord;
  /** Edge index in second cell */
  edgeIdx2: number;
  /** Edge value in second cell */
  value2: boolean;
  /** Whether the two values match */
  isConsistent: boolean;
  /** Placement index for cell1 */
  placementIdx1: number;
  /** Placement index for cell2 */
  placementIdx2: number;
}
