/**
 * SAT Solver Abstraction Layer
 *
 * This provides a clean interface for SAT solving that can be swapped
 * between different solvers (MiniSat, CaDiCaL, etc.)
 */

/**
 * A literal is either a positive variable (variable number)
 * or a negative variable (-variable number).
 * In DIMACS format: positive = true, negative = false
 */
export type Literal = number;

/**
 * A clause is a disjunction (OR) of literals
 */
export type Clause = Literal[];

/**
 * Result of a SAT solve operation
 */
export type SolveResult =
  | { satisfiable: true; assignment: Map<number, boolean> }
  | { satisfiable: false };

/**
 * Abstract SAT solver interface
 * Implementations can use different underlying solvers
 */
export interface SATSolver {
  /**
   * Create a new variable and return its number (1-indexed)
   */
  newVariable(): number;

  /**
   * Add a clause (disjunction of literals)
   * @param clause Array of literals (positive = true, negative = false)
   */
  addClause(clause: Clause): void;

  /**
   * Solve the current formula
   * @returns Solution if satisfiable, null otherwise
   */
  solve(): SolveResult;

  /**
   * Get the total number of variables
   */
  getVariableCount(): number;

  /**
   * Get the total number of clauses
   */
  getClauseCount(): number;
}

/**
 * Higher-level formula builder that works with any SATSolver
 */
export interface FormulaBuilder {
  solver: SATSolver;

  /**
   * Create named variables for easier debugging
   */
  createNamedVariable(name: string): number;

  /**
   * Get variable by name
   */
  getVariable(name: string): number | undefined;

  /**
   * Add constraint: at least one of the literals must be true
   */
  addOr(literals: Literal[]): void;

  /**
   * Add constraint: all literals must be true
   */
  addAnd(literals: Literal[]): void;

  /**
   * Add constraint: exactly one literal must be true
   */
  addExactlyOne(literals: Literal[]): void;

  /**
   * Add constraint: at most one literal can be true
   */
  addAtMostOne(literals: Literal[]): void;

  /**
   * Add implication: if a then b (¬a ∨ b)
   */
  addImplies(a: Literal, b: Literal): void;

  /**
   * Force a literal to be true
   */
  addUnit(literal: Literal): void;
}
