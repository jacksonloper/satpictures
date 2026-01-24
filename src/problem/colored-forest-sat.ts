/**
 * Colored Forest SAT CNF Builder
 *
 * Updated again with the two changes:
 *
 * A) Add anti-parallel-parent constraint for each undirected edge:
 *      ¬par(u->v) ∨ ¬par(v->u)
 *
 * B) Add a global distance cap to eliminate modulo-wrap artifacts:
 *      dist(u) <= N-1   for every node u
 *
 *     Implemented via addBitsLeConst(bits, K) built as ¬(bits > K).
 *     We build gt = (bits > K) with witnesses, then enforce ¬gt.
 *
 * Everything else stays the same structure as the prior revision.
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

  addEquiv(a: number, b: number): void {
    this.addClause([-a, b]);
    this.addClause([a, -b]);
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

  addXor(x: number, a: number, b: number): void {
    this.addClause([-a, -b, -x]);
    this.addClause([a, b, -x]);
    this.addClause([a, -b, x]);
    this.addClause([-a, b, x]);
  }

  addAnd(x: number, a: number, b: number): void {
    this.addClause([-x, a]);
    this.addClause([-x, b]);
    this.addClause([-a, -b, x]);
  }

  addBitsEqualConst(bits: number[], value: number): void {
    for (let i = 0; i < bits.length; i++) {
      const bit = (value >> i) & 1;
      this.addUnit(bit ? bits[i] : -bits[i]);
    }
  }

  /**
   * Enforce bits >= c by building lt(bits,c) and requiring ¬lt.
   * tag must be unique per call.
   */
  addBitsGeConst(bits: number[], c: number, tag: string): void {
    if (c < 0) return;
    const w = bits.length;
    const maxVal = (1 << w) - 1;
    if (!Number.isInteger(c) || c < 0)
      throw new Error("Constant must be a nonnegative integer.");
    if (c > maxVal) {
      this.addClause([]);
      return;
    }

    const msb = w - 1;

    // eqAbove[i] = (bits[msb..i+1] == c[msb..i+1]); eqAbove[msb]=true
    const eqAbove = new Array<number>(w);
    eqAbove[msb] = this.v(`eqAbove_ge_${tag}_${msb}`);
    this.addUnit(eqAbove[msb]);

    for (let i = msb - 1; i >= 0; i--) {
      const eq = this.v(`eqAbove_ge_${tag}_${i}`);
      eqAbove[i] = eq;
      const next = eqAbove[i + 1];
      const bNext = bits[i + 1];
      const cNext = (c >> (i + 1)) & 1;

      // eq -> next
      this.addClause([-eq, next]);
      // eq -> (bNext == cNext)
      if (cNext === 1) this.addClause([-eq, bNext]);
      else this.addClause([-eq, -bNext]);
      // (next AND (bNext == cNext)) -> eq
      if (cNext === 1) this.addClause([-next, -bNext, eq]);
      else this.addClause([-next, bNext, eq]);
    }

    // ltTerm_i <-> (eqAbove[i] AND (c_i=1) AND (bits_i=0))
    const ltTerms: number[] = [];
    for (let i = msb; i >= 0; i--) {
      const ci = (c >> i) & 1;
      if (ci === 1) {
        const t = this.v(`ltTerm_${tag}_${i}`);
        ltTerms.push(t);
        // t -> eqAbove[i], t -> ¬bits[i]
        this.addClause([-t, eqAbove[i]]);
        this.addClause([-t, -bits[i]]);
        // (eqAbove[i] AND ¬bits[i]) -> t   (ci==1 baked in by construction)
        this.addClause([-eqAbove[i], bits[i], t]);
      }
    }

    const lt = this.v(`lt_${tag}`);
    if (ltTerms.length === 0) {
      this.addUnit(-lt);
    } else {
      for (const t of ltTerms) this.addClause([-t, lt]);
      this.addClause([-lt, ...ltTerms]);
    }
    this.addUnit(-lt); // enforce not less-than
  }

  /**
   * Enforce bits <= K by building gt(bits,K) and requiring ¬gt.
   * gt witness:
   *   gt := OR_i (eqAbove(i) AND (K_i=0) AND (bits_i=1))
   * where eqAbove(i) is equality on bits above i (msb..i+1).
   * tag must be unique per call.
   */
  addBitsLeConst(bits: number[], K: number, tag: string): void {
    const w = bits.length;
    const maxVal = (1 << w) - 1;
    if (!Number.isInteger(K) || K < 0)
      throw new Error("K must be a nonnegative integer.");
    if (K >= maxVal) return; // always true (since bits are width w)
    if (K < 0) {
      this.addClause([]);
      return;
    }

    const msb = w - 1;

    // eqAbove[i] = (bits[msb..i+1] == K[msb..i+1]); eqAbove[msb]=true
    const eqAbove = new Array<number>(w);
    eqAbove[msb] = this.v(`eqAbove_le_${tag}_${msb}`);
    this.addUnit(eqAbove[msb]);

    for (let i = msb - 1; i >= 0; i--) {
      const eq = this.v(`eqAbove_le_${tag}_${i}`);
      eqAbove[i] = eq;
      const next = eqAbove[i + 1];
      const bNext = bits[i + 1];
      const kNext = (K >> (i + 1)) & 1;

      this.addClause([-eq, next]);
      if (kNext === 1) this.addClause([-eq, bNext]);
      else this.addClause([-eq, -bNext]);

      if (kNext === 1) this.addClause([-next, -bNext, eq]);
      else this.addClause([-next, bNext, eq]);
    }

    // gtTerm_i <-> (eqAbove[i] AND (K_i=0) AND (bits_i=1))
    const gtTerms: number[] = [];
    for (let i = msb; i >= 0; i--) {
      const ki = (K >> i) & 1;
      if (ki === 0) {
        const t = this.v(`gtTerm_${tag}_${i}`);
        gtTerms.push(t);
        // t -> eqAbove[i], t -> bits[i]
        this.addClause([-t, eqAbove[i]]);
        this.addClause([-t, bits[i]]);
        // (eqAbove[i] AND bits[i]) -> t   (ki==0 baked in by construction)
        this.addClause([-eqAbove[i], -bits[i], t]);
      }
    }

    const gt = this.v(`gt_${tag}`);
    if (gtTerms.length === 0) {
      this.addUnit(-gt);
    } else {
      for (const t of gtTerms) this.addClause([-t, gt]);
      this.addClause([-gt, ...gtTerms]);
    }

    this.addUnit(-gt); // enforce not greater-than => <=
  }

  /**
   * outBits = inBits + 1 (ripple carry), collision-safe via tag.
   */
  addPlusOne(outBits: number[], inBits: number[], tag: string): void {
    if (outBits.length !== inBits.length)
      throw new Error("Bitvector length mismatch in addPlusOne.");
    const w = inBits.length;

    const carry = new Array<number>(w + 1);
    carry[0] = this.v(`carry_${tag}_0`);
    this.addUnit(carry[0]); // +1

    for (let i = 0; i < w; i++) {
      const sum = this.v(`sum_${tag}_${i}`);
      this.addXor(sum, inBits[i], carry[i]);
      this.addEquiv(outBits[i], sum);

      carry[i + 1] = this.v(`carry_${tag}_${i + 1}`);
      this.addAnd(carry[i + 1], inBits[i], carry[i]);
    }
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
 * This encoding enforces that each color forms a tree rooted at the specified
 * root node. It includes:
 * - Color assignment constraints (each node exactly one color)
 * - Anti-parallel-parent constraints (an edge can't be a parent in both directions)
 * - Global distance cap (dist(u) <= N-1 for all nodes)
 * - Parent-child distance relationship (dist(child) = dist(parent) + 1)
 * - Per-node distance lower bounds
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

  // distance bits k where 2^k > N
  let kBits = 0;
  while ((1 << kBits) <= N) kBits++;
  const MAXD = 1 << kBits;

  const cnf = new CNF();

  // ---------- variables ----------
  const colVar = (u: string, c: number) => cnf.v(`col(${u})=${c}`);
  const parentVar = (u: string, v: string) => cnf.v(`par(${u})->(${v})`);
  const keepVar = (u: string, v: string) => cnf.v(`keep(${edgeKey(u, v)})`);

  const distBits = new Map<string, number[]>();
  for (const u of nodeList) {
    const bits: number[] = [];
    for (let i = 0; i < kBits; i++) bits.push(cnf.v(`dist(${u})_b${i}`));
    distBits.set(u, bits);
  }

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

  // ---------- roots per color ----------
  for (const c of colors) {
    const r = String(rootOfColor[String(c)]);
    cnf.addUnit(colVar(r, c));
    cnf.addBitsEqualConst(distBits.get(r)!, 0);
  }

  // ---------- global distance cap: dist(u) <= N-1 for all nodes ----------
  // This fully rules out modulo-wrap artifacts.
  for (const u of nodeList) {
    cnf.addBitsLeConst(distBits.get(u)!, N - 1, `cap_${u}_le_${N - 1}`);
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

  // ---------- parent implies same color + dist(child)=dist(parent)+1 ----------
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

      // p -> dist(u) = dist(v) + 1
      const dv = distBits.get(v)!;
      const du = distBits.get(u)!;
      const plus = dv.map((_, i) => cnf.v(`distPlus1(${v})_b${i}_for_${u}`));
      cnf.addPlusOne(plus, dv, `plus1_${v}_to_${u}`);

      for (let i = 0; i < kBits; i++) {
        cnf.addClause([-p, du[i], -plus[i]]);
        cnf.addClause([-p, -du[i], plus[i]]);
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
          // cu -> dist(u) >= 1 (forbid all-zero); roots already fixed to 0
          cnf.addClause([-cu, ...distBits.get(u)!]);
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
    if (minD >= MAXD) {
      cnf.addClause([]);
      continue;
    }
    cnf.addBitsGeConst(distBits.get(n)!, minD, `ge_${n}_ge_${minD}`);
  }

  return {
    numVars: cnf.numVars,
    clauses: cnf.clauses,
    varOf: cnf.varOf,
    nameOf: cnf.nameOf,
    dimacs: cnf.toDimacs(),
    meta: {
      colors,
      kBits,
      maxDistance: MAXD - 1,
      nodes: nodeList,
      edges: undirectedEdges,
    },
  };
}
