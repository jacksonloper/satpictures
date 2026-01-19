/**
 * CaDiCaL-based SAT Solver Implementation
 *
 * Uses CaDiCaL compiled to WebAssembly via Emscripten.
 * Note: This solver must be used in a Web Worker context where
 * the CaDiCaL WASM module has been loaded.
 */

import type { Clause, FormulaBuilder, SATSolver, SolveResult } from "./types";
import type { CadicalClass } from "./cadical-types";

/**
 * Implementation of SATSolver using CaDiCaL (WASM)
 * 
 * CaDiCaL uses the standard DIMACS format where:
 * - Variables are positive integers (1, 2, 3, ...)
 * - Negative literals represent negation (-1, -2, -3, ...)
 * - Clauses are terminated with 0
 */
export class CadicalSolver implements SATSolver {
  private cadical: CadicalClass;
  private variableCount: number = 0;
  private clauseCount: number = 0;

  constructor(cadical: CadicalClass) {
    this.cadical = cadical;
  }

  newVariable(): number {
    this.variableCount++;
    return this.variableCount;
  }

  addClause(clause: Clause): void {
    if (clause.length === 0) {
      // Empty clause means UNSAT - add a conflicting unit clause
      this.cadical.add(1);  // Add literal 1
      this.cadical.add(0);  // Terminate clause
      this.cadical.add(-1); // Add literal -1
      this.cadical.add(0);  // Terminate clause
      this.clauseCount += 2;
      return;
    }

    // Add each literal to the clause
    for (const lit of clause) {
      this.cadical.add(lit);
    }
    // Terminate the clause with 0
    this.cadical.add(0);
    this.clauseCount++;
  }

  solve(): SolveResult {
    const result = this.cadical.solve();

    if (result === undefined) {
      // UNKNOWN result - treat as UNSAT
      return { satisfiable: false };
    }

    if (!result) {
      return { satisfiable: false };
    }

    // SAT - extract the assignment
    const assignment = new Map<number, boolean>();
    for (let i = 1; i <= this.variableCount; i++) {
      const val = this.cadical.value(i);
      // If val is positive, the variable is true; if negative, it's false
      assignment.set(i, val > 0);
    }

    return { satisfiable: true, assignment };
  }

  getVariableCount(): number {
    return this.variableCount;
  }

  getClauseCount(): number {
    return this.clauseCount;
  }
}

/**
 * Formula builder implementation using CaDiCaL
 */
export class CadicalFormulaBuilder implements FormulaBuilder {
  solver: SATSolver;
  private nameToVar: Map<string, number> = new Map();

  constructor(solver: SATSolver) {
    this.solver = solver;
  }

  createNamedVariable(name: string): number {
    if (this.nameToVar.has(name)) {
      throw new Error(`Variable already exists: ${name}`);
    }
    const varNum = this.solver.newVariable();
    this.nameToVar.set(name, varNum);
    return varNum;
  }

  getVariable(name: string): number | undefined {
    return this.nameToVar.get(name);
  }

  addOr(literals: number[]): void {
    if (literals.length === 0) return;
    this.solver.addClause(literals);
  }

  addAnd(literals: number[]): void {
    for (const lit of literals) {
      this.solver.addClause([lit]);
    }
  }

  addExactlyOne(literals: number[]): void {
    // At least one
    this.addOr(literals);
    // At most one
    this.addAtMostOne(literals);
  }

  addAtMostOne(literals: number[]): void {
    // Pairwise encoding: for all pairs, at most one can be true
    for (let i = 0; i < literals.length; i++) {
      for (let j = i + 1; j < literals.length; j++) {
        // ¬li ∨ ¬lj
        this.solver.addClause([-literals[i], -literals[j]]);
      }
    }
  }

  addImplies(a: number, b: number): void {
    // a → b ≡ ¬a ∨ b
    this.solver.addClause([-a, b]);
  }

  addUnit(literal: number): void {
    this.solver.addClause([literal]);
  }
}
