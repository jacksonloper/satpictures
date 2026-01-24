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
    const n = literals.length;
    
    // For small n, pairwise encoding is fine and produces fewer clauses
    if (n <= 4) {
      // Pairwise encoding: for all pairs, at most one can be true
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          // ¬li ∨ ¬lj
          this.solver.addClause([-literals[i], -literals[j]]);
        }
      }
      return;
    }
    
    // Sequential counter encoding (Sinz, 2005)
    // This is O(n) in auxiliary variables and clauses instead of O(n²)
    //
    // We create auxiliary variables s[i] for i in 1..n-1
    // s[i] is true iff at least one of literals[0..i] is true
    //
    // Constraints:
    // 1. ¬x[0] ∨ s[0]              (if x[0], then s[0])
    // 2. ¬s[i-1] ∨ s[i]            (if s[i-1], then s[i]) 
    // 3. ¬x[i] ∨ s[i]              (if x[i], then s[i])
    // 4. ¬x[i] ∨ ¬s[i-1]           (if x[i] and s[i-1], contradiction)
    //
    // The key constraint is #4: it says if x[i] is true and any previous
    // x[j] was true (making s[i-1] true), we have a conflict.
    
    // Create auxiliary variables s[0..n-2]
    const s: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      s.push(this.solver.newVariable());
    }
    
    // First literal
    // ¬x[0] ∨ s[0]
    this.solver.addClause([-literals[0], s[0]]);
    
    // Middle literals
    for (let i = 1; i < n - 1; i++) {
      // ¬s[i-1] ∨ s[i] (propagate "at least one true so far")
      this.solver.addClause([-s[i - 1], s[i]]);
      // ¬x[i] ∨ s[i] (if x[i], then s[i])
      this.solver.addClause([-literals[i], s[i]]);
      // ¬x[i] ∨ ¬s[i-1] (can't have both x[i] and previous x[j])
      this.solver.addClause([-literals[i], -s[i - 1]]);
    }
    
    // Last literal: just needs ¬x[n-1] ∨ ¬s[n-2]
    this.solver.addClause([-literals[n - 1], -s[n - 2]]);
  }

  addImplies(a: number, b: number): void {
    // a → b ≡ ¬a ∨ b
    this.solver.addClause([-a, b]);
  }

  addUnit(literal: number): void {
    this.solver.addClause([literal]);
  }
}
