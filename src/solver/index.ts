/**
 * Solver Module
 *
 * Exports the grid coloring solver and related types.
 */

export {
  AVAILABLE_SOLVERS,
  createTestGrid,
  solveGridColoring,
  solveGridColoringWithSolver,
  SOLVER_REGISTRY,
  type ColorGrid,
  type Edge,
  type GridPoint,
  type GridSolution,
  type SolverInfo,
  type SolverType,
} from "./grid-coloring";

export type { SolverRequest, SolverResponse } from "./solver.worker";
