/**
 * Type declarations for CaDiCaL SAT solver (WASM/Emscripten)
 */

/**
 * CaDiCaL class for interacting with the solver
 * This is a wrapper around the C API exposed by Emscripten
 */
export interface CadicalClass {
  /**
   * Initialize a new solver instance
   */
  init(): void;

  /**
   * Initialize with plain settings (no preprocessing)
   */
  initPlain(): void;

  /**
   * Initialize optimized for SAT instances
   */
  initSat(): void;

  /**
   * Initialize optimized for UNSAT instances
   */
  initUnsat(): void;

  /**
   * Release the solver resources
   */
  release(): void;

  /**
   * Get the solver signature string
   */
  signature(): string;

  /**
   * Add a literal to the current clause (0 terminates the clause)
   */
  add(litOrZero: number): void;

  /**
   * Add an entire clause at once
   */
  addClause(clause: number[]): void;

  /**
   * Add an assumption for the next solve call
   */
  assume(lit: number): void;

  /**
   * Solve the current formula
   * @returns true for SAT, false for UNSAT, undefined for UNKNOWN
   */
  solve(): boolean | undefined;

  /**
   * Get the value of a literal in the solution
   * @returns The literal with its sign indicating the assignment
   */
  value(lit: number): number;

  /**
   * Get the model (values for all variables)
   */
  model(vars: number[]): number[];

  /**
   * Add a constraint literal (for constrained solving)
   */
  constrain(litOrZero: number): void;

  /**
   * Add a constraint clause
   */
  constrainClause(clause: number[]): void;

  /**
   * Set a solver option
   */
  setOption(name: string, v: number): void;

  /**
   * Print solver statistics to console
   */
  printStatistics(): void;
}

/**
 * CaDiCaL class constructor
 */
export interface CadicalConstructor {
  new (): CadicalClass;
}

/**
 * Emscripten Module interface for CaDiCaL
 */
export interface CadicalModule {
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  onRuntimeInitialized?: () => void;
}

declare global {
  var Module: CadicalModule;
  var Cadical: CadicalConstructor;
}
