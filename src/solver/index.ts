/**
 * Solver Module
 *
 * Exports the grid coloring solver and related types.
 */

export {
  createTestGrid,
  HATCH_COLOR,
  solveGridColoring,
  type ColorGrid,
  type Edge,
  type GridPoint,
  type GridSolution,
  type SolveOptions,
} from "./grid-coloring";

export type { SolverRequest, SolverResponse, SolverType } from "./solver.worker";
