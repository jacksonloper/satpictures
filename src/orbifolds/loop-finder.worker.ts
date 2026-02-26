/**
 * Web Worker for finding non-self-intersecting loops on orbifold graphs via CaDiCaL SAT solver.
 *
 * Encoding:
 *   - maxLength = maximum number of distinct nodes in the loop.
 *   - Internally uses L = maxLength + 1 steps (step 0 = root, steps 1..L-1).
 *   - Variables:
 *     x[t][v] = "node v is visited at step t" (one-hot per step with null option)
 *     n[t]    = "null at step t" (path has ended)
 *     volt[t][k] = "accumulated voltage at step t is voltage k" (one-hot)
 *   - Step 0 is deterministically the root node with identity voltage.
 *   - Null propagation: if null at t then null at t+1.
 *   - Early termination: if at root at step t (t ≥ 1) then null at t+1.
 *   - Adjacency: if at node A at step t+1 (not null), then at a neighbor of A at step t.
 *   - Voltage tracking: voltage at t+1 determined by orbifold edges between
 *     positions at t and t+1 (may have multiple edges => multiple voltage options).
 *   - Target voltage: the path must achieve the user-selected target voltage.
 *   - Sinz at-most-one encoding for each non-root node (each non-root node used at most once).
 *
 * The worker also supports a "computeVoltages" mode that uses BFS on the
 * lifted graph to enumerate all reachable voltages for paths up to maxLength.
 *
 * The worker can be terminated by the main thread to cancel.
 */

/// <reference lib="webworker" />

import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";
import { solveLoopFinderDegree } from "./loop-finder-degree";

/** A 3x3 integer matrix stored row-major (same as Matrix3x3 in orbifoldbasics). */
export type VoltageMatrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number]
];

/** Serialized edge info including voltage data for the SAT solver. */
export interface OrbifoldEdgeInfo {
  edgeId: string;
  /** The two endpoint node IDs (for self-edges both are the same). */
  endpoints: [string, string];
  /**
   * For each endpoint, the half-edge voltage when traversing FROM that endpoint.
   * halfEdgeVoltages[nodeId] = voltage matrix.
   */
  halfEdgeVoltages: Record<string, VoltageMatrix>;
}

/** Loop method: "nodeAtMostOnce" (standard) or "degreeConstraint" (new: each node has 0 or 2 incident edges) */
export type LoopMethod = "nodeAtMostOnce" | "degreeConstraint";

export interface LoopFinderRequest {
  /** Mode: "computeVoltages" to BFS reachable voltages, "solve" to find a loop, "solveAll" to find loops for all voltages */
  mode: "computeVoltages" | "solve" | "solveAll";
  /** Maximum number of steps in the loop (path length including return to root) */
  maxLength: number;
  /** Minimum number of steps in the loop (default 0). Forbids null at steps 1..minLength. */
  minLength?: number;
  /** The root node ID */
  rootNodeId: string;
  /** All node IDs */
  nodeIds: string[];
  /** Adjacency list: for each node, list of neighbor node IDs */
  adjacency: Record<string, string[]>;
  /** All orbifold edges with voltage information */
  edges: OrbifoldEdgeInfo[];
  /** Node IDs that are black-colored and must be excluded from the path */
  blackNodeIds?: string[];
  /** Target voltage key (required for "solve" mode, ignored for "computeVoltages") */
  targetVoltageKey?: string;
  /** Set of reachable voltage keys and their matrices (required for "solve" mode, ignored for "computeVoltages") */
  reachableVoltages?: Array<{ key: string; matrix: VoltageMatrix }>;
  /** Loop method: "nodeAtMostOnce" (standard) or "degreeConstraint" (each node has 0 or 2 incident used edges). Default: "nodeAtMostOnce" */
  loopMethod?: LoopMethod;
}

export interface LoopFinderResponse {
  success: boolean;
  error?: string;
  messageType: "progress" | "result";
  stats?: { numVars: number; numClauses: number };
  /** If SAT: edges in the loop (by edgeId) */
  loopEdgeIds?: string[];
  /** If SAT: ordered path of node IDs (step 0 = root, last non-null = root) */
  pathNodeIds?: string[];
  /** If SAT: per-step edge IDs that produced the solved voltage (one per consecutive pair in pathNodeIds) */
  pathEdgeIds?: string[];
  /** For "computeVoltages" mode: the set of reachable voltage keys and matrices */
  reachableVoltages?: Array<{ key: string; matrix: VoltageMatrix }>;
  /** For "solveAll" progress: current voltage index being processed */
  solveAllProgress?: { current: number; total: number };
  /** For "solveAll" result: all SAT-satisfiable voltages with their cached loop results */
  solveAllResults?: Array<{
    key: string;
    matrix: VoltageMatrix;
    pathNodeIds: string[];
    loopEdgeIds: string[];
    pathEdgeIds?: string[];
  }>;
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

// ---- Voltage helpers (no orbifoldbasics import in worker) ----

function voltageKeyFromMatrix(V: VoltageMatrix): string {
  return `${V[0][0]},${V[0][1]},${V[0][2]};${V[1][0]},${V[1][1]},${V[1][2]};${V[2][0]},${V[2][1]},${V[2][2]}`;
}

const IDENTITY_MATRIX: VoltageMatrix = [[1,0,0],[0,1,0],[0,0,1]];

function matMulV(A: VoltageMatrix, B: VoltageMatrix): VoltageMatrix {
  const r = (i: 0|1|2, j: 0|1|2): number =>
    A[i][0]*B[0][j] + A[i][1]*B[1][j] + A[i][2]*B[2][j];
  return [
    [r(0,0), r(0,1), r(0,2)],
    [r(1,0), r(1,1), r(1,2)],
    [r(2,0), r(2,1), r(2,2)],
  ];
}

// ---- BFS to compute reachable voltages ----

/**
 * BFS on the lifted graph to find all voltages reachable at the root node
 * within `maxLength` steps. A "reachable voltage" V means there exists a path
 * of length ≤ maxLength from (root, I) that returns to root with accumulated
 * voltage V.
 *
 * We track (orbifoldNodeId, voltage) as the BFS state and expand step-by-step.
 * At each step, if we're at the root, we record the accumulated voltage.
 */
function computeReachableVoltages(req: LoopFinderRequest): LoopFinderResponse {
  const { maxLength, rootNodeId, nodeIds, edges, blackNodeIds } = req;

  const blackSet = new Set(blackNodeIds ?? []);

  // Build per-node outgoing half-edges: from nodeId -> list of {to, voltage}
  const outgoing = new Map<string, Array<{to: string; voltage: VoltageMatrix}>>();
  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, []);
  }
  for (const edge of edges) {
    for (const [fromNode, voltage] of Object.entries(edge.halfEdgeVoltages)) {
      // Find the 'to' node: for a self-edge both endpoints are the same
      let toNode: string;
      if (edge.endpoints[0] === edge.endpoints[1]) {
        toNode = edge.endpoints[0]; // self-edge
      } else {
        toNode = edge.endpoints[0] === fromNode ? edge.endpoints[1] : edge.endpoints[0];
      }
      if (!blackSet.has(toNode)) {
        outgoing.get(fromNode)?.push({ to: toNode, voltage: voltage as VoltageMatrix });
      }
    }
  }

  // BFS: state = (orbifoldNodeId, voltageKey)
  // We track the set of states at each step
  type BFSState = { nodeId: string; voltage: VoltageMatrix; voltageKey: string };

  const identityKey = voltageKeyFromMatrix(IDENTITY_MATRIX);
  const startState: BFSState = { nodeId: rootNodeId, voltage: IDENTITY_MATRIX, voltageKey: identityKey };

  // Current frontier
  let frontier: BFSState[] = [startState];
  // All visited states (to avoid revisiting)
  const visited = new Set<string>();
  visited.add(`${rootNodeId}#${identityKey}`);

  // Collect reachable voltages at root (excluding identity at step 0)
  const reachableVoltageMap = new Map<string, VoltageMatrix>();

  for (let step = 1; step <= maxLength; step++) {
    const nextFrontier: BFSState[] = [];

    for (const state of frontier) {
      if (blackSet.has(state.nodeId)) continue;

      const neighbors = outgoing.get(state.nodeId) ?? [];
      for (const { to, voltage: edgeVoltage } of neighbors) {
        if (blackSet.has(to)) continue;

        const newVoltage = matMulV(state.voltage, edgeVoltage);
        const newVoltageKey = voltageKeyFromMatrix(newVoltage);
        const stateKey = `${to}#${newVoltageKey}`;

        // If we're back at the root, record this voltage
        // (do this before the visited check, since the root+identity state
        //  was pre-marked as visited but is a valid reachable voltage)
        if (to === rootNodeId) {
          if (!reachableVoltageMap.has(newVoltageKey)) {
            reachableVoltageMap.set(newVoltageKey, newVoltage);
          }
        }

        if (!visited.has(stateKey)) {
          visited.add(stateKey);
          const newState: BFSState = { nodeId: to, voltage: newVoltage, voltageKey: newVoltageKey };
          nextFrontier.push(newState);
        }
      }
    }

    // Also check if any frontier state that was already at root got recorded
    // (handled above when to === rootNodeId)

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  const reachableVoltages = Array.from(reachableVoltageMap.entries()).map(([key, matrix]) => ({
    key,
    matrix,
  }));

  return {
    success: true,
    messageType: "result",
    reachableVoltages,
  };
}

// ---- SAT solve for a loop with target voltage ----

function solveLoopFinder(req: LoopFinderRequest, solver: CadicalSolver): LoopFinderResponse {
  const { maxLength, minLength: minLengthRaw, rootNodeId, nodeIds, adjacency, edges, blackNodeIds,
          targetVoltageKey, reachableVoltages } = req;
  const minLength = minLengthRaw ?? 0;

  if (!targetVoltageKey || !reachableVoltages || reachableVoltages.length === 0) {
    return { success: false, error: "No target voltage specified", messageType: "result" };
  }

  // L = maxLength + 1: steps 0..maxLength
  // step 0 = root with identity voltage
  // The path can end early: if we return to root at step t, step t+1 is null.
  const L = maxLength + 1;
  const N = nodeIds.length;
  const V = reachableVoltages.length; // number of voltage options

  // Build set of black node indices
  const blackSet = new Set(blackNodeIds ?? []);

  // Validate
  const hasNonBlack = nodeIds.some(id => !blackSet.has(id));
  if (!hasNonBlack) {
    return { success: false, error: "No non-black nodes available for the loop", messageType: "result" };
  }
  if (blackSet.has(rootNodeId)) {
    return { success: false, error: "Root node must not be black-colored", messageType: "result" };
  }

  // Map nodeId → index
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    nodeIndex.set(nodeIds[i], i);
  }
  const rootIdx = nodeIndex.get(rootNodeId);
  if (rootIdx === undefined) {
    return { success: false, error: "Root node not found in graph", messageType: "result" };
  }

  // Map voltage key → index
  const voltageIndex = new Map<string, number>();
  for (let k = 0; k < V; k++) {
    voltageIndex.set(reachableVoltages[k].key, k);
  }
  const targetVoltIdx = voltageIndex.get(targetVoltageKey);
  if (targetVoltIdx === undefined) {
    return { success: false, error: "Target voltage not in reachable set", messageType: "result" };
  }

  // Build edge lookup: for each pair (fromIdx, toIdx), what voltages can result?
  // edgeVoltageTransitions[fromIdx][toIdx] = list of { voltageMatrix, voltageKey }
  // This maps "if at fromNode at step t and toNode at step t+1, which edge voltages are possible?"
  const edgeVoltageTransitions: Map<string, Array<{key: string; matrix: VoltageMatrix}>> = new Map();
  for (const edge of edges) {
    for (const [fromNode, voltage] of Object.entries(edge.halfEdgeVoltages)) {
      const fromIdx = nodeIndex.get(fromNode);
      if (fromIdx === undefined) continue;

      let toNode: string;
      if (edge.endpoints[0] === edge.endpoints[1]) {
        toNode = edge.endpoints[0];
      } else {
        toNode = edge.endpoints[0] === fromNode ? edge.endpoints[1] : edge.endpoints[0];
      }
      const toIdx = nodeIndex.get(toNode);
      if (toIdx === undefined) continue;

      const pairKey = `${fromIdx},${toIdx}`;
      if (!edgeVoltageTransitions.has(pairKey)) {
        edgeVoltageTransitions.set(pairKey, []);
      }
      edgeVoltageTransitions.get(pairKey)!.push({
        key: voltageKeyFromMatrix(voltage as VoltageMatrix),
        matrix: voltage as VoltageMatrix,
      });
    }
  }

  // ---- Create SAT variables ----

  // x[t][v] = "at step t we are at node v" (NOT null)
  const x: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let v = 0; v < N; v++) {
      row.push(solver.newVariable());
    }
    x.push(row);
  }

  // nl[t] = "null at step t" (path has ended before step t)
  const nl: number[] = [];
  for (let t = 0; t < L; t++) {
    nl.push(solver.newVariable());
  }

  // volt[t][k] = "accumulated voltage at step t is voltage k"
  // (only meaningful when not null; we also track the identity voltage at step 0)
  // We need to include the identity voltage in the voltage set for step 0.
  // But identity may or may not be in the reachable voltages list.
  // Let's add identity as index V (a special voltage) if it's not already there.
  const identityKey = voltageKeyFromMatrix(IDENTITY_MATRIX);
  let identityVoltIdx = voltageIndex.get(identityKey);
  const totalVoltages = identityVoltIdx !== undefined ? V : V + 1;
  if (identityVoltIdx === undefined) {
    identityVoltIdx = V; // Extra index for identity
  }

  const volt: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let k = 0; k < totalVoltages; k++) {
      row.push(solver.newVariable());
    }
    volt.push(row);
  }

  // Build full voltage list (reachable + possibly identity)
  const allVoltages: Array<{key: string; matrix: VoltageMatrix}> = [...reachableVoltages];
  if (identityVoltIdx === V) {
    allVoltages.push({ key: identityKey, matrix: IDENTITY_MATRIX });
  }

  // ---- Constraints ----

  // Step 0: at root, not null, identity voltage
  solver.addClause([x[0][rootIdx]]);
  for (let v = 0; v < N; v++) {
    if (v !== rootIdx) solver.addClause([-x[0][v]]);
  }
  solver.addClause([-nl[0]]); // not null at step 0
  solver.addClause([volt[0][identityVoltIdx!]]); // identity voltage at step 0
  for (let k = 0; k < totalVoltages; k++) {
    if (k !== identityVoltIdx) solver.addClause([-volt[0][k]]);
  }

  // At each step: exactly one of {x[t][0], ..., x[t][N-1], nl[t]} is true
  for (let t = 1; t < L; t++) {
    // At least one
    solver.addClause([...x[t], nl[t]]);
    // At most one (pairwise): each node vs null
    for (let v = 0; v < N; v++) {
      solver.addClause([-x[t][v], -nl[t]]);
    }
    // At most one among nodes
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        solver.addClause([-x[t][i], -x[t][j]]);
      }
    }
  }

  // Null propagation: if null at t, then null at t+1
  for (let t = 0; t < L - 1; t++) {
    solver.addClause([-nl[t], nl[t + 1]]);
  }

  // Minimum length: forbid null at steps 1..minLength
  for (let t = 1; t <= minLength && t < L; t++) {
    solver.addClause([-nl[t]]);
  }

  // Early termination: if at root at step t (t >= 1), then null at t+1
  // x[t][rootIdx] AND t >= 1 => nl[t+1]
  for (let t = 1; t < L - 1; t++) {
    solver.addClause([-x[t][rootIdx], nl[t + 1]]);
  }

  // The path must actually return to root at some point (not stay null forever)
  // At least one step t >= 1 must have x[t][rootIdx] true
  {
    const rootSteps: number[] = [];
    for (let t = 1; t < L; t++) {
      rootSteps.push(x[t][rootIdx]);
    }
    solver.addClause(rootSteps);
  }

  // Adjacency: if at node v at step t+1 (not null), then at a neighbor of v at step t (not null)
  for (let t = 1; t < L; t++) {
    for (let v = 0; v < N; v++) {
      const neighbors = adjacency[nodeIds[v]] ?? [];
      const neighborIndices = neighbors.map(nid => nodeIndex.get(nid)).filter((idx): idx is number => idx !== undefined);
      // x[t][v] => OR(x[t-1][nb] for nb in neighbors(v))
      const clause = [-x[t][v], ...neighborIndices.map(nb => x[t - 1][nb])];
      solver.addClause(clause);
    }
  }

  // Non-self-intersecting: each non-root node used at most once across ALL steps
  // (excluding null steps). Black nodes excluded entirely.
  for (let v = 0; v < N; v++) {
    const isBlack = blackSet.has(nodeIds[v]);
    if (isBlack) {
      for (let t = 0; t < L; t++) {
        solver.addClause([-x[t][v]]);
      }
    } else if (v === rootIdx) {
      // Root can appear at step 0, and at most one step t >= 1 (the return step).
      // At intermediate steps (between start and return), root should not appear.
      // Actually, root appears at step 0 and exactly once more at a later step.
      // The "if root at t>=1 then null at t+1" constraint handles early termination.
      // We need: root appears at most once in steps 1..L-1
      const rootLits: number[] = [];
      for (let t = 1; t < L; t++) {
        rootLits.push(x[t][rootIdx]);
      }
      addSinzAtMostOne(solver, rootLits);
    } else {
      const lits: number[] = [];
      for (let t = 1; t < L; t++) {
        lits.push(x[t][v]);
      }
      addSinzAtMostOne(solver, lits);
    }
  }

  // ---- Voltage tracking ----

  // At each step, exactly one voltage is active (or null => no constraint on voltage)
  // When null, all voltage vars should be false (voltage is undefined)
  for (let t = 1; t < L; t++) {
    // If null, all voltage vars are false
    for (let k = 0; k < totalVoltages; k++) {
      solver.addClause([-nl[t], -volt[t][k]]);
    }
    // If not null, exactly one voltage
    // At least one when not null: ¬nl[t] => OR(volt[t][k])
    solver.addClause([nl[t], ...volt[t]]);
    // At most one voltage (pairwise)
    for (let i = 0; i < totalVoltages; i++) {
      for (let j = i + 1; j < totalVoltages; j++) {
        solver.addClause([-volt[t][i], -volt[t][j]]);
      }
    }
  }

  // Voltage transitions: if at node A at step t and node B at step t+1,
  // then voltage at t+1 must be reachable from voltage at t via some edge from A to B.
  //
  // For each step t (0..L-2), for each pair (fromNode a, toNode b):
  //   x[t][a] ∧ x[t+1][b] => possible voltage transitions
  //
  // The transition: volt[t] = k AND edge A->B has voltage V
  //   => volt[t+1] = index of (allVoltages[k].matrix * V)
  //
  // We encode: x[t][a] ∧ x[t+1][b] ∧ volt[t][k] => OR(volt[t+1][k'] for valid k')
  for (let t = 0; t < L - 1; t++) {
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const pairKey = `${a},${b}`;
        const transitions = edgeVoltageTransitions.get(pairKey);
        if (!transitions || transitions.length === 0) continue;

        // For each voltage k at step t, compute possible voltages at t+1
        for (let k = 0; k < totalVoltages; k++) {
          const possibleNextVoltIndices = new Set<number>();
          for (const { matrix: edgeV } of transitions) {
            const newV = matMulV(allVoltages[k].matrix, edgeV);
            const newKey = voltageKeyFromMatrix(newV);
            const idx = voltageIndex.get(newKey);
            if (idx !== undefined) {
              possibleNextVoltIndices.add(idx);
            }
            // Also check identity index if separate
            if (identityVoltIdx === V && newKey === identityKey) {
              possibleNextVoltIndices.add(V);
            }
          }

          if (possibleNextVoltIndices.size === 0) {
            // This combination is impossible: x[t][a] ∧ x[t+1][b] ∧ volt[t][k] => false
            solver.addClause([-x[t][a], -x[t + 1][b], -volt[t][k]]);
          } else {
            // x[t][a] ∧ x[t+1][b] ∧ volt[t][k] => OR(volt[t+1][k'] for k' in possibleNextVoltIndices)
            const clause: number[] = [-x[t][a], -x[t + 1][b], -volt[t][k]];
            for (const ki of possibleNextVoltIndices) {
              clause.push(volt[t + 1][ki]);
            }
            solver.addClause(clause);
          }
        }
      }
    }
  }

  // Target voltage constraint: at the step where we return to root, the voltage must be the target.
  // For each step t >= 1: x[t][rootIdx] => volt[t][targetVoltIdx]
  for (let t = 1; t < L; t++) {
    solver.addClause([-x[t][rootIdx], volt[t][targetVoltIdx]]);
  }

  // Send progress
  const stats = { numVars: solver.getVariableCount(), numClauses: solver.getClauseCount() };
  self.postMessage({ success: true, messageType: "progress", stats } as LoopFinderResponse);

  // Solve
  const result = solver.solve();
  if (!result.satisfiable) {
    return { success: false, error: "No non-self-intersecting loop with this voltage exists", messageType: "result" };
  }

  const assignment = result.assignment;

  // Extract the path (skip null steps)
  const path: number[] = [];
  for (let t = 0; t < L; t++) {
    if (assignment.get(nl[t])) break; // null => path ended
    for (let v = 0; v < N; v++) {
      if (assignment.get(x[t][v])) {
        path.push(v);
        break;
      }
    }
  }

  // Extract per-step voltages from the SAT assignment
  const pathVoltages: (number | undefined)[] = []; // voltage index at each non-null step
  for (let t = 0; t < path.length; t++) {
    let found: number | undefined;
    for (let k = 0; k < totalVoltages; k++) {
      if (assignment.get(volt[t][k])) {
        found = k;
        break;
      }
    }
    pathVoltages.push(found);
  }

  // Determine per-step edge IDs by matching voltage transitions
  // For each step t -> t+1, find the specific edge whose half-edge voltage
  // transforms allVoltages[pathVoltages[t]] into allVoltages[pathVoltages[t+1]]
  const pathEdgeIds: string[] = [];
  for (let t = 0; t < path.length - 1; t++) {
    const fromNode = nodeIds[path[t]];
    const toNode = nodeIds[path[t + 1]];
    const vt = pathVoltages[t];
    const vt1 = pathVoltages[t + 1];
    const voltBefore = (vt !== undefined && vt < allVoltages.length) ? allVoltages[vt].matrix : IDENTITY_MATRIX;
    const voltAfter = (vt1 !== undefined && vt1 < allVoltages.length) ? allVoltages[vt1].matrix : IDENTITY_MATRIX;
    const voltAfterKey = voltageKeyFromMatrix(voltAfter);

    // Find the edge that produces this voltage transition
    let bestEdgeId: string | undefined;
    for (const edge of edges) {
      const hv = edge.halfEdgeVoltages[fromNode];
      if (!hv) continue;
      // Check that this edge connects fromNode to toNode
      let edgeTo: string;
      if (edge.endpoints[0] === edge.endpoints[1]) {
        edgeTo = edge.endpoints[0];
      } else {
        edgeTo = edge.endpoints[0] === fromNode ? edge.endpoints[1] : edge.endpoints[0];
      }
      if (edgeTo !== toNode) continue;

      // Check voltage transition: voltBefore * edgeVoltage should equal voltAfter
      const result = matMulV(voltBefore, hv);
      if (voltageKeyFromMatrix(result) === voltAfterKey) {
        bestEdgeId = edge.edgeId;
        break;
      }
    }
    pathEdgeIds.push(bestEdgeId ?? "");
  }

  // Determine which edges are in the loop
  const usedPairs = new Set<string>();
  for (let t = 0; t < path.length - 1; t++) {
    const a = path[t];
    const b = path[t + 1];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    usedPairs.add(key);
  }

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

  const pathNodeIds = path.map(v => nodeIds[v]);

  return { success: true, messageType: "result", loopEdgeIds, pathNodeIds, pathEdgeIds };
}

// ---- Worker message handler ----

self.onmessage = async (event: MessageEvent<LoopFinderRequest>) => {
  try {
    const req = event.data;

    if (req.mode === "computeVoltages") {
      // BFS mode: no SAT solver needed
      const response = computeReachableVoltages(req);
      self.postMessage(response);
      return;
    }

    if (req.mode === "solveAll") {
      // Phase 1: BFS to find reachable voltages
      const bfsResponse = computeReachableVoltages(req);
      const voltages = bfsResponse.reachableVoltages ?? [];

      if (voltages.length === 0) {
        self.postMessage({
          success: false,
          error: "No reachable voltages found for this max length",
          messageType: "result",
        } as LoopFinderResponse);
        return;
      }

      // Phase 2: Try SAT solve for each voltage
      const module = await getModule();
      const satResults: Array<{
        key: string;
        matrix: VoltageMatrix;
        pathNodeIds: string[];
        loopEdgeIds: string[];
        pathEdgeIds?: string[];
      }> = [];

      for (let i = 0; i < voltages.length; i++) {
        // Send progress
        self.postMessage({
          success: true,
          messageType: "progress",
          solveAllProgress: { current: i + 1, total: voltages.length },
        } as LoopFinderResponse);

        const cadical = new Cadical(module);
        const solver = new CadicalSolver(cadical);

        const solveReq: LoopFinderRequest = {
          ...req,
          mode: "solve",
          targetVoltageKey: voltages[i].key,
          reachableVoltages: voltages,
        };

        const result = req.loopMethod === "degreeConstraint"
          ? solveLoopFinderDegree(solveReq, solver)
          : solveLoopFinder(solveReq, solver);
        cadical.release();

        if (result.success && result.pathNodeIds && result.loopEdgeIds) {
          satResults.push({
            key: voltages[i].key,
            matrix: voltages[i].matrix,
            pathNodeIds: result.pathNodeIds,
            loopEdgeIds: result.loopEdgeIds,
            pathEdgeIds: result.pathEdgeIds,
          });
        }
      }

      self.postMessage({
        success: true,
        messageType: "result",
        solveAllResults: satResults,
      } as LoopFinderResponse);
      return;
    }

    // Solve mode: use SAT solver
    const module = await getModule();
    const cadical = new Cadical(module);
    const solver = new CadicalSolver(cadical);

    const response = req.loopMethod === "degreeConstraint"
      ? solveLoopFinderDegree(req, solver, (msg) => self.postMessage(msg))
      : solveLoopFinder(req, solver);
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
