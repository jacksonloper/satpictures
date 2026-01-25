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
 * Key encoding technique: single commodity flow with BINARY flow values
 * - Each non-root node produces 1 unit of flow
 * - For each directed arc, flow is represented as a binary number (log2(N) bits)
 * - Arc can only carry flow if both endpoints have same color
 * - Flow conservation: outgoing flow = incoming flow + 1 for non-root nodes
 * - Uses binary adder circuits for sum computation (much more efficient than unary)
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
   * Create a full adder circuit.
   * Returns [sum, carry] literals.
   */
  fullAdder(a: number, b: number, cin: number, prefix: string): [number, number] {
    const sum = this.v(`${prefix}_sum`);
    const cout = this.v(`${prefix}_cout`);

    // sum = a XOR b XOR cin
    // cout = (a AND b) OR (cin AND (a XOR b))

    // For sum: exactly odd number of {a, b, cin} are true
    // sum ↔ (a XOR b XOR cin)
    this.addClause([-a, -b, -cin, sum]);
    this.addClause([-a, -b, cin, -sum]);
    this.addClause([-a, b, -cin, -sum]);
    this.addClause([-a, b, cin, sum]);
    this.addClause([a, -b, -cin, -sum]);
    this.addClause([a, -b, cin, sum]);
    this.addClause([a, b, -cin, sum]);
    this.addClause([a, b, cin, -sum]);

    // cout ↔ at least 2 of {a, b, cin} are true
    this.addClause([-a, -b, cout]);
    this.addClause([-a, -cin, cout]);
    this.addClause([-b, -cin, cout]);
    this.addClause([a, b, -cout]);
    this.addClause([a, cin, -cout]);
    this.addClause([b, cin, -cout]);

    return [sum, cout];
  }

  /**
   * Create a half adder circuit.
   * Returns [sum, carry] literals.
   */
  halfAdder(a: number, b: number, prefix: string): [number, number] {
    const sum = this.v(`${prefix}_sum`);
    const cout = this.v(`${prefix}_cout`);

    // sum = a XOR b
    this.addClause([-a, -b, -sum]);
    this.addClause([-a, b, sum]);
    this.addClause([a, -b, sum]);
    this.addClause([a, b, -sum]);

    // cout = a AND b
    this.addClause([-a, -b, cout]); // Remove: cout can be false when both false
    this.addImp(cout, a);
    this.addImp(cout, b);
    this.addClause([-a, -b, cout]);

    return [sum, cout];
  }

  /**
   * Add two binary numbers represented as arrays of literals (LSB first).
   * Returns the sum as an array of literals (LSB first), with length max(a.len, b.len) + 1.
   */
  binaryAdd(a: number[], b: number[], prefix: string): number[] {
    const maxLen = Math.max(a.length, b.length);
    const result: number[] = [];
    let carry: number | null = null;

    // Create a "false" literal for padding
    const falseLit = -this.v(`${prefix}_true`);
    this.addUnit(-falseLit); // Make _true actually true

    for (let i = 0; i < maxLen; i++) {
      const ai = i < a.length ? a[i] : falseLit;
      const bi = i < b.length ? b[i] : falseLit;

      if (carry === null) {
        const [sum, cout] = this.halfAdder(ai, bi, `${prefix}_bit${i}`);
        result.push(sum);
        carry = cout;
      } else {
        const [sum, cout] = this.fullAdder(ai, bi, carry, `${prefix}_bit${i}`);
        result.push(sum);
        carry = cout;
      }
    }

    if (carry !== null) {
      result.push(carry);
    }

    return result;
  }

  /**
   * Add multiple binary numbers using a tree of adders.
   * Each number is represented as an array of literals (LSB first).
   */
  binaryAddMultiple(numbers: number[][], prefix: string): number[] {
    if (numbers.length === 0) {
      return [];
    }
    if (numbers.length === 1) {
      return numbers[0];
    }

    // Pair up and add recursively
    const nextLevel: number[][] = [];
    for (let i = 0; i < numbers.length; i += 2) {
      if (i + 1 < numbers.length) {
        nextLevel.push(this.binaryAdd(numbers[i], numbers[i + 1], `${prefix}_add${i}`));
      } else {
        nextLevel.push(numbers[i]);
      }
    }

    return this.binaryAddMultiple(nextLevel, `${prefix}_L`);
  }

  /**
   * Assert that binary number a equals binary number b + constant.
   * a and b are arrays of literals (LSB first).
   */
  assertBinaryEq(a: number[], b: number[], prefix: string): void {
    // Pad to same length
    const maxLen = Math.max(a.length, b.length);
    const falseLit = -this.v(`${prefix}_true`);
    this.addUnit(-falseLit);

    for (let i = 0; i < maxLen; i++) {
      const ai = i < a.length ? a[i] : falseLit;
      const bi = i < b.length ? b[i] : falseLit;
      // ai ↔ bi
      this.addImp(ai, bi);
      this.addImp(bi, ai);
    }

    // Extra bits in a must be false
    for (let i = maxLen; i < a.length; i++) {
      this.addUnit(-a[i]);
    }
  }

  /**
   * Create binary representation of a constant.
   */
  binaryConstant(value: number, numBits: number, prefix: string): number[] {
    const result: number[] = [];
    const trueLit = this.v(`${prefix}_true`);
    this.addUnit(trueLit);

    for (let i = 0; i < numBits; i++) {
      if ((value >> i) & 1) {
        result.push(trueLit);
      } else {
        result.push(-trueLit);
      }
    }
    return result;
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
 * - Uses binary adder circuits for correct sum computation
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

  // Number of bits needed for binary flow representation
  // Max flow on any arc is N-1, so we need ceil(log2(N)) bits
  const numBits = Math.max(1, Math.ceil(Math.log2(N)));

  const cnf = new CNF();

  // Create a shared "true" literal for constants
  const trueLit = cnf.v("_TRUE");
  cnf.addUnit(trueLit);

  // ---------- Variables ----------
  // X_{v,c} = vertex v has color c
  const colorVar = (v: string, c: number) => cnf.v(`X(${v})=${c}`);
  // Y_{uv} = edge is kept (for visualization)
  const keepVar = (u: string, v: string) => cnf.v(`Y(${edgeKey(u, v)})`);
  // Binary flow variables: F_{u→v}[bit] for each directed arc
  const flowBits: Map<string, number[]> = new Map();
  const getFlowBits = (u: string, v: string): number[] => {
    const key = `${u}->${v}`;
    if (!flowBits.has(key)) {
      const bits: number[] = [];
      for (let b = 0; b < numBits; b++) {
        bits.push(cnf.v(`F(${key})[${b}]`));
      }
      flowBits.set(key, bits);
    }
    return flowBits.get(key)!;
  };

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

  // ---------- (2) Arc flow = 0 if endpoints have different colors ----------
  // If u and v have different colors, all bits of flow(u→v) must be 0
  for (const [u, v] of undirectedEdges) {
    const flowUV = getFlowBits(u, v);
    const flowVU = getFlowBits(v, u);

    for (const c of colors) {
      const xu = colorVar(u, c);
      const xv = colorVar(v, c);
      // If u has color c and v doesn't have color c, then flow must be 0
      // Equivalently: for each bit: xu ∧ ¬xv → ¬bit
      // Which is: ¬xu ∨ xv ∨ ¬bit
      for (let b = 0; b < numBits; b++) {
        cnf.addClause([-xu, xv, -flowUV[b]]);
        cnf.addClause([xu, -xv, -flowUV[b]]);
        cnf.addClause([-xu, xv, -flowVU[b]]);
        cnf.addClause([xu, -xv, -flowVU[b]]);
      }
    }
  }

  // ---------- (3) Flow conservation using binary adders ----------
  // For each node v: sum of outgoing flows = sum of incoming flows + 1 (if non-root)
  // For root: sum of outgoing flows = 0 (or we allow any, root is sink)

  for (const v of nodeList) {
    const neighbors = [...adj.get(v)!];
    if (neighbors.length === 0) continue;

    const isRoot = colors.some((c) => rootOfColor[c] === v);

    // Gather incoming and outgoing flow bits
    const incomingFlowBits = neighbors.map((u) => getFlowBits(u, v));
    const outgoingFlowBits = neighbors.map((u) => getFlowBits(v, u));

    // Compute sum of incoming flows
    const inSum = cnf.binaryAddMultiple(incomingFlowBits, `_inSum(${v})`);

    // Compute sum of outgoing flows
    const outSum = cnf.binaryAddMultiple(outgoingFlowBits, `_outSum(${v})`);

    if (!isRoot) {
      // Conservation: outSum = inSum + 1
      // First compute inSum + 1
      const one: number[] = [];
      for (let b = 0; b < numBits; b++) {
        one.push(b === 0 ? trueLit : -trueLit);
      }
      const inSumPlusOne = cnf.binaryAdd(inSum, one, `_inSumP1(${v})`);

      // Assert outSum = inSumPlusOne
      cnf.assertBinaryEq(outSum, inSumPlusOne, `_conserve(${v})`);
    }
    // For root: no constraint (root absorbs all flow)
  }

  // ---------- (4) Link flow to kept edges ----------
  // If flow(u→v) > 0 or flow(v→u) > 0, then edge is kept
  // Flow > 0 means at least one bit is set
  for (const [u, v] of undirectedEdges) {
    const yVar = keepVar(u, v);
    const flowUV = getFlowBits(u, v);
    const flowVU = getFlowBits(v, u);

    // If any bit of flowUV is true, Y must be true
    // bit → Y for each bit
    for (let b = 0; b < numBits; b++) {
      cnf.addImp(flowUV[b], yVar);
      cnf.addImp(flowVU[b], yVar);
    }
  }

  // ---------- (5) Kept edges must be monochromatic ----------
  // An edge can only be kept if both endpoints have the same color
  for (const [u, v] of undirectedEdges) {
    const yVar = keepVar(u, v);
    for (const c of colors) {
      const xu = colorVar(u, c);
      const xv = colorVar(v, c);
      // If edge is kept and u has color c, then v must have color c
      cnf.addClause([-yVar, -xu, xv]);
      // If edge is kept and v has color c, then u must have color c
      cnf.addClause([-yVar, -xv, xu]);
    }
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
      maxLevel: N - 1,
      nodes: nodeList,
      edges: undirectedEdges,
      rootOfColor,
    },
  };
}
