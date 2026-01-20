/**
 * SAT Solver Module
 *
 * Clean abstraction for SAT solving that allows swapping backends.
 */

export type { Clause, FormulaBuilder, Literal, SATSolver, SolveResult } from "./types";
export {
  addAtLeastKFalse,
  constrainBinaryEqual,
  constrainLessThan,
  createBinaryIntVariables,
  MiniSatFormulaBuilder,
  MiniSatSolver,
} from "./minisat-solver";
export { CadicalSolver, CadicalFormulaBuilder } from "./cadical-solver";
export type { CadicalClass, CadicalConstructor, CadicalModule } from "./cadical-types";
