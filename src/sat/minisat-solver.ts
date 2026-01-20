/**
 * MiniSat-based SAT Solver Implementation
 *
 * Uses the logic-solver npm package which contains MiniSat
 * compiled to JavaScript via Emscripten.
 */

import Logic from "logic-solver";
import type { Clause, FormulaBuilder, SATSolver, SolveResult } from "./types";

/**
 * Implementation of SATSolver using logic-solver (MiniSat)
 */
export class MiniSatSolver implements SATSolver {
  private solver: Logic.Solver;
  private variableCount: number = 0;
  private clauseCount: number = 0;
  private varNumToName: Map<number, string> = new Map();

  constructor() {
    this.solver = new Logic.Solver();
  }

  newVariable(): number {
    this.variableCount++;
    const varName = `v${this.variableCount}`;
    this.varNumToName.set(this.variableCount, varName);
    // Force the variable to exist in the solver
    this.solver.getVarNum(varName);
    return this.variableCount;
  }

  addClause(clause: Clause): void {
    if (clause.length === 0) {
      // Empty clause means UNSAT
      this.solver.require(Logic.FALSE);
      this.clauseCount++;
      return;
    }

    // Convert our literal format to logic-solver format
    const terms = clause.map((lit) => {
      const varNum = Math.abs(lit);
      const varName = this.varNumToName.get(varNum);
      if (!varName) {
        throw new Error(`Unknown variable: ${varNum}`);
      }
      return lit > 0 ? varName : `-${varName}`;
    });

    this.solver.require(Logic.or(...terms));
    this.clauseCount++;
  }

  solve(): SolveResult {
    const solution = this.solver.solve();

    if (!solution) {
      return { satisfiable: false };
    }

    const assignment = new Map<number, boolean>();
    const trueVars = new Set(solution.getTrueVars());

    for (let i = 1; i <= this.variableCount; i++) {
      const varName = this.varNumToName.get(i);
      if (varName) {
        assignment.set(i, trueVars.has(varName));
      }
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
 * Formula builder implementation using MiniSat
 */
export class MiniSatFormulaBuilder implements FormulaBuilder {
  solver: SATSolver;
  private nameToVar: Map<string, number> = new Map();

  constructor(solver?: SATSolver) {
    this.solver = solver ?? new MiniSatSolver();
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

/**
 * Utility: Create integer variables encoded in binary
 * Returns array of variable numbers representing bits (LSB first)
 */
export function createBinaryIntVariables(
  builder: FormulaBuilder,
  baseName: string,
  numBits: number
): number[] {
  const bits: number[] = [];
  for (let i = 0; i < numBits; i++) {
    bits.push(builder.createNamedVariable(`${baseName}_bit${i}`));
  }
  return bits;
}

/**
 * Utility: Add constraint that binary integer equals a constant
 */
export function constrainBinaryEqual(
  builder: FormulaBuilder,
  bits: number[],
  value: number
): void {
  for (let i = 0; i < bits.length; i++) {
    const bitSet = (value >> i) & 1;
    builder.addUnit(bitSet ? bits[i] : -bits[i]);
  }
}

/**
 * Utility: Add constraint that bits1 < bits2 (unsigned)
 * Uses auxiliary variables for the comparison
 *
 * The encoding works by comparing from MSB to LSB:
 * bits1 < bits2 iff there exists some position i where:
 *   - bits1[i] < bits2[i] (i.e., bits1[i]=0 and bits2[i]=1)
 *   - all higher positions are equal
 */
export function constrainLessThan(
  builder: FormulaBuilder,
  bits1: number[],
  bits2: number[],
  auxPrefix: string
): void {
  const n = Math.max(bits1.length, bits2.length);

  // Pad to same length (missing high bits are 0)
  const a = [...bits1];
  const b = [...bits2];
  while (a.length < n) {
    const zeroVar = builder.createNamedVariable(`${auxPrefix}_pad_a_${a.length}`);
    builder.addUnit(-zeroVar); // Force to false (0)
    a.push(zeroVar);
  }
  while (b.length < n) {
    const zeroVar = builder.createNamedVariable(`${auxPrefix}_pad_b_${b.length}`);
    builder.addUnit(-zeroVar);
    b.push(zeroVar);
  }

  // We use a chain of auxiliary variables
  // lt[i] = true if a[n-1:i] < b[n-1:i] (comparing from bit i to MSB)
  // eq[i] = true if a[i] = b[i]
  //
  // Base case (MSB): lt[n-1] = (¬a[n-1] ∧ b[n-1])
  // Recursive: lt[i] = lt[i+1] ∨ (eq[i+1] ∧ ... ∧ eq[n-1] ∧ ¬a[i] ∧ b[i])
  //
  // Simplified: We track "equal so far from MSB" and "less than so far"

  // Create auxiliary variables
  const ltSoFar: number[] = []; // ltSoFar[i] = a[MSB:i] < b[MSB:i]
  const eqSoFar: number[] = []; // eqSoFar[i] = a[MSB:i] = b[MSB:i]

  for (let i = 0; i < n; i++) {
    ltSoFar.push(builder.createNamedVariable(`${auxPrefix}_lt_${i}`));
    eqSoFar.push(builder.createNamedVariable(`${auxPrefix}_eq_${i}`));
  }

  // Define eq[i]: a[i] = b[i] ≡ (a[i] ↔ b[i]) ≡ (a[i] ∧ b[i]) ∨ (¬a[i] ∧ ¬b[i])
  for (let i = 0; i < n; i++) {
    const eqVar = eqSoFar[i];
    // eqVar ↔ (a[i] ↔ b[i])
    // eqVar → (a[i] → b[i]) ∧ (b[i] → a[i])
    // ¬eqVar → (a[i] ⊕ b[i])
    // Encoding:
    // (¬eqVar ∨ ¬a[i] ∨ b[i])  -- eqVar ∧ a[i] → b[i]
    // (¬eqVar ∨ a[i] ∨ ¬b[i])  -- eqVar ∧ ¬a[i] → ¬b[i]
    // (eqVar ∨ a[i] ∨ b[i])    -- ¬eqVar → (a[i] ∨ b[i]) i.e., not both false
    // (eqVar ∨ ¬a[i] ∨ ¬b[i])  -- ¬eqVar → (¬a[i] ∨ ¬b[i]) i.e., not both true
    builder.solver.addClause([-eqVar, -a[i], b[i]]);
    builder.solver.addClause([-eqVar, a[i], -b[i]]);
    builder.solver.addClause([eqVar, a[i], b[i]]);
    builder.solver.addClause([eqVar, -a[i], -b[i]]);
  }

  // Starting from MSB (index n-1), going down to LSB (index 0)
  // Process in reverse order for the "so far" logic
  for (let bitIdx = n - 1; bitIdx >= 0; bitIdx--) {
    const ltVar = ltSoFar[bitIdx];

    if (bitIdx === n - 1) {
      // MSB: lt = ¬a ∧ b
      // ltVar ↔ (¬a[i] ∧ b[i])
      // ltVar → ¬a[i], ltVar → b[i]
      // (¬a[i] ∧ b[i]) → ltVar
      builder.solver.addClause([-ltVar, -a[bitIdx]]);
      builder.solver.addClause([-ltVar, b[bitIdx]]);
      builder.solver.addClause([ltVar, a[bitIdx], -b[bitIdx]]);
    } else {
      // lt[i] = lt[i+1] ∨ (eqSoFar[i+1:n-1] ∧ ¬a[i] ∧ b[i])
      // Where eqSoFar[i+1:n-1] means all bits from i+1 to n-1 are equal
      //
      // Simpler approach: track "prefix equal" with a single variable
      // prefixEq[i] = all bits from i to n-1 are equal
      // prefixEq[n-1] = eqSoFar[n-1]
      // prefixEq[i] = prefixEq[i+1] ∧ eqSoFar[i]

      // Actually, let's use a simpler recursive definition:
      // lt[i] = lt[i+1] ∨ (prefixEq[i+1] ∧ ¬a[i] ∧ b[i])

      const prevLt = ltSoFar[bitIdx + 1];
      const prevEq = eqSoFar[bitIdx + 1];

      // We need to track if the prefix (from MSB to bitIdx+1) is equal
      // Let's create a cumulative equality variable
      const prefixEqVar = builder.createNamedVariable(
        `${auxPrefix}_prefixEq_${bitIdx}`
      );

      if (bitIdx === n - 2) {
        // Prefix is just the MSB
        // prefixEqVar ↔ eq[n-1]
        builder.solver.addClause([-prefixEqVar, eqSoFar[n - 1]]);
        builder.solver.addClause([prefixEqVar, -eqSoFar[n - 1]]);
      } else {
        // prefixEqVar ↔ (prevPrefixEq ∧ eq[bitIdx+1])
        const prevPrefixEqVar = builder.getVariable(
          `${auxPrefix}_prefixEq_${bitIdx + 1}`
        );
        if (prevPrefixEqVar === undefined) {
          throw new Error("Missing prefix eq variable");
        }
        // prefixEqVar → prevPrefixEq
        builder.solver.addClause([-prefixEqVar, prevPrefixEqVar]);
        // prefixEqVar → eq[bitIdx+1]
        builder.solver.addClause([-prefixEqVar, prevEq]);
        // (prevPrefixEq ∧ eq[bitIdx+1]) → prefixEqVar
        builder.solver.addClause([prefixEqVar, -prevPrefixEqVar, -prevEq]);
      }

      // Now define lt[i] = lt[i+1] ∨ (prefixEq ∧ ¬a[i] ∧ b[i])
      // ltVar ↔ (prevLt ∨ (prefixEqVar ∧ ¬a[i] ∧ b[i]))

      // Create a helper for (prefixEqVar ∧ ¬a[i] ∧ b[i])
      const strictHere = builder.createNamedVariable(
        `${auxPrefix}_strictHere_${bitIdx}`
      );

      // strictHere ↔ (prefixEqVar ∧ ¬a[i] ∧ b[i])
      builder.solver.addClause([-strictHere, prefixEqVar]);
      builder.solver.addClause([-strictHere, -a[bitIdx]]);
      builder.solver.addClause([-strictHere, b[bitIdx]]);
      builder.solver.addClause([
        strictHere,
        -prefixEqVar,
        a[bitIdx],
        -b[bitIdx],
      ]);

      // ltVar ↔ (prevLt ∨ strictHere)
      builder.solver.addClause([-ltVar, prevLt, strictHere]);
      builder.solver.addClause([ltVar, -prevLt]);
      builder.solver.addClause([ltVar, -strictHere]);
    }
  }

  // Final constraint: the overall result (at LSB level) must be true
  builder.addUnit(ltSoFar[0]);
}

/**
 * Utility: Add constraint that at least K of the literals must be false (i.e., at least K variables are false)
 * This is equivalent to: the negations of the literals sum to at least K
 * We use a simple sequential counter encoding for small to medium K values.
 */
export function addAtLeastKFalse(
  builder: FormulaBuilder,
  literals: number[],
  k: number,
  auxPrefix: string
): void {
  const n = literals.length;
  
  // Trivial cases
  if (k <= 0) return; // No constraint needed
  if (k > n) {
    // Impossible: we can't have more than n literals be false
    builder.solver.addClause([]); // Add empty clause to make UNSAT
    return;
  }
  if (k === n) {
    // All literals must be false
    for (const lit of literals) {
      builder.addUnit(-lit);
    }
    return;
  }
  
  // Sequential counter encoding: 
  // count[i][j] = true if at least j of the first i literals are false
  // count[i][0] is always true
  // count[i][j] for j > i is always false
  // count[i][j] = count[i-1][j] ∨ (count[i-1][j-1] ∧ ¬x[i])
  //
  // We only need to track up to k values
  
  // Create auxiliary variables: count[i][j] for i in 1..n, j in 1..min(i, k)
  // We'll use a 2D map keyed by "i_j"
  const countVars = new Map<string, number>();
  
  function getCountVar(i: number, j: number): number | undefined {
    if (j === 0) return undefined; // Always true, don't need a variable
    if (j > i || j > k) return undefined; // Always false conceptually
    const key = `${auxPrefix}_count_${i}_${j}`;
    let v = countVars.get(key);
    if (v === undefined) {
      v = builder.createNamedVariable(key);
      countVars.set(key, v);
    }
    return v;
  }
  
  // Base case: i = 1 (first literal)
  // count[1][1] = ¬x[0] (true iff first literal is false)
  const count11 = getCountVar(1, 1)!;
  // count11 ↔ ¬x[0]
  builder.solver.addClause([-count11, -literals[0]]); // count11 → ¬x[0]
  builder.solver.addClause([count11, literals[0]]);   // ¬x[0] → count11
  
  // Inductive case: for i from 2 to n
  for (let i = 2; i <= n; i++) {
    const xi = literals[i - 1]; // 0-indexed literal
    
    for (let j = 1; j <= Math.min(i, k); j++) {
      const countIJ = getCountVar(i, j)!;
      const countPrev = getCountVar(i - 1, j);      // count[i-1][j]
      const countPrevM1 = getCountVar(i - 1, j - 1); // count[i-1][j-1]
      
      // count[i][j] ↔ count[i-1][j] ∨ (count[i-1][j-1] ∧ ¬xi)
      // Note: if j > i-1, then count[i-1][j] is conceptually false
      // If j-1 === 0, then count[i-1][j-1] is conceptually true
      
      if (j > i - 1) {
        // count[i-1][j] is false, so count[i][j] = (count[i-1][j-1] ∧ ¬xi)
        if (j - 1 === 0) {
          // count[i-1][0] is true, so count[i][j] = ¬xi
          builder.solver.addClause([-countIJ, -xi]);
          builder.solver.addClause([countIJ, xi]);
        } else {
          // count[i][j] = (countPrevM1 ∧ ¬xi)
          builder.solver.addClause([-countIJ, countPrevM1!]);
          builder.solver.addClause([-countIJ, -xi]);
          builder.solver.addClause([countIJ, -countPrevM1!, xi]);
        }
      } else if (j - 1 === 0) {
        // count[i-1][j-1] = true, so count[i][j] = count[i-1][j] ∨ ¬xi
        // countIJ ↔ (countPrev ∨ ¬xi)
        // countIJ → (countPrev ∨ ¬xi): -countIJ ∨ countPrev ∨ ¬xi
        builder.solver.addClause([-countIJ, countPrev!, -xi]);
        // (countPrev ∨ ¬xi) → countIJ: 
        //   countPrev → countIJ: -countPrev ∨ countIJ
        //   ¬xi → countIJ: xi ∨ countIJ
        builder.solver.addClause([countIJ, -countPrev!]);
        builder.solver.addClause([countIJ, xi]);
      } else {
        // General case: count[i][j] = countPrev ∨ (countPrevM1 ∧ ¬xi)
        // Introduce auxiliary for (countPrevM1 ∧ ¬xi)
        const andAux = builder.createNamedVariable(`${auxPrefix}_and_${i}_${j}`);
        // andAux ↔ (countPrevM1 ∧ ¬xi)
        builder.solver.addClause([-andAux, countPrevM1!]);
        builder.solver.addClause([-andAux, -xi]);
        builder.solver.addClause([andAux, -countPrevM1!, xi]);
        
        // countIJ ↔ (countPrev ∨ andAux)
        builder.solver.addClause([-countIJ, countPrev!, andAux]);
        builder.solver.addClause([countIJ, -countPrev!]);
        builder.solver.addClause([countIJ, -andAux]);
      }
    }
  }
  
  // Final constraint: count[n][k] must be true
  const finalCount = getCountVar(n, k);
  if (finalCount !== undefined) {
    builder.addUnit(finalCount);
  }
}
