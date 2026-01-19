/**
 * SAT Solver Module
 *
 * Clean abstraction for SAT solving that allows swapping backends.
 */

export type { Clause, FormulaBuilder, Literal, SATSolver, SolveResult } from "./types";
export {
  constrainBinaryEqual,
  constrainLessThan,
  createBinaryIntVariables,
  MiniSatFormulaBuilder,
  MiniSatSolver,
} from "./minisat-solver";
