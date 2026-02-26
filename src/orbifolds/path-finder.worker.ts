/**
 * Web Worker for finding nonbranching paths on orbifold graphs via CaDiCaL SAT solver.
 *
 * Encoding:
 *   - For each orbifold edge e (including self-edges), a Boolean variable solid_e
 *     indicates whether the edge is solid (true) or dashed (false).
 *
 *   - For each node n, let incident(n) be the set of edges that include n.
 *
 *   - empty_n  ↔  all edges incident to n are dashed.
 *   - endless_n ↔  exactly two of the edges incident to n are solid.
 *
 *   - Assert (empty_n ∨ endless_n) for every node n.
 *
 *   - total = Sinz-encoded count of nodes with endless_n.
 *     Assert total ≥ k  (user-specified minimum).
 *
 * The worker can be terminated by the main thread to cancel.
 */

/// <reference lib="webworker" />

import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";

/** Serialized edge info for the SAT solver. */
export interface PathEdgeInfo {
  edgeId: string;
  /** The two endpoint node IDs (for self-edges both are the same). */
  endpoints: [string, string];
}

export interface PathFinderRequest {
  /** All node IDs */
  nodeIds: string[];
  /** All orbifold edges with endpoints */
  edges: PathEdgeInfo[];
  /** Minimum number of nodes that must be on a path (k) */
  minNodes: number;
}

export interface PathFinderResponse {
  success: boolean;
  error?: string;
  messageType: "progress" | "result";
  stats?: { numVars: number; numClauses: number };
  /** If SAT: for each edge, whether it should be solid or dashed */
  edgeStyles?: Record<string, "solid" | "dashed">;
  /** If SAT: count of nodes on paths (endless_n = true) */
  pathNodeCount?: number;
}

// ---- CaDiCaL WASM boilerplate (same pattern as loop-finder.worker.ts) ----

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

// ---- Sinz sequential counter: at least k ----

/**
 * Sinz sequential counter encoding for "at least k" cardinality constraint.
 *
 * Creates auxiliary register variables r[i][j] where
 *   r[i][j] ↔ "at least (j+1) of lits[0..i] are true"
 *
 * Then asserts r[n-1][k-1] to enforce sum ≥ k.
 */
function addSinzAtLeastK(solver: CadicalSolver, lits: number[], k: number): void {
  const n = lits.length;
  if (k <= 0) return;
  if (k > n) {
    solver.addClause([]);
    return;
  }
  if (k === n) {
    for (const lit of lits) {
      solver.addClause([lit]);
    }
    return;
  }

  // r[i][j]: "at least (j+1) of lits[0..i] are true"
  const r: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      row.push(solver.newVariable());
    }
    r.push(row);
  }

  // Base case: i = 0
  // r[0][0] ↔ lits[0]
  solver.addClause([-lits[0], r[0][0]]);
  solver.addClause([lits[0], -r[0][0]]);
  // r[0][j] = false for j > 0
  for (let j = 1; j < k; j++) {
    solver.addClause([-r[0][j]]);
  }

  // Inductive case: i > 0
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < k; j++) {
      if (j === 0) {
        // r[i][0]: "at least 1 of lits[0..i]"
        solver.addClause([-lits[i], r[i][0]]);
        solver.addClause([-r[i - 1][0], r[i][0]]);
        solver.addClause([-r[i][0], r[i - 1][0], lits[i]]);
      } else {
        // r[i][j]: "at least (j+1) of lits[0..i]"
        // Forward: carry or increment
        solver.addClause([-r[i - 1][j], r[i][j]]);
        solver.addClause([-lits[i], -r[i - 1][j - 1], r[i][j]]);
        // Backward: must be justified
        solver.addClause([-r[i][j], r[i - 1][j], lits[i]]);
        solver.addClause([-r[i][j], r[i - 1][j], r[i - 1][j - 1]]);
      }
    }
  }

  // Assert: at least k
  solver.addClause([r[n - 1][k - 1]]);
}

// ---- SAT encoding ----

function solveNonbranchingPaths(req: PathFinderRequest, solver: CadicalSolver): PathFinderResponse {
  const { nodeIds, edges, minNodes } = req;
  const N = nodeIds.length;
  const E = edges.length;

  if (N === 0) {
    return { success: false, error: "No nodes in the graph", messageType: "result" };
  }
  if (minNodes > N) {
    return { success: false, error: `Minimum nodes (${minNodes}) exceeds total nodes (${N})`, messageType: "result" };
  }

  // Node index
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    nodeIndex.set(nodeIds[i], i);
  }

  // Build incidence: for each node, which edge indices are incident
  const incidentEdges: number[][] = Array.from({ length: N }, () => []);
  for (let e = 0; e < E; e++) {
    const [a, b] = edges[e].endpoints;
    const aIdx = nodeIndex.get(a);
    const bIdx = nodeIndex.get(b);
    if (aIdx !== undefined) {
      incidentEdges[aIdx].push(e);
    }
    if (bIdx !== undefined && bIdx !== aIdx) {
      incidentEdges[bIdx].push(e);
    }
  }

  // Variables: solid_e for each edge
  const solid: number[] = [];
  for (let e = 0; e < E; e++) {
    solid.push(solver.newVariable());
  }

  // Variables: empty_n for each node
  const empty: number[] = [];
  for (let n = 0; n < N; n++) {
    empty.push(solver.newVariable());
  }

  // Variables: endless_n for each node
  const endless: number[] = [];
  for (let n = 0; n < N; n++) {
    endless.push(solver.newVariable());
  }

  // Biconditional: empty_n ↔ ∧(¬solid_e for all incident e)
  for (let n = 0; n < N; n++) {
    const inc = incidentEdges[n];

    // Forward: empty_n → ¬solid_e for all incident e
    for (const e of inc) {
      solver.addClause([-empty[n], -solid[e]]);
    }

    // Backward: ∧(¬solid_e) → empty_n
    solver.addClause([...inc.map(e => solid[e]), empty[n]]);
  }

  // Biconditional: endless_n ↔ exactly 2 of the incident edges are solid
  for (let n = 0; n < N; n++) {
    const inc = incidentEdges[n];
    const m = inc.length;

    if (m < 2) {
      // Cannot have exactly 2 edges if fewer than 2 are incident
      solver.addClause([-endless[n]]);
    } else {
      // Forward: endless_n → at least 1 edge is on
      solver.addClause([-endless[n], ...inc.map(e => solid[e])]);

      // Forward: endless_n → at least 2 (if one is on, another must be too)
      for (let i = 0; i < m; i++) {
        const others = inc.filter((_, idx) => idx !== i);
        solver.addClause([-endless[n], -solid[inc[i]], ...others.map(e => solid[e])]);
      }

      // Forward: endless_n → at most 2 (no three can all be on)
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          for (let k = j + 1; k < m; k++) {
            solver.addClause([-endless[n], -solid[inc[i]], -solid[inc[j]], -solid[inc[k]]]);
          }
        }
      }

      // Backward: exactly 2 → endless_n
      // For each pair (i,j): if both are on and all others off, then endless_n
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          const others = inc.filter((_, idx) => idx !== i && idx !== j);
          solver.addClause([-solid[inc[i]], -solid[inc[j]], ...others.map(e => solid[e]), endless[n]]);
        }
      }
    }
  }

  // Assert: empty_n ∨ endless_n for each node
  for (let n = 0; n < N; n++) {
    solver.addClause([empty[n], endless[n]]);
  }

  // Sinz sequential counter: sum(endless_n) ≥ minNodes
  addSinzAtLeastK(solver, endless, minNodes);

  // Send progress
  const stats = { numVars: solver.getVariableCount(), numClauses: solver.getClauseCount() };
  self.postMessage({ success: true, messageType: "progress", stats } as PathFinderResponse);

  // Solve
  const result = solver.solve();
  if (!result.satisfiable) {
    return { success: false, error: "No nonbranching path configuration exists with this minimum node count", messageType: "result" };
  }

  const assignment = result.assignment;

  // Extract edge styles
  const edgeStyles: Record<string, "solid" | "dashed"> = {};
  for (let e = 0; e < E; e++) {
    edgeStyles[edges[e].edgeId] = assignment.get(solid[e]) ? "solid" : "dashed";
  }

  // Count path nodes
  let pathNodeCount = 0;
  for (let n = 0; n < N; n++) {
    if (assignment.get(endless[n])) {
      pathNodeCount++;
    }
  }

  return { success: true, messageType: "result", edgeStyles, pathNodeCount };
}

// ---- Worker message handler ----

self.onmessage = async (event: MessageEvent<PathFinderRequest>) => {
  try {
    const req = event.data;
    const module = await getModule();
    const cadical = new Cadical(module);
    const solver = new CadicalSolver(cadical);

    const response = solveNonbranchingPaths(req, solver);
    cadical.release();
    self.postMessage(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const response: PathFinderResponse = {
      success: false,
      error: errorMessage,
      messageType: "result",
    };
    self.postMessage(response);
  }
};
