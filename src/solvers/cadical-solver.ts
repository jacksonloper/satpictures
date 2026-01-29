/**
 * CaDiCaL-based SAT Solver Implementation
 *
 * Uses CaDiCaL compiled to WebAssembly via Emscripten.
 * Note: This solver must be used in a Web Worker context where
 * the CaDiCaL WASM module has been loaded.
 */

import type { Clause, SATSolver, SolveResult } from "./types";
import { BaseFormulaBuilder } from "./types";
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
      // Empty clause means UNSAT - create a fresh variable and add conflicting unit clauses
      // This is safer than assuming variable 1 exists
      const conflictVar = this.newVariable();
      this.cadical.add(conflictVar);   // Add literal n
      this.cadical.add(0);             // Terminate clause
      this.cadical.add(-conflictVar);  // Add literal -n
      this.cadical.add(0);             // Terminate clause
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
 * Formula builder implementation using CaDiCaL.
 * Extends BaseFormulaBuilder with CaDiCaL-specific initialization.
 */
export class CadicalFormulaBuilder extends BaseFormulaBuilder {
  constructor(solver: SATSolver) {
    super(solver);
  }
}
