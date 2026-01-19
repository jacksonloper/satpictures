/**
 * Grid Coloring Problem Encoder
 *
 * Encodes the maze coloring problem as SAT:
 * - Grid points have colors
 * - Edges between neighbors can be kept (passage) or blocked (wall)
 * - Different colors must be disconnected
 * - Same colors must form a single connected component (via spanning tree encoding)
 */

import {
  createBinaryIntVariables,
  MiniSatFormulaBuilder,
  MiniSatSolver,
} from "../sat";
import type { SolveResult } from "../sat";

/**
 * Represents a point in the grid
 */
export interface GridPoint {
  row: number;
  col: number;
}

/**
 * Grid with colors assigned to each point
 */
export interface ColorGrid {
  width: number;
  height: number;
  colors: number[][]; // colors[row][col]
}

/**
 * An edge between two adjacent grid points
 */
export interface Edge {
  u: GridPoint;
  v: GridPoint;
}

/**
 * Solution: which edges to keep (no wall)
 */
export interface GridSolution {
  keptEdges: Edge[];
  wallEdges: Edge[];
}

/**
 * Get the 4-neighbors of a point within grid bounds
 */
function getNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (const [dr, dc] of deltas) {
    const nr = p.row + dr;
    const nc = p.col + dc;
    if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
      neighbors.push({ row: nr, col: nc });
    }
  }

  return neighbors;
}

/**
 * Create a canonical key for an edge (unordered pair)
 */
function edgeKey(u: GridPoint, v: GridPoint): string {
  // Normalize order: smaller row first, or if same row, smaller col first
  if (u.row < v.row || (u.row === v.row && u.col < v.col)) {
    return `${u.row},${u.col}-${v.row},${v.col}`;
  }
  return `${v.row},${v.col}-${u.row},${u.col}`;
}

/**
 * Create a key for a directed parent relation
 */
function parentKey(color: number, parent: GridPoint, child: GridPoint): string {
  return `p_${color}_${parent.row},${parent.col}->${child.row},${child.col}`;
}

/**
 * Create a key for level variable
 */
function levelKey(color: number, v: GridPoint): string {
  return `level_${color}_${v.row},${v.col}`;
}

/**
 * Number of bits needed to represent values 0 to n-1
 */
function bitsNeeded(n: number): number {
  if (n <= 1) return 1;
  return Math.ceil(Math.log2(n));
}

/**
 * Encode and solve the grid coloring problem
 */
export function solveGridColoring(grid: ColorGrid): GridSolution | null {
  const { width, height, colors } = grid;
  const solver = new MiniSatSolver();
  const builder = new MiniSatFormulaBuilder(solver);

  // Collect all edges and create edge variables
  const edgeVars = new Map<string, number>();
  const allEdges: Edge[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const u: GridPoint = { row, col };
      // Only add edges to right and down neighbors to avoid duplicates
      if (col + 1 < width) {
        const v: GridPoint = { row, col: col + 1 };
        const key = edgeKey(u, v);
        const varNum = builder.createNamedVariable(`edge_${key}`);
        edgeVars.set(key, varNum);
        allEdges.push({ u, v });
      }
      if (row + 1 < height) {
        const v: GridPoint = { row: row + 1, col };
        const key = edgeKey(u, v);
        const varNum = builder.createNamedVariable(`edge_${key}`);
        edgeVars.set(key, varNum);
        allEdges.push({ u, v });
      }
    }
  }

  // Group vertices by color
  const colorGroups = new Map<number, GridPoint[]>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = colors[row][col];
      if (!colorGroups.has(c)) {
        colorGroups.set(c, []);
      }
      colorGroups.get(c)!.push({ row, col });
    }
  }

  // ============================================
  // 1. DISCONNECTION BETWEEN DIFFERENT COLORS
  // ============================================
  // For every neighboring pair {u,v} where c(u) != c(v), forbid the edge: ¬x_uv
  for (const edge of allEdges) {
    const colorU = colors[edge.u.row][edge.u.col];
    const colorV = colors[edge.v.row][edge.v.col];
    if (colorU !== colorV) {
      const edgeVar = edgeVars.get(edgeKey(edge.u, edge.v))!;
      builder.addUnit(-edgeVar); // Force edge to be false (wall)
    }
  }

  // ============================================
  // 2. CONNECTIVITY WITHIN EACH COLOR
  // ============================================
  // For each color, encode spanning tree constraints

  for (const [color, vertices] of colorGroups) {
    if (vertices.length === 1) {
      // Single vertex: no connectivity constraints needed
      continue;
    }

    // 2a) Choose root: lexicographically smallest vertex
    const root = vertices.reduce((min, v) => {
      if (v.row < min.row || (v.row === min.row && v.col < min.col)) {
        return v;
      }
      return min;
    }, vertices[0]);

    // Find all same-color neighbors for each vertex
    const sameColorNeighbors = new Map<string, GridPoint[]>();
    for (const v of vertices) {
      const key = `${v.row},${v.col}`;
      const neighbors = getNeighbors(v, width, height).filter(
        (n) => colors[n.row][n.col] === color
      );
      sameColorNeighbors.set(key, neighbors);
    }

    // 2b) Parent (tree) variables
    // p^k_{u→v} = true means u is the parent of v in color k's spanning tree
    const parentVars = new Map<string, number>();

    for (const v of vertices) {
      const neighbors = sameColorNeighbors.get(`${v.row},${v.col}`)!;
      for (const u of neighbors) {
        // Direction: u is parent of v
        const pKey = parentKey(color, u, v);
        const pVar = builder.createNamedVariable(pKey);
        parentVars.set(pKey, pVar);

        // Parent implies edge exists: ¬p^k_{u→v} ∨ x_uv
        const eKey = edgeKey(u, v);
        const edgeVar = edgeVars.get(eKey)!;
        builder.addImplies(pVar, edgeVar);
      }
    }

    // 2c) Exactly one parent per non-root vertex
    for (const v of vertices) {
      const isRoot = v.row === root.row && v.col === root.col;
      const neighbors = sameColorNeighbors.get(`${v.row},${v.col}`)!;

      // Get all parent variables where some u is parent of v
      const parentVarsForV: number[] = [];
      for (const u of neighbors) {
        const pKey = parentKey(color, u, v);
        const pVar = parentVars.get(pKey);
        if (pVar !== undefined) {
          parentVarsForV.push(pVar);
        }
      }

      if (isRoot) {
        // Root has no parent: for all same-color neighbors u: ¬p^k_{u→r_k}
        for (const pVar of parentVarsForV) {
          builder.addUnit(-pVar);
        }
      } else {
        // Non-root: exactly one parent
        if (parentVarsForV.length > 0) {
          builder.addExactlyOne(parentVarsForV);
        } else {
          // No possible parents but not root - this means disconnection is forced
          // which would make the problem unsatisfiable
          // This can happen if a vertex of this color is isolated from others
          return null; // Early exit - infeasible
        }
      }
    }

    // 2d) Level variables for cycle elimination
    const numBits = bitsNeeded(vertices.length);
    const levelVars = new Map<string, number[]>();

    for (const v of vertices) {
      const lKey = levelKey(color, v);
      const bits = createBinaryIntVariables(builder, lKey, numBits);
      levelVars.set(`${v.row},${v.col}`, bits);
    }

    // Fix root level to 0
    const rootBits = levelVars.get(`${root.row},${root.col}`)!;
    for (const bit of rootBits) {
      builder.addUnit(-bit); // All bits = 0
    }

    // For every parent relation: p^k_{u→v} → (ℓ^k_u < ℓ^k_v)
    // This is: ¬p ∨ (level_u < level_v)
    // We encode this as: if p is true, then level_u < level_v must hold

    let auxCounter = 0;
    for (const v of vertices) {
      const neighbors = sameColorNeighbors.get(`${v.row},${v.col}`)!;
      const vBits = levelVars.get(`${v.row},${v.col}`)!;

      for (const u of neighbors) {
        const pKey = parentKey(color, u, v);
        const pVar = parentVars.get(pKey);
        if (pVar === undefined) continue;

        const uBits = levelVars.get(`${u.row},${u.col}`)!;

        // Encode: p → (level_u < level_v)
        // This is equivalent to: ¬p ∨ (level_u < level_v)
        //
        // We create a "guard" variable g such that:
        // - If p is false, g can be anything
        // - If p is true, we need level_u < level_v
        //
        // Approach: Create auxiliary bits that equal level_u+1 when p is true,
        // and require these to be ≤ level_v
        //
        // Actually simpler: use implication encoding
        // Create a variable lt that represents (level_u < level_v)
        // Then add clause: ¬p ∨ lt

        // Create a fresh set of comparison auxiliary variables
        const auxPrefix = `cmp_${color}_${u.row}${u.col}_${v.row}${v.col}_${auxCounter++}`;

        // We'll encode: if p, then level_u < level_v
        // Using conditional less-than encoding

        // Method: encode p → (level_u < level_v) clause by clause
        // For strict inequality a < b with binary encoding:
        //
        // We'll create fresh variables for this specific constraint

        // Create temp builder context for the comparison
        const n = numBits;

        // eq[i] = (uBits[i] ↔ vBits[i])
        const eq: number[] = [];
        const lt: number[] = [];

        for (let i = 0; i < n; i++) {
          const eqVar = builder.createNamedVariable(`${auxPrefix}_eq_${i}`);
          eq.push(eqVar);

          // eqVar ↔ (uBits[i] ↔ vBits[i])
          builder.solver.addClause([-eqVar, -uBits[i], vBits[i]]);
          builder.solver.addClause([-eqVar, uBits[i], -vBits[i]]);
          builder.solver.addClause([eqVar, uBits[i], vBits[i]]);
          builder.solver.addClause([eqVar, -uBits[i], -vBits[i]]);
        }

        // ltSoFar[i] = (u[MSB:i] < v[MSB:i])
        for (let i = 0; i < n; i++) {
          lt.push(builder.createNamedVariable(`${auxPrefix}_lt_${i}`));
        }

        // Build comparison from MSB to LSB
        for (let bitIdx = n - 1; bitIdx >= 0; bitIdx--) {
          const ltVar = lt[bitIdx];

          if (bitIdx === n - 1) {
            // MSB: lt = ¬u ∧ v (u=0 and v=1 means u<v at this bit)
            builder.solver.addClause([-ltVar, -uBits[bitIdx]]);
            builder.solver.addClause([-ltVar, vBits[bitIdx]]);
            builder.solver.addClause([ltVar, uBits[bitIdx], -vBits[bitIdx]]);
          } else {
            // lt[i] = lt[i+1] ∨ (prefixEq ∧ ¬u[i] ∧ v[i])
            const prevLt = lt[bitIdx + 1];

            // Compute prefix equality from MSB down to bitIdx+1
            const prefixEq = builder.createNamedVariable(
              `${auxPrefix}_prefixEq_${bitIdx}`
            );

            if (bitIdx === n - 2) {
              // Only MSB
              builder.solver.addClause([-prefixEq, eq[n - 1]]);
              builder.solver.addClause([prefixEq, -eq[n - 1]]);
            } else {
              // Conjunction with previous prefix
              const prevPrefix = builder.getVariable(
                `${auxPrefix}_prefixEq_${bitIdx + 1}`
              )!;
              builder.solver.addClause([-prefixEq, prevPrefix]);
              builder.solver.addClause([-prefixEq, eq[bitIdx + 1]]);
              builder.solver.addClause([prefixEq, -prevPrefix, -eq[bitIdx + 1]]);
            }

            // strictHere = prefixEq ∧ ¬u[i] ∧ v[i]
            const strictHere = builder.createNamedVariable(
              `${auxPrefix}_strict_${bitIdx}`
            );
            builder.solver.addClause([-strictHere, prefixEq]);
            builder.solver.addClause([-strictHere, -uBits[bitIdx]]);
            builder.solver.addClause([-strictHere, vBits[bitIdx]]);
            builder.solver.addClause([
              strictHere,
              -prefixEq,
              uBits[bitIdx],
              -vBits[bitIdx],
            ]);

            // lt[i] ↔ (prevLt ∨ strictHere)
            builder.solver.addClause([-ltVar, prevLt, strictHere]);
            builder.solver.addClause([ltVar, -prevLt]);
            builder.solver.addClause([ltVar, -strictHere]);
          }
        }

        // The overall less-than result is lt[0]
        // Now add: p → lt[0], i.e., ¬p ∨ lt[0]
        builder.solver.addClause([-pVar, lt[0]]);
      }
    }
  }

  // ============================================
  // SOLVE
  // ============================================
  const result: SolveResult = solver.solve();

  if (!result.satisfiable) {
    return null;
  }

  // Extract solution
  const keptEdges: Edge[] = [];
  const wallEdges: Edge[] = [];

  for (const edge of allEdges) {
    const key = edgeKey(edge.u, edge.v);
    const edgeVar = edgeVars.get(key)!;
    const isKept = result.assignment.get(edgeVar) ?? false;

    if (isKept) {
      keptEdges.push(edge);
    } else {
      wallEdges.push(edge);
    }
  }

  return { keptEdges, wallEdges };
}

/**
 * Create a simple test grid for verification
 */
export function createTestGrid(): ColorGrid {
  return {
    width: 4,
    height: 4,
    colors: [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ],
  };
}
