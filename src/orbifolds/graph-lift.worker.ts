/**
 * Web Worker for running the CaDiCaL SAT solver for graph lift arborescence problems.
 *
 * Given an orbifold and its lifted graph, find an arborescence rooted at a chosen
 * lifted node R such that a target lifted node N has depth >= DST.
 *
 * Encoding:
 * - Each orbifold node picks exactly one incident orbifold edge as its "parent edge".
 *   (Self-edges are allowed, so an orbifold node can be its own parent.)
 * - Each lifted node's parent in the arborescence is determined by the orbifold choice:
 *   the lifted neighbor reached via the chosen orbifold edge.
 * - Depth is tracked per lifted node via unary encoding (sinz-style):
 *     depth_d(u) means "depth of u >= d"
 *   with chain constraints depth_d(u) → depth_{d-1}(u).
 * - Root lifted node has depth 0 (depth_1(root) is false).
 * - The orbifold node of the root still must choose a parent edge.
 * - Non-root lifted nodes have depth = 1 + depth(parent).
 * - Target node N must satisfy depth_DST(N) (i.e. depth >= DST).
 *
 * The worker can be terminated by the main thread to cancel.
 */

/// <reference lib="webworker" />

import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";
import type {
  OrbifoldNodeId,
  OrbifoldEdgeId,
  LiftedNodeId,
} from "./orbifoldbasics";

// ─── Request / Response types ──────────────────────────────────────────

export interface GraphLiftRequest {
  /** Orbifold nodes: array of node IDs */
  orbifoldNodeIds: OrbifoldNodeId[];
  /**
   * Orbifold edges: for each edge, its ID plus the set of half-edge endpoints.
   * Each half-edge records from→to and the voltage (serialised as a string key
   * so we can reconstruct lifted-node IDs).
   */
  orbifoldEdges: Array<{
    edgeId: OrbifoldEdgeId;
    halfEdges: Array<{ from: OrbifoldNodeId; to: OrbifoldNodeId }>;
  }>;
  /** Adjacency: for each orbifold node, its incident edge IDs */
  orbifoldAdjacency: Array<[OrbifoldNodeId, OrbifoldEdgeId[]]>;
  /** Lifted nodes: array of { id, orbifoldNode } */
  liftedNodes: Array<{ id: LiftedNodeId; orbifoldNode: OrbifoldNodeId }>;
  /**
   * Lifted edges: each records the two lifted-node endpoints *and* which
   * orbifold edge it comes from.
   */
  liftedEdges: Array<{
    a: LiftedNodeId;
    b: LiftedNodeId;
    orbifoldEdgeId: OrbifoldEdgeId;
  }>;
  /** The lifted node chosen as the arborescence root */
  rootLiftedNodeId: LiftedNodeId;
  /** The lifted node that must be "deep" */
  targetLiftedNodeId: LiftedNodeId;
  /** Minimum depth required for the target node */
  minDepth: number;
}

export interface GraphLiftResponse {
  success: boolean;
  error?: string;
  messageType: "progress" | "result";
  stats?: { numVars: number; numClauses: number };
  /** On success, the arborescence solution */
  result?: {
    /** For each orbifold node, the chosen parent edge ID */
    orbifoldParentEdge: Array<[OrbifoldNodeId, OrbifoldEdgeId]>;
    /** For each lifted node, its parent lifted node (null for root) */
    liftedParent: Array<[LiftedNodeId, LiftedNodeId | null]>;
    /** For each lifted node, its depth in the arborescence */
    liftedDepth: Array<[LiftedNodeId, number]>;
  };
}

// ─── CaDiCaL boilerplate (same as other workers) ──────────────────────

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
  constructor(module: CadicalModule) {
    this.module = module;
    this.init();
  }
  init(): void {
    this.release();
    this.solverPtr = this.module.ccall("ccadical_init", "number", [], []) as number;
  }
  initPlain(): void {
    this.init();
    for (const opt of ["compact","decompose","deduplicate","elim","probe","subsume","ternary","transred","vivify"])
      this.setOption(opt, 0);
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
  signature(): string {
    return this.module.ccall("ccadical_signature", "string", [], []) as string;
  }
  add(litOrZero: number): void {
    this.module.ccall("ccadical_add", null, ["number", "number"], [this.solverPtr, litOrZero]);
  }
  addClause(clause: number[]): void {
    for (const lit of clause) this.add(lit);
    this.add(0);
  }
  assume(lit: number): void {
    this.module.ccall("ccadical_assume", null, ["number", "number"], [this.solverPtr, lit]);
  }
  solve(): boolean | undefined {
    const r = this.module.ccall("ccadical_solve", "number", ["number"], [this.solverPtr]) as number;
    return r === 10 ? true : r === 20 ? false : undefined;
  }
  value(lit: number): number {
    const v = this.module.ccall("ccadical_val", "number", ["number", "number"], [this.solverPtr, lit]) as number;
    return v === 0 ? lit : v;
  }
  model(vars: number[]): number[] {
    return vars.map(v => this.value(v));
  }
  constrain(litOrZero: number): void {
    this.module.ccall("ccadical_constrain", null, ["number", "number"], [this.solverPtr, litOrZero]);
  }
  constrainClause(clause: number[]): void {
    for (const lit of clause) this.constrain(lit);
    this.constrain(0);
  }
  setOption(name: string, v: number): void {
    this.module.ccall("ccadical_set_option", null, ["number", "string", "number"], [this.solverPtr, name, v]);
  }
  printStatistics(): void {
    this.module.ccall("ccadical_print_statistics", null, ["number"], [this.solverPtr]);
  }
}

function loadCadicalModule(): Promise<CadicalModule> {
  return new Promise((resolve, reject) => {
    fetch("/cadical/cadical-emscripten.js")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(txt => {
        (self as Record<string, unknown>)["Module"] = { locateFile: (p: string) => `/cadical/${p}` };
        (0, eval)(txt);
        if (self.Module) self.Module.onRuntimeInitialized = () => resolve(self.Module!);
        else reject(new Error("CaDiCaL module failed to load"));
      })
      .catch(e => reject(new Error(`Failed to load CaDiCaL: ${e}`)));
  });
}

let modulePromise: Promise<CadicalModule> | null = null;
function getModule(): Promise<CadicalModule> {
  if (!modulePromise) modulePromise = loadCadicalModule();
  return modulePromise;
}

// ─── SAT encoding ─────────────────────────────────────────────────────

interface CNF {
  numVars: number;
  clauses: number[][];
  varOf: Map<string, number>;
}

function newCNF(): CNF {
  return { numVars: 0, clauses: [], varOf: new Map() };
}

function v(cnf: CNF, name: string): number {
  const existing = cnf.varOf.get(name);
  if (existing !== undefined) return existing;
  const id = ++cnf.numVars;
  cnf.varOf.set(name, id);
  return id;
}

function addClause(cnf: CNF, lits: number[]): void {
  const s = new Set<number>();
  for (const lit of lits) {
    if (s.has(-lit)) return; // tautology
    s.add(lit);
  }
  cnf.clauses.push([...s]);
}

function addUnit(cnf: CNF, lit: number): void { addClause(cnf, [lit]); }
function addImp(cnf: CNF, a: number, b: number): void { addClause(cnf, [-a, b]); }

function addExactlyOne(cnf: CNF, lits: number[]): void {
  addClause(cnf, lits); // at least one
  for (let i = 0; i < lits.length; i++)
    for (let j = i + 1; j < lits.length; j++)
      addClause(cnf, [-lits[i], -lits[j]]); // at most one (pairwise)
}

function buildGraphLiftCNF(req: GraphLiftRequest): CNF {
  const cnf = newCNF();

  const {
    orbifoldNodeIds,
    orbifoldEdges,
    orbifoldAdjacency,
    liftedNodes,
    liftedEdges,
    rootLiftedNodeId,
    targetLiftedNodeId,
    minDepth,
  } = req;

  const N = liftedNodes.length;
  if (N === 0) throw new Error("No lifted nodes");

  // Build index: orbifold node → incident edge IDs
  const orbAdj = new Map<OrbifoldNodeId, OrbifoldEdgeId[]>(orbifoldAdjacency);

  // Build index: orbifold edge → half-edge info
  const orbEdgeHalves = new Map<OrbifoldEdgeId, Array<{ from: OrbifoldNodeId; to: OrbifoldNodeId }>>();
  for (const e of orbifoldEdges) {
    orbEdgeHalves.set(e.edgeId, e.halfEdges);
  }

  // Build lifted adjacency: for each lifted node, neighbours grouped by orbifold edge
  // liftedNeighborsByOrbEdge[liftedNodeId][orbifoldEdgeId] = [neighbour lifted node ids]
  const liftedNeighborsByOrbEdge = new Map<LiftedNodeId, Map<OrbifoldEdgeId, LiftedNodeId[]>>();
  for (const ln of liftedNodes) {
    liftedNeighborsByOrbEdge.set(ln.id, new Map());
  }
  for (const le of liftedEdges) {
    const mapA = liftedNeighborsByOrbEdge.get(le.a);
    const mapB = liftedNeighborsByOrbEdge.get(le.b);
    if (mapA) {
      const arr = mapA.get(le.orbifoldEdgeId) ?? [];
      arr.push(le.b);
      mapA.set(le.orbifoldEdgeId, arr);
    }
    if (mapB) {
      const arr = mapB.get(le.orbifoldEdgeId) ?? [];
      arr.push(le.a);
      mapB.set(le.orbifoldEdgeId, arr);
    }
  }

  // Build lifted-node orbifold-node lookup
  const liftedOrbNode = new Map<LiftedNodeId, OrbifoldNodeId>();
  for (const ln of liftedNodes) {
    liftedOrbNode.set(ln.id, ln.orbifoldNode);
  }

  // ────────────────────── Variables ──────────────────────

  // chooseEdge(orbNode, orbEdgeId) = "orbifold node orbNode picks orbEdgeId as parent"
  const chooseEdgeVar = (orbNode: OrbifoldNodeId, edgeId: OrbifoldEdgeId) =>
    v(cnf, `choose(${orbNode},${edgeId})`);

  // liftedParent(liftedId, neighborLiftedId) = "lifted node liftedId's parent is neighborLiftedId"
  const liftedParentVar = (u: LiftedNodeId, p: LiftedNodeId) =>
    v(cnf, `lpar(${u},${p})`);

  // depth_d(liftedId) = "depth of liftedId >= d"
  const depthVar = (u: LiftedNodeId, d: number) =>
    v(cnf, `depth(${u})>=${d}`);

  // ──────────── Orbifold: each node picks exactly one edge ────────────

  for (const orbNodeId of orbifoldNodeIds) {
    const edges = orbAdj.get(orbNodeId) ?? [];
    if (edges.length === 0) continue; // isolated orbifold node, shouldn't happen in practice

    // Exactly one edge is chosen
    const lits = edges.map(eid => chooseEdgeVar(orbNodeId, eid));
    addExactlyOne(cnf, lits);
  }

  // ──────── Lifted parent: determined by orbifold choice ──────────────
  // For each lifted node u (non-root):
  //   For each orbifold edge e incident to orb(u):
  //     chooseEdge(orb(u), e) → liftedParent(u, neighbor_via_e)
  //     ¬chooseEdge(orb(u), e) → ¬liftedParent(u, neighbor_via_e)
  //
  // Non-root lifted nodes may or may not have a parent depending on
  // whether the chosen orbifold edge connects to an interior neighbor.
  // We use at-most-one (not exactly-one) for parent selection.

  // hasParent(u) = "lifted node u has a parent in the arborescence"
  const hasParentVar = (u: LiftedNodeId) => v(cnf, `hasPar(${u})`);

  for (const ln of liftedNodes) {
    if (ln.id === rootLiftedNodeId) continue; // root has no parent in arborescence

    const orbNode = ln.orbifoldNode;
    const edgeIds = orbAdj.get(orbNode) ?? [];
    const neighborsByEdge = liftedNeighborsByOrbEdge.get(ln.id);
    if (!neighborsByEdge) continue;

    const allParentLits: number[] = [];

    for (const eid of edgeIds) {
      const neighbors = neighborsByEdge.get(eid) ?? [];
      const ce = chooseEdgeVar(orbNode, eid);

      if (neighbors.length === 0) {
        // This orbifold edge doesn't connect to any lifted neighbor of this node.
        // If the orbifold chooses this edge, this lifted node has no parent.
        continue;
      }

      // If there's exactly one neighbor via this edge (usual case):
      // chooseEdge ↔ liftedParent
      if (neighbors.length === 1) {
        const pVar = liftedParentVar(ln.id, neighbors[0]);
        addImp(cnf, ce, pVar);   // choose → parent
        addImp(cnf, pVar, ce);   // parent → choose
        allParentLits.push(pVar);
      } else {
        // Multiple neighbors via same orbifold edge (unusual but possible).
        // If the orbifold edge is chosen, exactly one of these neighbors is the parent.
        // chooseEdge → at least one parent among these neighbors
        const pVars = neighbors.map(nb => liftedParentVar(ln.id, nb));
        addClause(cnf, [-ce, ...pVars]);
        // Each pVar → chooseEdge
        for (const pv of pVars) addImp(cnf, pv, ce);
        allParentLits.push(...pVars);
      }
    }

    // At most one parent (could be zero if orbifold chose an edge with no neighbors)
    if (allParentLits.length > 0) {
      // At most one parent
      for (let i = 0; i < allParentLits.length; i++)
        for (let j = i + 1; j < allParentLits.length; j++)
          addClause(cnf, [-allParentLits[i], -allParentLits[j]]);

      // hasParent ↔ (at least one parent)
      const hp = hasParentVar(ln.id);
      // hp → at least one parent
      addClause(cnf, [-hp, ...allParentLits]);
      // each parent → hp
      for (const pv of allParentLits) addImp(cnf, pv, hp);
    } else {
      // No possible parent → this node can never have a parent
      addUnit(cnf, -hasParentVar(ln.id));
    }
  }

  // Root has no parent
  {
    const orbNode = liftedOrbNode.get(rootLiftedNodeId)!;
    const edgeIds = orbAdj.get(orbNode) ?? [];
    const neighborsByEdge = liftedNeighborsByOrbEdge.get(rootLiftedNodeId);
    if (neighborsByEdge) {
      for (const eid of edgeIds) {
        const neighbors = neighborsByEdge.get(eid) ?? [];
        for (const nb of neighbors) {
          // Root cannot have a parent
          const pVar = cnf.varOf.get(`lpar(${rootLiftedNodeId},${nb})`);
          if (pVar !== undefined) addUnit(cnf, -pVar);
        }
      }
    }
  }

  // ──────── Depth constraints (unary encoding) ────────────────────────

  // Root has depth 0: ¬depth_1(root)
  addUnit(cnf, -depthVar(rootLiftedNodeId, 1));

  // Monotonicity: depth_d(u) → depth_{d-1}(u) for d >= 2
  for (const ln of liftedNodes) {
    for (let d = 2; d <= N; d++) {
      addImp(cnf, depthVar(ln.id, d), depthVar(ln.id, d - 1));
    }
  }

  // Upper bound: depth < N for all nodes
  for (const ln of liftedNodes) {
    addUnit(cnf, -depthVar(ln.id, N));
  }

  // Non-root nodes WITH a parent must have positive depth
  // hasParent(u) → depth(u) >= 1
  for (const ln of liftedNodes) {
    if (ln.id === rootLiftedNodeId) continue;
    const hp = cnf.varOf.get(`hasPar(${ln.id})`);
    if (hp !== undefined) {
      addImp(cnf, hp, depthVar(ln.id, 1));
    }
  }

  // Nodes WITHOUT a parent have depth 0 (¬hasParent(u) → ¬depth_1(u))
  for (const ln of liftedNodes) {
    if (ln.id === rootLiftedNodeId) continue;
    const hp = cnf.varOf.get(`hasPar(${ln.id})`);
    if (hp !== undefined) {
      // ¬hp → ¬depth_1  ≡  depth_1 → hp
      addImp(cnf, depthVar(ln.id, 1), hp);
    }
  }

  // Distance ordering: liftedParent(u, p) ∧ depth(p) >= d → depth(u) >= d+1
  // and reverse: liftedParent(u, p) ∧ depth(u) >= d+1 → depth(p) >= d
  for (const ln of liftedNodes) {
    if (ln.id === rootLiftedNodeId) continue;

    const orbNode = ln.orbifoldNode;
    const edgeIds = orbAdj.get(orbNode) ?? [];
    const neighborsByEdge = liftedNeighborsByOrbEdge.get(ln.id);
    if (!neighborsByEdge) continue;

    for (const eid of edgeIds) {
      const neighbors = neighborsByEdge.get(eid) ?? [];
      for (const nb of neighbors) {
        const pVarName = `lpar(${ln.id},${nb})`;
        const pVar = cnf.varOf.get(pVarName);
        if (pVar === undefined) continue;

        // lpar(u, p) → depth(u) >= 1  (already enforced above for non-root)

        // Forward: lpar(u, p) ∧ depth(p) >= d → depth(u) >= d+1
        for (let d = 0; d < N; d++) {
          if (d === 0) {
            // depth(p) >= 0 is always true → lpar(u,p) → depth(u) >= 1
            addImp(cnf, pVar, depthVar(ln.id, 1));
          } else {
            addClause(cnf, [-pVar, -depthVar(nb, d), depthVar(ln.id, d + 1)]);
          }
        }

        // Reverse: lpar(u, p) ∧ depth(u) >= d+1 → depth(p) >= d
        for (let d = 1; d <= N; d++) {
          if (d === 1) {
            // lpar(u,p) ∧ depth(u) >= 1 → depth(p) >= 0 (trivially true)
          } else {
            addClause(cnf, [-pVar, -depthVar(ln.id, d), depthVar(nb, d - 1)]);
          }
        }
      }
    }
  }

  // ──────── Target depth constraint ───────────────────────────────────

  if (minDepth > 0) {
    if (minDepth >= N) {
      // Impossible – add empty clause
      addClause(cnf, []);
    } else {
      addUnit(cnf, depthVar(targetLiftedNodeId, minDepth));
    }
  }

  return cnf;
}

// ─── Main message handler ─────────────────────────────────────────────

function formatErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("Cannot enlarge memory") || msg.includes("Out of memory") || msg.includes("abort()")) {
    return "Out of memory – the problem is too large. Try a smaller expansion or grid.";
  }
  return msg;
}

self.onmessage = async (event: MessageEvent<GraphLiftRequest>) => {
  const req = event.data;

  try {
    const cnf = buildGraphLiftCNF(req);

    // Send progress with stats
    const progress: GraphLiftResponse = {
      success: true,
      messageType: "progress",
      stats: { numVars: cnf.numVars, numClauses: cnf.clauses.length },
    };
    self.postMessage(progress);

    // Load CaDiCaL
    const module = await getModule();
    const cadical = new Cadical(module);
    const solver = new CadicalSolver(cadical);

    // Create variables
    for (let i = 1; i <= cnf.numVars; i++) solver.newVariable();
    // Add clauses
    for (const cl of cnf.clauses) solver.addClause(cl);

    // Solve
    const result = solver.solve();
    if (!result.satisfiable) {
      cadical.release();
      const resp: GraphLiftResponse = {
        success: false,
        error: "No solution found (unsatisfiable)",
        messageType: "result",
      };
      self.postMessage(resp);
      return;
    }

    const assignment = result.assignment!;

    // ── Extract solution ──

    // Orbifold parent edges
    const orbifoldParentEdge: Array<[OrbifoldNodeId, OrbifoldEdgeId]> = [];
    for (const orbNodeId of req.orbifoldNodeIds) {
      const edges = new Map(req.orbifoldAdjacency).get(orbNodeId) ?? [];
      for (const eid of edges) {
        const varName = `choose(${orbNodeId},${eid})`;
        const varId = cnf.varOf.get(varName);
        if (varId !== undefined && assignment.get(varId)) {
          orbifoldParentEdge.push([orbNodeId, eid]);
          break;
        }
      }
    }

    // Lifted parents
    const liftedParent: Array<[LiftedNodeId, LiftedNodeId | null]> = [];
    for (const ln of req.liftedNodes) {
      if (ln.id === req.rootLiftedNodeId) {
        liftedParent.push([ln.id, null]);
        continue;
      }
      let foundParent: LiftedNodeId | null = null;
      // Search all variables for this node's parent
      for (const [varName, varId] of cnf.varOf) {
        if (varName.startsWith(`lpar(${ln.id},`) && assignment.get(varId)) {
          // The format is lpar(<ln.id>,<parent>)
          const prefix = `lpar(${ln.id},`;
          const parentId = varName.slice(prefix.length, -1);
          foundParent = parentId;
          break;
        }
      }
      liftedParent.push([ln.id, foundParent]);
    }

    // Lifted depths: count how many depth_d variables are true
    const liftedDepth: Array<[LiftedNodeId, number]> = [];
    for (const ln of req.liftedNodes) {
      let depth = 0;
      for (let d = 1; d <= req.liftedNodes.length; d++) {
        const varName = `depth(${ln.id})>=${d}`;
        const varId = cnf.varOf.get(varName);
        if (varId !== undefined && assignment.get(varId)) {
          depth = d;
        } else {
          break;
        }
      }
      liftedDepth.push([ln.id, depth]);
    }

    cadical.release();

    const resp: GraphLiftResponse = {
      success: true,
      messageType: "result",
      result: { orbifoldParentEdge, liftedParent, liftedDepth },
    };
    self.postMessage(resp);
  } catch (error) {
    const resp: GraphLiftResponse = {
      success: false,
      error: formatErrorMessage(error),
      messageType: "result",
    };
    self.postMessage(resp);
  }
};
