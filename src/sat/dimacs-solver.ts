/**
 * DIMACS-capable SAT Solver for Size Analysis
 *
 * This solver captures all clauses and can produce DIMACS format output.
 * Used for analyzing formula sizes without actually solving.
 */

import type { Clause, SATSolver, SolveResult } from "./types";

/**
 * A SAT solver that captures clauses for DIMACS output.
 * Does not actually solve - only captures the formula.
 */
export class DimacsSolver implements SATSolver {
  private variableCount: number = 0;
  private clauses: Clause[] = [];

  newVariable(): number {
    this.variableCount++;
    return this.variableCount;
  }

  addClause(clause: Clause): void {
    this.clauses.push([...clause]);
  }

  solve(): SolveResult {
    // This solver doesn't actually solve - just captures clauses
    // Return unsatisfiable to indicate we didn't solve
    return { satisfiable: false };
  }

  getVariableCount(): number {
    return this.variableCount;
  }

  getClauseCount(): number {
    return this.clauses.length;
  }

  /**
   * Get all captured clauses
   */
  getClauses(): Clause[] {
    return this.clauses;
  }

  /**
   * Generate DIMACS CNF format string
   */
  toDimacs(): string {
    const lines: string[] = [];
    
    // Header line: p cnf <num_vars> <num_clauses>
    lines.push(`p cnf ${this.variableCount} ${this.clauses.length}`);
    
    // Each clause: space-separated literals ending with 0
    for (const clause of this.clauses) {
      lines.push(clause.join(" ") + " 0");
    }
    
    return lines.join("\n");
  }

  /**
   * Get the size of the DIMACS output in bytes
   */
  getDimacsSize(): number {
    return this.toDimacs().length;
  }

  /**
   * Get statistics about the formula
   */
  getStats(): {
    variables: number;
    clauses: number;
    literals: number;
    dimacsBytes: number;
  } {
    let totalLiterals = 0;
    for (const clause of this.clauses) {
      totalLiterals += clause.length;
    }

    return {
      variables: this.variableCount,
      clauses: this.clauses.length,
      literals: totalLiterals,
      dimacsBytes: this.getDimacsSize(),
    };
  }
}
