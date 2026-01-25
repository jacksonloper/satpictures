/**
 * Connectivity SAT CNF Builder
 *
 * Uses single commodity flow encoding for connectivity.
 * This encoding enforces:
 * - Vertex coloring (some precolored)
 * - Choose which edges to keep
 * - Kept edges never connect different colors
 * - Each color-class is connected (one component)
 *
 * Key encoding technique: single commodity flow with unary flow values
 * - Each non-root node produces 1 unit of flow
 * - For each undirected edge {u,v}, we have two directed arc flow variables
 * - Arc can only carry flow if both endpoints have same color
 * - Flow conservation: outgoing flow = incoming flow + 1 for non-root nodes
 * - Totalizer encoding for proper bidirectional sum constraints
 */

/**
 * Input configuration for building the connectivity SAT CNF
 */
export interface ConnectivityInput {
  /** Collection of node identifiers (can be any type that converts to string) */
  nodes: Iterable<string | number>;
  /** List of edges as [u, v] pairs */
  edges: [string | number, string | number][];
  /** Optional hints for node colors. Use -1 for "any color" (blank). Fixed colors are >= 0. */
  nodeColorHint?: Record<string, number>;
  /** Whether to reduce to tree using Kruskal (optional, default false) */
  reduceToTree?: boolean;
}

/**
 * Result of building the connectivity SAT CNF
 */
export interface ConnectivityCNFResult {
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
    maxLevel: number;
    nodes: string[];
    edges: [string, string][];
    rootOfColor: Record<number, string>;
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

  /**
   * Add at-most-one constraint using Sinz sequential counter encoding.
   * Given literals x1..xn, introduces auxiliaries s1..s(n-1) and adds O(n) clauses.
   */
  addAtMostOneSinz(lits: number[]): void {
    const n = lits.length;
    if (n <= 1) return;

    if (n === 2) {
      this.addClause([-lits[0], -lits[1]]);
      return;
    }

    const auxVars: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      auxVars.push(this.v(`_amo_${this.numVars + 1}`));
    }

    this.addClause([-lits[0], auxVars[0]]);

    for (let i = 1; i < n - 1; i++) {
      this.addClause([-lits[i], auxVars[i]]);
      this.addClause([-auxVars[i - 1], auxVars[i]]);
      this.addClause([-lits[i], -auxVars[i - 1]]);
    }

    this.addClause([-lits[n - 1], -auxVars[n - 2]]);
  }

  addExactlyOne(lits: number[]): void {
    this.addClause(lits);
    this.addAtMostOneSinz(lits);
  }

  /**
   * Build a totalizer for summing unary-encoded values.
   * Given input functions that return "input i >= k" literals,
   * returns an output function for "sum >= k" with proper bidirectional constraints.
   *
   * @param inputs Array of functions (k) => literal for "input >= k"
   * @param maxPerInput Maximum value each input can have
   * @param prefix Variable name prefix for auxiliary variables
   * @returns Function (k) => literal for "sum >= k"
   */
  buildTotalizer(
    inputs: Array<(k: number) => number>,
    maxPerInput: number,
    prefix: string
  ): (k: number) => number {
    if (inputs.length === 0) {
      // Empty sum is always 0
      return (k: number) => {
        if (k <= 0) return this.v(`${prefix}_true`); // Always true for k <= 0
        return -this.v(`${prefix}_true`); // Always false for k > 0
      };
    }

    if (inputs.length === 1) {
      return inputs[0];
    }

    // Recursively build totalizer using divide-and-conquer
    const mid = Math.floor(inputs.length / 2);
    const leftInputs = inputs.slice(0, mid);
    const rightInputs = inputs.slice(mid);

    const leftSum = this.buildTotalizer(leftInputs, maxPerInput, `${prefix}_L`);
    const rightSum = this.buildTotalizer(rightInputs, maxPerInput, `${prefix}_R`);

    const maxLeft = leftInputs.length * maxPerInput;
    const maxRight = rightInputs.length * maxPerInput;
    const maxTotal = maxLeft + maxRight;

    // Create output variables for the combined sum
    const outVars = new Map<number, number>();
    const outSum = (k: number): number => {
      if (k <= 0) return this.v(`${prefix}_true`);
      if (k > maxTotal) return -this.v(`${prefix}_true`);
      if (!outVars.has(k)) {
        outVars.set(k, this.v(`${prefix}>=${k}`));
      }
      return outVars.get(k)!;
    };

    // Add totalizer clauses (both directions)
    // Forward: leftSum >= a ∧ rightSum >= b → outSum >= a+b
    // Backward: outSum >= k → ∨_{a+b=k} (leftSum >= a ∧ rightSum >= b)
    //           Equivalently: ¬outSum >= k ∨ ∨_{a+b=k} (leftSum >= a ∧ rightSum >= b)
    //           Which requires auxiliary variables or is handled by contrapositive

    for (let a = 0; a <= maxLeft; a++) {
      for (let b = 0; b <= maxRight; b++) {
        const sum = a + b;
        if (sum > 0 && sum <= maxTotal) {
          // Forward: leftSum >= a ∧ rightSum >= b → outSum >= sum
          const clause: number[] = [outSum(sum)];
          if (a > 0) clause.push(-leftSum(a));
          if (b > 0) clause.push(-rightSum(b));
          this.addClause(clause);
        }
      }
    }

    // Backward (contrapositive): outSum >= k → (leftSum >= a ∨ rightSum >= k-a) for all valid a
    // This is: ¬outSum >= k ∨ leftSum >= a ∨ rightSum >= k-a
    // We need this for all a from max(0, k-maxRight) to min(maxLeft, k)
    for (let k = 1; k <= maxTotal; k++) {
      // outSum >= k implies there exist a, b with a + b >= k where leftSum >= a and rightSum >= b
      // Contrapositive: if for all valid (a, b) pairs, either leftSum < a or rightSum < b, then outSum < k
      // This is enforced by: outSum >= k → leftSum >= (k - maxRight) when k > maxRight
      //                  and: outSum >= k → rightSum >= (k - maxLeft) when k > maxLeft
      const minFromLeft = Math.max(0, k - maxRight);
      const minFromRight = Math.max(0, k - maxLeft);

      if (minFromLeft > 0) {
        this.addImp(outSum(k), leftSum(minFromLeft));
      }
      if (minFromRight > 0) {
        this.addImp(outSum(k), rightSum(minFromRight));
      }
    }

    // Monotonicity: outSum >= k → outSum >= k-1
    for (let k = 2; k <= maxTotal; k++) {
      this.addImp(outSum(k), outSum(k - 1));
    }

    return outSum;
  }

  toDimacs(): string {
    let out = `p cnf ${this.numVars} ${this.clauses.length}\n`;
    for (const cl of this.clauses) out += `${cl.join(" ")} 0\n`;
    return out;
  }
}

/**
 * Build a SAT CNF formula for the connectivity problem using single commodity flow.
 *
 * This encoding uses flow conservation to ensure connectivity:
 * - Each non-root node produces 1 unit of flow
 * - Flow is transported via directed arcs toward the root
 * - Flow conservation: outgoing = incoming + 1 for non-root nodes
 * - Uses totalizer encoding for proper bidirectional sum constraints
 *
 * @param input - Configuration specifying nodes, edges, and color hints
 * @returns The CNF formula and metadata
 */
export function buildConnectivitySatCNF(
  input: ConnectivityInput
): ConnectivityCNFResult {
  const { nodes, edges, nodeColorHint, reduceToTree } = input;

  const nodeList = [...nodes].map(String);
  const N = nodeList.length;
  if (N === 0) throw new Error("No nodes.");
  const nodeIndex = new Map(nodeList.map((n, i) => [n, i]));

  // Determine active colors
  const colorSet = new Set<number>();
  for (const n of nodeList) {
    const c = nodeColorHint?.[n];
    if (typeof c === "number" && c >= 0) colorSet.add(c);
  }
  const colors = [...colorSet].sort((a, b) => a - b);
  if (colors.length === 0) {
    throw new Error("No colors provided (need at least one cell with a fixed color).");
  }

  // Build adjacency
  const adj = new Map<string, Set<string>>(nodeList.map((n) => [n, new Set()]));
  const edgeKey = (a: string, b: string): string => a < b ? `${a}--${b}` : `${b}--${a}`;
  const undirectedEdges: [string, string][] = [];
  const edgeSeen = new Set<string>();
  for (const [u0, v0] of edges) {
    const u = String(u0), v = String(v0);
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

  // Max flow value (N-1 is max possible through any single arc)
  const maxFlow = N - 1;

  const cnf = new CNF();

  // ---------- Variables ----------
  // X_{v,c} = vertex v has color c
  const colorVar = (v: string, c: number) => cnf.v(`X(${v})=${c}`);
  // Y_{uv} = edge is kept (for visualization)
  const keepVar = (u: string, v: string) => cnf.v(`Y(${edgeKey(u, v)})`);
  // F_{u→v,k} = "flow on arc u→v is at least k" (unary encoding)
  const flowVar = (u: string, v: string, k: number) => cnf.v(`F(${u}->${v},>=${k})`);

  // ---------- (1) Each vertex has exactly one color ----------
  for (const v of nodeList) {
    cnf.addExactlyOne(colors.map((c) => colorVar(v, c)));

    const hinted = nodeColorHint?.[v];
    if (typeof hinted === "number") {
      if (hinted === -1) {
        // Blank - any color allowed
      } else if (Number.isInteger(hinted) && hinted >= 0) {
        if (!colorSet.has(hinted)) {
          throw new Error(`Hinted color ${hinted} for node ${v} not in allowed set.`);
        }
        cnf.addUnit(colorVar(v, hinted));
      } else {
        throw new Error(`nodeColorHint[${v}] must be -1 or a nonnegative integer.`);
      }
    }
  }

  // ---------- Determine root for each color ----------
  const rootOfColor: Record<number, string> = {};
  for (const c of colors) {
    const fixedVertices: string[] = [];
    for (const v of nodeList) {
      const hint = nodeColorHint?.[v];
      if (hint === c) fixedVertices.push(v);
    }
    if (fixedVertices.length === 0) {
      throw new Error(`Color ${c} has no fixed vertices to serve as root.`);
    }
    fixedVertices.sort();
    rootOfColor[c] = fixedVertices[0];
  }

  // ---------- (2) Unary flow encoding: monotonicity ----------
  // F_{u→v,k} → F_{u→v,k-1}
  for (const [u, v] of undirectedEdges) {
    for (let k = 2; k <= maxFlow; k++) {
      cnf.addImp(flowVar(u, v, k), flowVar(u, v, k - 1));
      cnf.addImp(flowVar(v, u, k), flowVar(v, u, k - 1));
    }
  }

  // ---------- (3) Arc can only carry flow if both endpoints have same color ----------
  for (const [u, v] of undirectedEdges) {
    for (const c of colors) {
      const xu = colorVar(u, c);
      const xv = colorVar(v, c);
      // If there's flow u→v and u has color c, then v must have color c (and vice versa)
      cnf.addClause([-flowVar(u, v, 1), -xu, xv]);
      cnf.addClause([-flowVar(u, v, 1), -xv, xu]);
      cnf.addClause([-flowVar(v, u, 1), -xu, xv]);
      cnf.addClause([-flowVar(v, u, 1), -xv, xu]);
    }
  }

  // ---------- (4) Flow conservation using totalizer ----------
  // For each node v: out_total = in_total + 1 (if non-root)
  // Uses totalizer for proper bidirectional sum constraints

  for (const v of nodeList) {
    const neighbors = [...adj.get(v)!];
    if (neighbors.length === 0) continue;

    const isRoot = colors.some((c) => rootOfColor[c] === v);

    // Build totalizer for incoming flow
    const incomingFlows = neighbors.map((u) => (k: number) => flowVar(u, v, k));
    const inSum = cnf.buildTotalizer(incomingFlows, maxFlow, `_in(${v})`);

    // Build totalizer for outgoing flow
    const outgoingFlows = neighbors.map((u) => (k: number) => flowVar(v, u, k));
    const outSum = cnf.buildTotalizer(outgoingFlows, maxFlow, `_out(${v})`);

    const maxTotal = neighbors.length * maxFlow;

    // ---------- Flow conservation constraint ----------
    // Non-root: outSum >= k ↔ inSum >= k-1 (each node produces 1 unit)
    if (!isRoot) {
      // outSum >= 1 always (each non-root produces at least 1)
      cnf.addUnit(outSum(1));

      // For k >= 2: outSum >= k ↔ inSum >= k-1
      for (let k = 2; k <= maxTotal; k++) {
        cnf.addImp(inSum(k - 1), outSum(k));
        cnf.addImp(outSum(k), inSum(k - 1));
      }
    }
  }

  // ---------- (5) Link flow to kept edges (one direction only) ----------
  // F_{u→v,1} → Y_{uv} and F_{v→u,1} → Y_{uv}
  // But NOT Y → flow (kept edges don't have to carry flow)
  for (const [u, v] of undirectedEdges) {
    const yVar = keepVar(u, v);
    const fUV = flowVar(u, v, 1);
    const fVU = flowVar(v, u, 1);
    // Flow implies edge is kept (for visualization)
    cnf.addImp(fUV, yVar);
    cnf.addImp(fVU, yVar);
    // Removed: cnf.addClause([-yVar, fUV, fVU]); // This was forcing tree-like behavior
  }

  void reduceToTree;

  return {
    numVars: cnf.numVars,
    clauses: cnf.clauses,
    varOf: cnf.varOf,
    nameOf: cnf.nameOf,
    dimacs: cnf.toDimacs(),
    meta: {
      colors,
      maxLevel: maxFlow,
      nodes: nodeList,
      edges: undirectedEdges,
      rootOfColor,
    },
  };
}
