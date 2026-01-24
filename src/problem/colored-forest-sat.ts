/**
 * Colored Forest SAT CNF Builder
 *
 * Uses UNARY distance encoding for better SAT solver performance.
 * Instead of binary bit-vectors, each node has N boolean variables:
 *   dist_d(u) = "distance of u is at least d"
 *
 * These form a decreasing chain: dist_d(u) → dist_(d-1)(u)
 * The constraint dist(child) = dist(parent) + 1 becomes simple implications.
 *
 * Key constraints:
 * A) Anti-parallel-parent: ¬par(u→v) ∨ ¬par(v→u)
 * B) Distance ordering: par(u,v) ∧ dist_d(v) → dist_(d+1)(u)
 * C) Each non-root picks exactly one parent
 */

/**
 * Input configuration for building the colored forest SAT CNF
 */
export interface ColoredForestInput {
  /** Collection of node identifiers (can be any type that converts to string) */
  nodes: Iterable<string | number>;
  /** List of edges as [u, v] pairs */
  edges: [string | number, string | number][];
  /** Optional hints for node colors. Use -1 for "any color". */
  nodeColorHint?: Record<string, number>;
  /** Required: maps each color to its root node */
  rootOfColor: Record<string, string | number>;
  /** Optional: list of [node, minDistance] constraints */
  distLowerBounds?: [string | number, number][];
}

/**
 * Result of building the colored forest SAT CNF
 */
export interface ColoredForestCNFResult {
  /** Total number of variables in the CNF */
  numVars: number;
  /** List of clauses, each clause is an array of literals */
  clauses: number[][];
  /** Map from variable name to variable ID */
  varOf: Map<string, number>;
  /** Map from variable ID to variable name */
  nameOf: Map<number, string>;
  /** DIMACS format string of the CNF */
  dimacs: string;
  /** Metadata about the encoding */
  meta: {
    colors: number[];
    kBits: number;
    maxDistance: number;
    nodes: string[];
    edges: [string, string][];
  };
}

/**
 * Internal CNF builder class
 */
class CNF {
  numVars = 0;
  clauses: number[][] = [];
  varOf = new Map<string, number>();
  nameOf = new Map<number, string>();

  v(name: string): number {
    if (this.varOf.has(name)) return this.varOf.get(name)!;
    const id = ++this.numVars;
    this.varOf.set(name, id);
    this.nameOf.set(id, name);
    return id;
  }

  addClause(lits: number[]): void {
    const s = new Set<number>();
    for (const lit of lits) {
      if (s.has(-lit)) return; // tautology
      s.add(lit);
    }
    this.clauses.push([...s]);
  }

  addUnit(lit: number): void {
    this.addClause([lit]);
  }

  addImp(a: number, b: number): void {
    this.addClause([-a, b]);
  }

  addAtMostOnePairwise(lits: number[]): void {
    for (let i = 0; i < lits.length; i++)
      for (let j = i + 1; j < lits.length; j++)
        this.addClause([-lits[i], -lits[j]]);
  }

  addExactlyOne(lits: number[]): void {
    this.addClause(lits);
    this.addAtMostOnePairwise(lits);
  }

  toDimacs(): string {
    let out = `p cnf ${this.numVars} ${this.clauses.length}\n`;
    for (const cl of this.clauses) out += `${cl.join(" ")} 0\n`;
    return out;
  }
}

/**
 * Build a SAT CNF formula for the colored forest problem.
 *
 * This encoding uses UNARY distance representation for better propagation:
 * - dist_d(u) means "distance of u from root is at least d"
 * - Simple implication chains instead of binary arithmetic
 *
 * @param input - Configuration specifying nodes, edges, colors, roots, and constraints
 * @returns The CNF formula and metadata
 */
export function buildColoredForestSatCNF(
  input: ColoredForestInput
): ColoredForestCNFResult {
  const { nodes, edges, nodeColorHint, rootOfColor, distLowerBounds } = input;

  const nodeList = [...nodes].map(String);
  const N = nodeList.length;
  if (N === 0) throw new Error("No nodes.");
  const nodeIndex = new Map(nodeList.map((n, i) => [n, i]));

  // Allowed colors: all nonnegative colors in hints or rootOfColor keys
  const colorSet = new Set<number>();
  for (const n of nodeList) {
    const c = nodeColorHint?.[n];
    if (typeof c === "number" && c >= 0) colorSet.add(c);
  }
  for (const k of Object.keys(rootOfColor || {})) {
    const c = Number(k);
    if (Number.isInteger(c) && c >= 0) colorSet.add(c);
  }
  const colors = [...colorSet].sort((a, b) => a - b);
  if (colors.length === 0)
    throw new Error(
      "No nonnegative colors provided (need at least one active color)."
    );

  // Validate rootOfColor covers every used color
  for (const c of colors) {
    if (!(String(c) in (rootOfColor || {})))
      throw new Error(`Missing rootOfColor entry for color ${c}.`);
    const r = String(rootOfColor[String(c)]);
    if (!nodeIndex.has(r))
      throw new Error(`Root ${r} for color ${c} is not in nodes.`);
  }

  // adjacency
  const adj = new Map<string, Set<string>>(nodeList.map((n) => [n, new Set()]));
  const edgeKey = (a: string, b: string): string => {
    return a < b ? `${a}--${b}` : `${b}--${a}`;
  };
  const undirectedEdges: [string, string][] = [];
  const edgeSeen = new Set<string>();
  for (const [u0, v0] of edges) {
    const u = String(u0),
      v = String(v0);
    if (!nodeIndex.has(u) || !nodeIndex.has(v))
      throw new Error(`Edge contains unknown node: [${u0},${v0}]`);
    if (u === v) throw new Error(`Self-loop edge not allowed: ${u0}`);
    const k = edgeKey(u, v);
    if (edgeSeen.has(k)) continue;
    edgeSeen.add(k);
    undirectedEdges.push([u, v]);
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  }

  // Max distance is N-1 (longest possible path in a tree)
  const maxDist = N - 1;

  const cnf = new CNF();

  // ---------- variables ----------
  const colVar = (u: string, c: number) => cnf.v(`col(${u})=${c}`);
  const parentVar = (u: string, v: string) => cnf.v(`par(${u})->(${v})`);
  const keepVar = (u: string, v: string) => cnf.v(`keep(${edgeKey(u, v)})`);

  // UNARY distance encoding: dist_d(u) means "distance of u is >= d"
  // We only need dist_1, dist_2, ..., dist_maxDist (dist_0 is always true)
  const distVar = (u: string, d: number) => cnf.v(`dist(${u})>=${d}`);

  // ---------- each node exactly one color ----------
  for (const u of nodeList) {
    cnf.addExactlyOne(colors.map((c) => colVar(u, c)));

    const hinted = nodeColorHint?.[u];
    if (typeof hinted === "number") {
      if (hinted === -1) {
        // ok - any color
      } else if (Number.isInteger(hinted) && hinted >= 0) {
        if (!colorSet.has(hinted))
          throw new Error(
            `Hinted color ${hinted} for node ${u} not in allowed set.`
          );
        cnf.addUnit(colVar(u, hinted));
      } else {
        throw new Error(
          `nodeColorHint[${u}] must be -1 or a nonnegative integer.`
        );
      }
    }
  }

  // ---------- unary distance chain constraints ----------
  // dist_d(u) → dist_(d-1)(u) for all d >= 2 up to N
  for (const u of nodeList) {
    for (let d = 2; d <= N; d++) {
      cnf.addImp(distVar(u, d), distVar(u, d - 1));
    }
  }

  // ---------- roots per color ----------
  for (const c of colors) {
    const r = String(rootOfColor[String(c)]);
    cnf.addUnit(colVar(r, c));
    // Root has distance 0, so dist_d(root) is false for all d >= 1
    cnf.addUnit(-distVar(r, 1));
  }

  // ---------- global distance cap: dist(u) < N for all nodes ----------
  // This prevents "infinite" distances that could allow disconnected trees
  for (const u of nodeList) {
    // dist(u) >= N should be false (distance must be at most N-1)
    cnf.addUnit(-distVar(u, N));
  }

  // ---------- keep/parent linkage + same-color gating + anti-parallel-parent ----------
  for (const [u, v] of undirectedEdges) {
    const k = keepVar(u, v);
    const puv = parentVar(u, v);
    const pvu = parentVar(v, u);

    // A) Anti-parallel parent: can't both choose each other.
    cnf.addClause([-puv, -pvu]);

    // par -> keep
    cnf.addImp(puv, k);
    cnf.addImp(pvu, k);

    // keep -> (par one way)
    cnf.addClause([-k, puv, pvu]);

    // keep enforces same color at endpoints:
    for (const c of colors) {
      const cu = colVar(u, c);
      const cv = colVar(v, c);
      cnf.addClause([-k, -cu, cv]);
      cnf.addClause([-k, -cv, cu]);
    }
  }

  // ---------- parent implies dist(child) = dist(parent) + 1 ----------
  // Using unary encoding: par(u,v) means v is parent of u
  // If par(u,v) and dist(v) >= d, then dist(u) >= d+1
  // If par(u,v) and dist(u) >= d+1, then dist(v) >= d
  for (const u of nodeList) {
    for (const v of adj.get(u)!) {
      const p = parentVar(u, v);

      // (redundant but fine) preserve color along parent edge
      for (const c of colors) {
        const cu = colVar(u, c);
        const cv = colVar(v, c);
        cnf.addClause([-p, -cu, cv]);
        cnf.addClause([-p, -cv, cu]);
      }

      // Distance increment constraints:
      // par(u,v) ∧ dist(v)>=d → dist(u)>=(d+1)
      // Loop up to N-1 so that the last constraint uses dist(u) >= N
      for (let d = 0; d < N; d++) {
        if (d === 0) {
          // dist(v) >= 0 is always true, so: par(u,v) → dist(u) >= 1
          cnf.addImp(p, distVar(u, 1));
        } else {
          // par(u,v) ∧ dist(v)>=d → dist(u)>=(d+1)
          cnf.addClause([-p, -distVar(v, d), distVar(u, d + 1)]);
        }
      }

      // Also enforce the reverse: par(u,v) ∧ ¬dist(v)>=d → ¬dist(u)>=(d+1)
      // Equivalently: par(u,v) ∧ dist(u)>=(d+1) → dist(v)>=d
      // Loop up to N so the last constraint uses dist(u) >= N
      for (let d = 1; d <= N; d++) {
        if (d === 1) {
          // par(u,v) ∧ dist(u)>=1 → dist(v)>=0 (always true, skip)
        } else {
          // par(u,v) ∧ dist(u)>=d → dist(v)>=(d-1)
          cnf.addClause([-p, -distVar(u, d), distVar(v, d - 1)]);
        }
      }
    }
  }

  // ---------- each non-root node of color c picks exactly one parent ----------
  for (const u of nodeList) {
    const neigh = [...adj.get(u)!];

    for (const c of colors) {
      const root = String(rootOfColor[String(c)]);
      const cu = colVar(u, c);

      if (u === root) {
        // root has no parent
        for (const v of neigh) cnf.addUnit(-parentVar(u, v));
      } else {
        const pLits = neigh.map((v) => parentVar(u, v));
        if (pLits.length === 0) {
          cnf.addClause([-cu]); // cannot be this color if isolated and not root
        } else {
          // cu -> at least one parent
          cnf.addClause([-cu, ...pLits]);
          // cu -> at most one parent
          for (let i = 0; i < pLits.length; i++) {
            for (let j = i + 1; j < pLits.length; j++) {
              cnf.addClause([-cu, -pLits[i], -pLits[j]]);
            }
          }
          // cu -> dist(u) >= 1 (non-root must have positive distance)
          cnf.addClause([-cu, distVar(u, 1)]);
        }
      }
    }
  }

  // ---------- per-node lower bounds: dist(node) >= minDist ----------
  for (const [n0, minD0] of distLowerBounds || []) {
    const n = String(n0);
    const minD = Number(minD0);
    if (!nodeIndex.has(n))
      throw new Error(`distLowerBounds references unknown node ${n0}`);
    if (!Number.isInteger(minD) || minD < 0)
      throw new Error(`minDist must be a nonnegative integer for node ${n0}`);
    if (minD > maxDist) {
      cnf.addClause([]); // unsatisfiable
      continue;
    }
    if (minD > 0) {
      cnf.addUnit(distVar(n, minD));
    }
  }

  // For compatibility with existing code, compute kBits
  let kBits = 0;
  while ((1 << kBits) <= N) kBits++;

  return {
    numVars: cnf.numVars,
    clauses: cnf.clauses,
    varOf: cnf.varOf,
    nameOf: cnf.nameOf,
    dimacs: cnf.toDimacs(),
    meta: {
      colors,
      kBits,
      maxDistance: maxDist,
      nodes: nodeList,
      edges: undirectedEdges,
    },
  };
}
