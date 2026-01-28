/**
 * Problem Module
 *
 * Exports the grid coloring problem encoder and related types.
 * This module converts grid coloring problems into SAT formulas.
 */

// Types and constants
export { HATCH_COLOR } from "./graph-types";
export type {
  ColorGrid,
  ColorRoots,
  Edge,
  GridPoint,
  GridSolution,
  GridType,
  PathlengthConstraint,
} from "./graph-types";

// Grid neighbor utilities
export { edgeKey, getNeighbors } from "./grid-neighbors";

// Trivial solution utilities  
export { createTestGrid, createTrivialSolution } from "./trivial-solution";

// Main solver (legacy - uses connected component encoding)
export { solveGridColoring, type SolveOptions } from "./grid-coloring";

// Forest grid solver (new - uses tree-based encoding)
export { solveForestGridColoring, type ForestSolveOptions } from "./forest-grid-solver";

// Colored forest SAT encoder (low-level CNF builder)
export { buildColoredForestSatCNF } from "./colored-forest-sat";
export type { ColoredForestInput, ColoredForestCNFResult } from "./colored-forest-sat";

// Worker types
export type { SolverRequest, SolverResponse, SolverType } from "./solver.worker";

// Tiling solver
export { solveTiling, colorGridToTile, normalizeTile } from "./tiling-solver";
export type { TilingSolveOptions } from "./tiling-solver";

// Tiling SAT encoder
export { buildTilingSatCNF, extractTilingSolution } from "./tiling-sat";
export type { TilePoint, Placement, TilingSatInput, TilingSatResult, TilingSolution } from "./tiling-sat";

// Tiling worker types
export type { TilingSolverRequest, TilingSolverResponse } from "./tiling.worker";
