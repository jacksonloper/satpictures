/**
 * Solver Module
 *
 * Exports the grid coloring solver and related types.
 */

export {
  createTestGrid,
  getCairoType,
  HATCH_COLOR,
  RED_DOT_COLOR,
  RED_HATCH_COLOR,
  solveGridColoring,
  type ColorGrid,
  type Edge,
  type GridPoint,
  type GridSolution,
  type GridType,
  type SolveOptions,
} from "./grid-coloring";

export type { SolverRequest, SolverResponse, SolverType } from "./solver.worker";
