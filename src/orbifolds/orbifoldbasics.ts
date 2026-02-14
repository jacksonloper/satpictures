/* Orbifold + Lifted Graph data structures (TypeScript)
 *
 * Notes:
 * - Orbifold nodes are unique by their 2D integer coords.
 * - Orbifold edges are stored as 1 or 2 "half-edges" keyed by incident node id.
 *   * If two half-edges exist they must be mutual inverses.
 *   * If one half-edge exists it must be a self-edge with an involutive voltage (A = A^-1).
 * - Lifted nodes are unique by (orbifoldNodeId, voltage).
 * - Lifted edges are unique by unordered pair of lifted node ids.
 * - Lift invariant:
 *   If orbifold has half-edge A --(V)--> B, then for any lifted interior node (A, W),
 *   there is a lifted edge to (B, V * W).
 */

///////////////////////
// Basic numeric types
///////////////////////

export type Int = number;

// 3x3 integer matrix stored row-major.
export type Matrix3x3 = readonly [
  readonly [Int, Int, Int],
  readonly [Int, Int, Int],
  readonly [Int, Int, Int]
];

export const I3: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
] as const;

export function matMul(A: Matrix3x3, B: Matrix3x3): Matrix3x3 {
  const a = A, b = B;
  const r = (i: 0 | 1 | 2, j: 0 | 1 | 2): Int =>
    a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return [
    [r(0, 0), r(0, 1), r(0, 2)],
    [r(1, 0), r(1, 1), r(1, 2)],
    [r(2, 0), r(2, 1), r(2, 2)],
  ] as const;
}

export function matEq(A: Matrix3x3, B: Matrix3x3): boolean {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (A[i][j] !== B[i][j]) return false;
  }
  return true;
}

function det3(M: Matrix3x3): Int {
  const [[a,b,c],[d,e,f],[g,h,i]] = M;
  return a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
}

function adjugate3(M: Matrix3x3): Matrix3x3 {
  const [[a,b,c],[d,e,f],[g,h,i]] = M;
  // Cofactor matrix, then transpose.
  const C00 =  (e*i - f*h);
  const C01 = -(d*i - f*g);
  const C02 =  (d*h - e*g);

  const C10 = -(b*i - c*h);
  const C11 =  (a*i - c*g);
  const C12 = -(a*h - b*g);

  const C20 =  (b*f - c*e);
  const C21 = -(a*f - c*d);
  const C22 =  (a*e - b*d);

  return [
    [C00, C10, C20],
    [C01, C11, C21],
    [C02, C12, C22],
  ] as const;
}

/**
 * Inverse for unimodular integer 3x3 matrices (det = +1 or -1).
 * Throws if not invertible over Z with integer inverse.
 */
export function matInvUnimodular(M: Matrix3x3): Matrix3x3 {
  const det = det3(M);
  if (det !== 1 && det !== -1) {
    throw new Error(`Voltage matrix det must be ±1 for integer inverse; got det=${det}`);
  }
  const adj = adjugate3(M);
  // inv = adj / det; since det is ±1 this is integer.
  if (det === 1) return adj;
  return [
    [-adj[0][0], -adj[0][1], -adj[0][2]],
    [-adj[1][0], -adj[1][1], -adj[1][2]],
    [-adj[2][0], -adj[2][1], -adj[2][2]],
  ] as const;
}

export function isInvolutive(M: Matrix3x3): boolean {
  // A = A^-1  <=>  A*A = I
  return matEq(matMul(M, M), I3);
}

/////////////////////////////
// IDs + canonical key helpers
/////////////////////////////

export type OrbifoldNodeId = string;
export type OrbifoldEdgeId = string;
export type LiftedNodeId = string;
export type LiftedEdgeId = string;

export function nodeIdFromCoord(coord: readonly [Int, Int]): OrbifoldNodeId {
  return `${coord[0]},${coord[1]}`;
}

export function voltageKey(V: Matrix3x3): string {
  // Stable serialization.
  return `${V[0][0]},${V[0][1]},${V[0][2]};${V[1][0]},${V[1][1]},${V[1][2]};${V[2][0]},${V[2][1]},${V[2][2]}`;
}

export function liftedNodeId(nodeId: OrbifoldNodeId, V: Matrix3x3): LiftedNodeId {
  return `${nodeId}#${voltageKey(V)}`;
}

export function liftedEdgeId(a: LiftedNodeId, b: LiftedNodeId): LiftedEdgeId {
  // Unordered, unique.
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/////////////////////////////
// Orbifold structures
/////////////////////////////

export type ExtraData = Record<string, unknown>;

export interface OrbifoldNode<D extends ExtraData = ExtraData> {
  id: OrbifoldNodeId;
  coord: readonly [Int, Int];
  data?: D;
}

export interface OrbifoldHalfEdge {
  to: OrbifoldNodeId;
  voltage: Matrix3x3;
}

export interface OrbifoldEdge<E extends ExtraData = ExtraData> {
  id: OrbifoldEdgeId;

  /**
   * Exactly 1 or 2 entries:
   * - size=2: keys are n1,n2 with mutual inverse voltages.
   * - size=1: key n with value (n, A) and A is involutive.
   */
  halfEdges: Map<OrbifoldNodeId, OrbifoldHalfEdge>;

  data?: E;
}

export interface OrbifoldGrid<
  ND extends ExtraData = ExtraData,
  ED extends ExtraData = ExtraData
> {
  nodes: Map<OrbifoldNodeId, OrbifoldNode<ND>>;
  edges: Map<OrbifoldEdgeId, OrbifoldEdge<ED>>;

  /**
   * Optional adjacency index (node -> incident edge ids) for speed.
   * If absent you can build it with buildAdjacency().
   */
  adjacency?: Map<OrbifoldNodeId, OrbifoldEdgeId[]>;
}

export function buildAdjacency(grid: OrbifoldGrid): Map<OrbifoldNodeId, OrbifoldEdgeId[]> {
  const adj = new Map<OrbifoldNodeId, OrbifoldEdgeId[]>();
  for (const [eid, e] of grid.edges) {
    for (const nid of e.halfEdges.keys()) {
      const arr = adj.get(nid) ?? [];
      arr.push(eid);
      adj.set(nid, arr);
    }
  }
  grid.adjacency = adj;
  return adj;
}

/**
 * Validates the orbifold edge constraints described in your spec.
 * Throws on any violation.
 */
export function validateOrbifoldEdge(edge: OrbifoldEdge): void {
  const n = edge.halfEdges.size;
  if (n !== 1 && n !== 2) throw new Error(`OrbifoldEdge ${edge.id} must have 1 or 2 keys; got ${n}`);

  if (n === 1) {
    const [[k, v]] = Array.from(edge.halfEdges.entries());
    if (v.to !== k) throw new Error(`Self-edge ${edge.id} must map node to itself`);
    if (!isInvolutive(v.voltage)) {
      throw new Error(`Self-edge ${edge.id} voltage must satisfy A=A^-1 (A*A=I)`);
    }
    return;
  }

  // n === 2
  const entries = Array.from(edge.halfEdges.entries());
  const [n1, h1] = entries[0];
  const [n2, h2] = entries[1];

  if (h1.to !== n2) throw new Error(`Edge ${edge.id} key ${n1} must point to ${n2}`);
  if (h2.to !== n1) throw new Error(`Edge ${edge.id} key ${n2} must point to ${n1}`);

  const inv1 = matInvUnimodular(h1.voltage);
  if (!matEq(inv1, h2.voltage)) throw new Error(`Edge ${edge.id} voltages must be inverses`);
}

/////////////////////////////
// Lifted graph structures
/////////////////////////////

export interface LiftedGraphNode<D extends ExtraData = ExtraData> {
  id: LiftedNodeId;
  orbifoldNode: OrbifoldNodeId;
  voltage: Matrix3x3;
  interior: boolean;
  data?: D;
}

export interface LiftedGraphEdge<D extends ExtraData = ExtraData> {
  id: LiftedEdgeId;
  a: LiftedNodeId;
  b: LiftedNodeId;
  orbifoldEdgeId?: OrbifoldEdgeId;
  data?: D;
}

export interface LiftedGraph<
  ND extends ExtraData = ExtraData,
  ED extends ExtraData = ExtraData,
  LND extends ExtraData = ExtraData,
  LED extends ExtraData = ExtraData
> {
  orbifold: OrbifoldGrid<ND, ED>;
  nodes: Map<LiftedNodeId, LiftedGraphNode<LND>>;
  edges: Map<LiftedEdgeId, LiftedGraphEdge<LED>>;
}

/////////////////////////////
// Construction + augmentation
/////////////////////////////

/**
 * Construct an initial lifted graph from an orbifold:
 * - picks "the first" orbifold node in insertion order
 * - creates exactly one lifted node with identity voltage
 * - marks it as non-interior
 * - no lifted edges initially
 */
export function constructLiftedGraphFromOrbifold<
  ND extends ExtraData = ExtraData,
  ED extends ExtraData = ExtraData,
  LND extends ExtraData = ExtraData,
  LED extends ExtraData = ExtraData
>(orbifold: OrbifoldGrid<ND, ED>): LiftedGraph<ND, ED, LND, LED> {
  if (orbifold.nodes.size === 0) throw new Error("OrbifoldGrid has no nodes");

  // Ensure adjacency exists if you want fast augmentation.
  if (!orbifold.adjacency) buildAdjacency(orbifold);

  const first = orbifold.nodes.values().next().value as OrbifoldNode<ND>;
  const rootId = liftedNodeId(first.id, I3);

  const nodes = new Map<LiftedNodeId, LiftedGraphNode<LND>>();
  nodes.set(rootId, {
    id: rootId,
    orbifoldNode: first.id,
    voltage: I3,
    interior: false,
  });

  return {
    orbifold,
    nodes,
    edges: new Map<LiftedEdgeId, LiftedGraphEdge<LED>>(),
  };
}

/**
 * Ensure (orbifoldNode, voltage) lifted node exists, returning its id.
 * Creates it as non-interior if missing.
 */
export function getOrCreateLiftedNode<LND extends ExtraData>(
  g: LiftedGraph<any, any, LND, any>,
  orbifoldNode: OrbifoldNodeId,
  voltage: Matrix3x3,
  initData?: LND
): LiftedNodeId {
  const id = liftedNodeId(orbifoldNode, voltage);
  if (!g.nodes.has(id)) {
    g.nodes.set(id, { id, orbifoldNode, voltage, interior: false, data: initData });
  }
  return id;
}

/**
 * Add a lifted edge between two lifted nodes (unordered unique).
 * Returns edge id.
 */
export function addLiftedEdge<LED extends ExtraData>(
  g: LiftedGraph<any, any, any, LED>,
  a: LiftedNodeId,
  b: LiftedNodeId,
  orbifoldEdgeId?: OrbifoldEdgeId,
  data?: LED
): LiftedEdgeId {
  if (a === b) {
    // allowed (self-edge) if you want, but you said LiftedGraphEdge is pair of nodes "unordered";
    // leaving this permitted. If you want to forbid, throw here.
  }
  const id = liftedEdgeId(a, b);
  if (!g.edges.has(id)) {
    g.edges.set(id, { id, a, b, orbifoldEdgeId, data });
  }
  return id;
}

/**
 * Augment the lifted graph by:
 *  - taking a set/iterable S of currently non-interior lifted node ids
 *  - for each node in S, follow all incident orbifold half-edges out of its orbifold node
 *  - create the required neighbor lifted nodes and lifted edges
 *  - then mark that node as interior
 *
 * This is exactly the closure step your invariant describes.
 *
 * Important: This does NOT automatically add newly created exterior nodes into S.
 * You can decide what frontier to process next (BFS/DFS/etc.).
 */
export function augmentLiftedGraphUntilInterior(
  g: LiftedGraph,
  S: Iterable<LiftedNodeId>
): void {
  const orb = g.orbifold;
  const adj = orb.adjacency ?? buildAdjacency(orb);

  for (const lid of S) {
    const ln = g.nodes.get(lid);
    if (!ln) throw new Error(`Lifted node not found: ${lid}`);
    if (ln.interior) continue;

    const incident = adj.get(ln.orbifoldNode) ?? [];
    for (const eid of incident) {
      const e = orb.edges.get(eid);
      if (!e) continue;

      const half = e.halfEdges.get(ln.orbifoldNode);
      if (!half) continue; // shouldn't happen if adjacency was built correctly

      // If orbifold has A --(V)--> B, and lifted node is (A, W),
      // then neighbor lifted node is (B, W*V).
      const V = half.voltage;
      const W = ln.voltage;
      const WV = matMul(W, V);

      const nbId = getOrCreateLiftedNode(g, half.to, WV);
      addLiftedEdge(g, lid, nbId, eid);
    }

    // After expanding along all orbifold edges, mark as interior.
    ln.interior = true;
  }
}

/**
 * Convenience: pick all currently non-interior lifted nodes and process them.
 * (Often useful for "process current frontier" behavior.)
 */
export function processAllNonInteriorOnce(g: LiftedGraph): void {
  const S: LiftedNodeId[] = [];
  for (const [id, n] of g.nodes) if (!n.interior) S.push(id);
  augmentLiftedGraphUntilInterior(g, S);
}

/////////////////////////////
// Example usage (sketch)
/////////////////////////////

/*
const grid: OrbifoldGrid = {
  nodes: new Map([
    ["0,0", { id: "0,0", coord: [0,0] }],
    ["1,0", { id: "1,0", coord: [1,0] }],
  ]),
  edges: new Map([
    ["e0", {
      id: "e0",
      halfEdges: new Map([
        ["0,0", { to: "1,0", voltage: I3 }],
        ["1,0", { to: "0,0", voltage: I3 }],
      ])
    }]
  ])
};

for (const e of grid.edges.values()) validateOrbifoldEdge(e);

const lifted = constructLiftedGraphFromOrbifold(grid);

// Process root to make it interior, creating neighbors as exterior
processAllNonInteriorOnce(lifted);

// Later: decide a frontier, e.g., all non-interior nodes again
processAllNonInteriorOnce(lifted);
*/
