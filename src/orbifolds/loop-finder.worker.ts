/**
 * Web Worker for finding non-self-intersecting loops on orbifold graphs via CaDiCaL SAT solver.
 *
 * Encoding:
 *   - Variables: x[t][v] = "node v is visited at step t" (one-hot per step)
 *   - Step 0 and step (L-1) are deterministically the root node.
 *   - Adjacency: if at node A at step t, then at a neighbor of A at step t-1.
 *   - Sinz at-most-one encoding for each non-root node (each non-root node used at most once).
 *   - Root node has no usage constraint (it appears at first and last step).
 *
 * The worker can be terminated by the main thread to cancel.
 */

/// <reference lib="webworker" />

import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";

export interface LoopFinderRequest {
  /** Loop length (number of steps, including start=root and end=root) */
  loopLength: number;
  /** The root node ID */
  rootNodeId: string;
  /** All node IDs */
  nodeIds: string[];
  /** Adjacency list: for each node, list of neighbor node IDs */
  adjacency: Record<string, string[]>;
  /** All edge IDs with their endpoint node IDs (for result mapping) */
  edges: Array<{ edgeId: string; endpoints: [string, string] }>;
}

export interface LoopFinderResponse {
  success: boolean;
  error?: string;
  messageType: "progress" | "result";
  stats?: { numVars: number; numClauses: number };
  /** If SAT: edges in the loop (by edgeId) */
  loopEdgeIds?: string[];
}

// ---- CaDiCaL WASM boilerplate (same pattern as other workers) ----

interface CadicalModule {
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  onRuntimeInitialized?: () => void;
  locateFile?: (path: string) => string;
}

declare const self: typeof globalThis & {
  Module?: CadicalModule;
};

class Cadical implements CadicalClass {
  private solverPtr: number | undefined = undefined;
  private module: CadicalModule;
  constructor(module: CadicalModule) { this.module = module; this.init(); }
  init(): void {
    this.release();
    this.solverPtr = this.module.ccall("ccadical_init", "number", [], []) as number;
  }
  initPlain(): void {
    this.init();
    for (const o of ["compact","decompose","deduplicate","elim","probe","subsume","ternary","transred","vivify"]) {
      this.setOption(o, 0);
    }
  }
  initSat(): void {
    this.init();
    this.setOption("elimreleff", 10);
    this.setOption("stabilizeonly", 1);
    this.setOption("subsumereleff", 60);
  }
  initUnsat(): void {
    this.init();
    this.setOption("stabilize", 0);
    this.setOption("walk", 0);
  }
  release(): void {
    if (this.solverPtr !== undefined) {
      this.module.ccall("ccadical_release", null, ["number"], [this.solverPtr]);
    }
    this.solverPtr = undefined;
  }
  signature(): string { return this.module.ccall("ccadical_signature", "string", [], []) as string; }
  add(litOrZero: number): void { this.module.ccall("ccadical_add", null, ["number","number"], [this.solverPtr, litOrZero]); }
  addClause(clause: number[]): void { for (const lit of clause) this.add(lit); this.add(0); }
  assume(lit: number): void { this.module.ccall("ccadical_assume", null, ["number","number"], [this.solverPtr, lit]); }
  solve(): boolean | undefined {
    const r = this.module.ccall("ccadical_solve", "number", ["number"], [this.solverPtr]) as number;
    return r === 10 ? true : r === 20 ? false : undefined;
  }
  value(lit: number): number {
    const v = this.module.ccall("ccadical_val", "number", ["number","number"], [this.solverPtr, lit]) as number;
    return v === 0 ? lit : v;
  }
  model(vars: number[]): number[] { return vars.map(v => this.value(v)); }
  constrain(litOrZero: number): void { this.module.ccall("ccadical_constrain", null, ["number","number"], [this.solverPtr, litOrZero]); }
  constrainClause(clause: number[]): void { for (const lit of clause) this.constrain(lit); this.constrain(0); }
  setOption(name: string, v: number): void { this.module.ccall("ccadical_set_option", null, ["number","string","number"], [this.solverPtr, name, v]); }
  printStatistics(): void { this.module.ccall("ccadical_print_statistics", null, ["number"], [this.solverPtr]); }
}

function loadCadicalModule(): Promise<CadicalModule> {
  return new Promise((resolve, reject) => {
    fetch("/cadical/cadical-emscripten.js")
      .then(response => { if (!response.ok) throw new Error(`Failed to fetch CaDiCaL script: ${response.status}`); return response.text(); })
      .then(scriptText => {
        (self as Record<string, unknown>)["Module"] = { locateFile: (path: string) => `/cadical/${path}` };
        (0, eval)(scriptText);
        if (self.Module) { self.Module.onRuntimeInitialized = () => resolve(self.Module!); }
        else reject(new Error("CaDiCaL module failed to load"));
      })
      .catch(error => reject(new Error(`Failed to load CaDiCaL: ${error}`)));
  });
}

let modulePromise: Promise<CadicalModule> | null = null;
function getModule(): Promise<CadicalModule> {
  if (!modulePromise) modulePromise = loadCadicalModule();
  return modulePromise;
}

// ---- SAT encoding ----

/**
 * Sinz sequential counter encoding for at-most-one constraint.
 * Uses O(n) auxiliary variables and O(n) clauses (much better than pairwise for large n).
 *
 *   r_1, ..., r_{n-1}  are auxiliary "register" variables.
 *   Clauses:
 *     ¬x_i ∨ r_i             for i = 1..n-1
 *     ¬r_i ∨ r_{i+1}         for i = 1..n-2      (propagate)
 *     ¬x_{i+1} ∨ ¬r_i       for i = 1..n-1      (conflict)
 */
function addSinzAtMostOne(solver: CadicalSolver, lits: number[]): void {
  const n = lits.length;
  if (n <= 1) return;
  if (n === 2) {
    solver.addClause([-lits[0], -lits[1]]);
    return;
  }
  // Create n-1 register variables
  const regs: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    regs.push(solver.newVariable());
  }
  for (let i = 0; i < n - 1; i++) {
    // ¬x_i ∨ r_i
    solver.addClause([-lits[i], regs[i]]);
  }
  for (let i = 0; i < n - 2; i++) {
    // ¬r_i ∨ r_{i+1}
    solver.addClause([-regs[i], regs[i + 1]]);
  }
  for (let i = 0; i < n - 1; i++) {
    // ¬x_{i+1} ∨ ¬r_i
    solver.addClause([-lits[i + 1], -regs[i]]);
  }
}

function solveLoopFinder(req: LoopFinderRequest, solver: CadicalSolver): LoopFinderResponse {
  const { loopLength: L, rootNodeId, nodeIds, adjacency, edges } = req;
  const N = nodeIds.length;

  // Map nodeId → index
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    nodeIndex.set(nodeIds[i], i);
  }

  const rootIdx = nodeIndex.get(rootNodeId);
  if (rootIdx === undefined) {
    return { success: false, error: "Root node not found in graph", messageType: "result" };
  }

  // Create variables: x[t][v] for t in [0, L-1], v in [0, N-1]
  // x[t][v] means "at step t we are at node v"
  const x: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let v = 0; v < N; v++) {
      row.push(solver.newVariable());
    }
    x.push(row);
  }

  // Step 0 is deterministically the root
  solver.addClause([x[0][rootIdx]]);
  for (let v = 0; v < N; v++) {
    if (v !== rootIdx) solver.addClause([-x[0][v]]);
  }

  // Step L-1 is deterministically the root
  solver.addClause([x[L - 1][rootIdx]]);
  for (let v = 0; v < N; v++) {
    if (v !== rootIdx) solver.addClause([-x[L - 1][v]]);
  }

  // One-hot per step: exactly one node is active at each step
  for (let t = 1; t < L - 1; t++) {
    // At least one
    solver.addClause(x[t].slice());
    // At most one (pairwise is fine per step since N is small for orbifolds)
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        solver.addClause([-x[t][i], -x[t][j]]);
      }
    }
  }

  // Adjacency constraints: if at node v at step t (t >= 1), 
  // then at step t-1 must be at some neighbor of v.
  for (let t = 1; t < L; t++) {
    for (let v = 0; v < N; v++) {
      const neighbors = adjacency[nodeIds[v]] ?? [];
      const neighborIndices = neighbors.map(nid => nodeIndex.get(nid)).filter((idx): idx is number => idx !== undefined);
      // x[t][v] => OR(x[t-1][nb] for nb in neighbors(v))
      // i.e., ¬x[t][v] ∨ x[t-1][nb1] ∨ x[t-1][nb2] ∨ ...
      const clause = [-x[t][v], ...neighborIndices.map(nb => x[t - 1][nb])];
      solver.addClause(clause);
    }
  }

  // Non-self-intersecting: each non-root node used at most once across all steps.
  // Use Sinz encoding for efficiency.
  // Root node doesn't need this (it appears at step 0 and step L-1).
  for (let v = 0; v < N; v++) {
    if (v === rootIdx) continue;
    // Collect all x[t][v] for t in [0, L-1]
    // Actually root forces x[0][v]=false and x[L-1][v]=false for non-root v,
    // so we only need t in [1, L-2]
    const lits: number[] = [];
    for (let t = 1; t < L - 1; t++) {
      lits.push(x[t][v]);
    }
    addSinzAtMostOne(solver, lits);
  }

  // Send progress
  const stats = { numVars: solver.getVariableCount(), numClauses: solver.getClauseCount() };
  self.postMessage({ success: true, messageType: "progress", stats, solution: null } as LoopFinderResponse);

  // Solve
  const result = solver.solve();
  if (!result.satisfiable) {
    return { success: false, error: "No non-self-intersecting loop of this length exists", messageType: "result" };
  }

  const assignment = result.assignment;

  // Extract the path
  const path: number[] = [];
  for (let t = 0; t < L; t++) {
    for (let v = 0; v < N; v++) {
      if (assignment.get(x[t][v])) {
        path.push(v);
        break;
      }
    }
  }

  // Determine which edges are in the loop
  // Build a set of (nodeIdx_a, nodeIdx_b) pairs representing consecutive steps
  const usedPairs = new Set<string>();
  for (let t = 0; t < path.length - 1; t++) {
    const a = path[t];
    const b = path[t + 1];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    usedPairs.add(key);
  }

  // Map edge endpoints to edgeIds
  const loopEdgeIds: string[] = [];
  for (const edge of edges) {
    const aIdx = nodeIndex.get(edge.endpoints[0]);
    const bIdx = nodeIndex.get(edge.endpoints[1]);
    if (aIdx === undefined || bIdx === undefined) continue;
    const key = aIdx < bIdx ? `${aIdx},${bIdx}` : `${bIdx},${aIdx}`;
    if (usedPairs.has(key)) {
      loopEdgeIds.push(edge.edgeId);
    }
  }

  return { success: true, messageType: "result", loopEdgeIds };
}

// ---- Worker message handler ----

self.onmessage = async (event: MessageEvent<LoopFinderRequest>) => {
  try {
    const module = await getModule();
    const cadical = new Cadical(module);
    const solver = new CadicalSolver(cadical);

    const response = solveLoopFinder(event.data, solver);
    cadical.release();
    self.postMessage(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const response: LoopFinderResponse = {
      success: false,
      error: errorMessage,
      messageType: "result",
    };
    self.postMessage(response);
  }
};
