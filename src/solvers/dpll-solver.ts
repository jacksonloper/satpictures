/**
 * DPLL-based SAT Solver Implementation
 *
 * Implements the classic Davis-Putnam-Logemann-Loveland (DPLL) algorithm from 1962.
 * This is a "textbook" implementation for educational purposes and comparison.
 */

import type { Clause, SATSolver, SolveResult } from "./types";
import { BaseFormulaBuilder } from "./types";

/**
 * Implementation of SATSolver using the classic DPLL algorithm
 *
 * DPLL is a complete, backtracking-based search algorithm for deciding the
 * satisfiability of propositional logic formulae in conjunctive normal form.
 *
 * Key features:
 * - Unit propagation: If a clause has a single unassigned literal, assign it
 * - Pure literal elimination: If a variable appears with only one polarity, assign it
 * - Backtracking search with branching on unassigned variables
 */
export class DPLLSolver implements SATSolver {
  private variableCount: number = 0;
  private clauses: Clause[] = [];

  newVariable(): number {
    this.variableCount++;
    return this.variableCount;
  }

  addClause(clause: Clause): void {
    // Store a copy of the clause
    this.clauses.push([...clause]);
  }

  solve(): SolveResult {
    // Initialize assignment: undefined means unassigned
    const assignment = new Map<number, boolean>();

    // Run DPLL
    const satisfiable = this.dpll(this.clauses, assignment);

    if (satisfiable) {
      // Fill in any remaining unassigned variables (can be either value)
      for (let i = 1; i <= this.variableCount; i++) {
        if (!assignment.has(i)) {
          assignment.set(i, false);
        }
      }
      return { satisfiable: true, assignment };
    }

    return { satisfiable: false };
  }

  /**
   * Main DPLL recursive algorithm
   */
  private dpll(
    clauses: Clause[],
    assignment: Map<number, boolean>
  ): boolean {
    // Simplify clauses based on current assignment
    const simplified = this.simplifyClauses(clauses, assignment);

    // Check for empty clause (UNSAT)
    if (simplified.some((c) => c.length === 0)) {
      return false;
    }

    // Check if all clauses are satisfied (SAT)
    if (simplified.length === 0) {
      return true;
    }

    // Unit propagation
    const unitResult = this.unitPropagation(simplified, assignment);
    if (unitResult === "conflict") {
      return false;
    }
    if (unitResult === "satisfied") {
      return true;
    }

    // Pure literal elimination
    this.pureLiteralElimination(simplified, assignment);

    // Re-simplify after propagation
    const afterPropagation = this.simplifyClauses(simplified, assignment);
    if (afterPropagation.some((c) => c.length === 0)) {
      return false;
    }
    if (afterPropagation.length === 0) {
      return true;
    }

    // Choose a variable to branch on (pick first unassigned literal)
    const branchVar = this.chooseBranchVariable(afterPropagation, assignment);
    if (branchVar === null) {
      // All variables assigned but clauses remain - should be handled above
      return afterPropagation.length === 0;
    }

    // Try assigning true
    const assignmentCopyTrue = new Map(assignment);
    assignmentCopyTrue.set(branchVar, true);
    if (this.dpll(afterPropagation, assignmentCopyTrue)) {
      // Copy successful assignment back
      for (const [k, v] of assignmentCopyTrue) {
        assignment.set(k, v);
      }
      return true;
    }

    // Try assigning false
    const assignmentCopyFalse = new Map(assignment);
    assignmentCopyFalse.set(branchVar, false);
    if (this.dpll(afterPropagation, assignmentCopyFalse)) {
      // Copy successful assignment back
      for (const [k, v] of assignmentCopyFalse) {
        assignment.set(k, v);
      }
      return true;
    }

    return false;
  }

  /**
   * Simplify clauses based on current assignment
   * - Remove satisfied clauses
   * - Remove false literals from clauses
   */
  private simplifyClauses(
    clauses: Clause[],
    assignment: Map<number, boolean>
  ): Clause[] {
    const result: Clause[] = [];

    for (const clause of clauses) {
      let satisfied = false;
      const newClause: Clause = [];

      for (const lit of clause) {
        const varNum = Math.abs(lit);
        const isPositive = lit > 0;
        const value = assignment.get(varNum);

        if (value === undefined) {
          // Variable unassigned, keep the literal
          newClause.push(lit);
        } else if (value === isPositive) {
          // Literal is true, clause is satisfied
          satisfied = true;
          break;
        }
        // else: literal is false, don't include it
      }

      if (!satisfied) {
        result.push(newClause);
      }
    }

    return result;
  }

  /**
   * Unit propagation: if a clause has only one literal, assign it
   * 
   * NOTE: This method modifies the clauses array in-place for efficiency.
   * The caller should be aware that the input array will be updated
   * to contain only the simplified (non-satisfied) clauses.
   */
  private unitPropagation(
    clauses: Clause[],
    assignment: Map<number, boolean>
  ): "conflict" | "satisfied" | "continue" {
    let changed = true;

    while (changed) {
      changed = false;

      // Simplify first
      const simplified = this.simplifyClauses(clauses, assignment);

      // Check for conflict
      if (simplified.some((c) => c.length === 0)) {
        return "conflict";
      }

      // Check if satisfied
      if (simplified.length === 0) {
        return "satisfied";
      }

      // Find unit clauses
      for (const clause of simplified) {
        if (clause.length === 1) {
          const lit = clause[0];
          const varNum = Math.abs(lit);
          const value = lit > 0;

          if (!assignment.has(varNum)) {
            assignment.set(varNum, value);
            changed = true;
          }
        }
      }

      // Update clauses for next iteration
      clauses.length = 0;
      clauses.push(...simplified);
    }

    return "continue";
  }

  /**
   * Pure literal elimination: if a variable appears with only one polarity, assign it
   */
  private pureLiteralElimination(
    clauses: Clause[],
    assignment: Map<number, boolean>
  ): void {
    // Count polarities for each variable
    const positive = new Set<number>();
    const negative = new Set<number>();

    for (const clause of clauses) {
      for (const lit of clause) {
        const varNum = Math.abs(lit);
        if (!assignment.has(varNum)) {
          if (lit > 0) {
            positive.add(varNum);
          } else {
            negative.add(varNum);
          }
        }
      }
    }

    // Find pure literals
    for (const varNum of positive) {
      if (!negative.has(varNum)) {
        assignment.set(varNum, true);
      }
    }

    for (const varNum of negative) {
      if (!positive.has(varNum)) {
        assignment.set(varNum, false);
      }
    }
  }

  /**
   * Choose a variable to branch on
   * Simple heuristic: pick the first unassigned variable that appears in a clause
   */
  private chooseBranchVariable(
    clauses: Clause[],
    assignment: Map<number, boolean>
  ): number | null {
    for (const clause of clauses) {
      for (const lit of clause) {
        const varNum = Math.abs(lit);
        if (!assignment.has(varNum)) {
          return varNum;
        }
      }
    }
    return null;
  }

  getVariableCount(): number {
    return this.variableCount;
  }

  getClauseCount(): number {
    return this.clauses.length;
  }
}

/**
 * Formula builder implementation using DPLL.
 * Extends BaseFormulaBuilder with DPLL-specific defaults.
 */
export class DPLLFormulaBuilder extends BaseFormulaBuilder {
  constructor(solver?: SATSolver) {
    super(solver ?? new DPLLSolver());
  }
}
