/**
 * Grid Coloring Problem Encoder
 *
 * Encodes the maze coloring problem as SAT:
 * - Grid points have colors
 * - Edges between neighbors can be kept (passage) or blocked (wall)
 * - Different colors must be disconnected
 * - Same colors must form a single connected component (via spanning tree encoding)
 *   Exception: Hatch color does not need to form a connected component
 */

import {
  createBinaryIntVariables,
  MiniSatFormulaBuilder,
  MiniSatSolver,
} from "../solvers";
import type { FormulaBuilder, SATSolver, SolveResult } from "../solvers";

// Re-export types from graph-types for backwards compatibility
export { HATCH_COLOR } from "./graph-types";
export type {
  ColorGrid,
  Edge,
  GridPoint,
  GridSolution,
  GridType,
  PathlengthConstraint,
} from "./graph-types";

// Re-export helper functions and test utilities
export { createTestGrid } from "./trivial-solution";

// Import the types we need for this module
import type {
  ColorGrid,
  Edge,
  GridPoint,
  GridType,
  PathlengthConstraint,
  GridSolution,
} from "./graph-types";
import { HATCH_COLOR } from "./graph-types";
import { edgeKey, getNeighbors } from "./grid-neighbors";

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
 * Create a key for a cell's color variable
 */
function colorVarKey(row: number, col: number, color: number): string {
  return `cellColor_${row},${col}_${color}`;
}

/**
 * Options for the grid coloring solver
 */
export interface SolveOptions {
  /** Custom SAT solver instance (defaults to MiniSat) */
  solver?: SATSolver;
  /** Custom formula builder (defaults to MiniSatFormulaBuilder) */
  builder?: FormulaBuilder;
  /** Grid type: square (4-neighbors) or hex (6-neighbors) */
  gridType?: GridType;
  /** List of pathlength lower bound constraints */
  pathlengthConstraints?: PathlengthConstraint[];
}

/**
 * Encode and solve the grid coloring problem
 * 
 * @param grid The grid with colors assigned to cells (null = blank, solver decides)
 * @param _numColors DEPRECATED: This parameter is no longer used internally but kept for
 *                   backward compatibility with existing worker APIs. Blank cells are now
 *                   only assigned colors that already have fixed cells.
 * @param options Optional solver configuration
 */
export function solveGridColoring(
  grid: ColorGrid,
  _numColors: number = 6,  // eslint-disable-line @typescript-eslint/no-unused-vars -- kept for API compatibility
  options?: SolveOptions
): GridSolution | null {
  const { width, height, colors } = grid;
  const gridType = options?.gridType ?? "square";

  // ============================================
  // VALIDATION: At least one color must be selected
  // ============================================
  // If the grid is entirely blank, throw an error - user must select at least one color
  const isAllBlank = colors.every((row) => row.every((c) => c === null));
  if (isAllBlank) {
    throw new Error("At least one color must be selected");
  }

  // Use provided solver/builder or default to MiniSat
  const solver = options?.solver ?? new MiniSatSolver();
  const builder = options?.builder ?? new MiniSatFormulaBuilder(solver);

  // ============================================
  // OPTIMIZATION: Determine which colors are actually used
  // ============================================
  // Only consider colors that have at least one fixed cell.
  // Blank cells will only be assigned these colors, reducing the encoding size.
  const usedColors = new Set<number>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = colors[row][col];
      if (c !== null) {
        usedColors.add(c);
      }
    }
  }
  // Convert to sorted array for consistent ordering
  const activeColors = Array.from(usedColors).sort((a, b) => a - b);
  
  // Safety check: if somehow no colors are fixed (shouldn't happen given isAllBlank check),
  // return null as we can't create a valid encoding
  if (activeColors.length === 0) {
    return null;
  }

  // ============================================
  // 0. COLOR ASSIGNMENT VARIABLES FOR BLANK CELLS
  // ============================================
  // For blank cells (null), create variables cellColor[row][col][c] meaning "cell has color c"
  // For fixed cells, we don't need variables - color is known
  // OPTIMIZATION: Only create variables for colors that have at least one fixed cell
  const colorVars = new Map<string, number>(); // Maps colorVarKey to variable number

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (colors[row][col] === null) {
        // Blank cell - create variables only for active colors
        const varsForCell: number[] = [];
        for (const c of activeColors) {
          const varNum = builder.createNamedVariable(colorVarKey(row, col, c));
          colorVars.set(colorVarKey(row, col, c), varNum);
          varsForCell.push(varNum);
        }
        // Exactly one color must be assigned
        builder.addExactlyOne(varsForCell);
      }
    }
  }

  // Helper to get color variables for a cell
  // Returns array of [color, variable] pairs where variable being true means cell has that color
  // For fixed cells, returns single element with the fixed color
  function getCellColorInfo(
    row: number,
    col: number
  ): { color: number; var: number | null }[] {
    const fixedColor = colors[row][col];
    if (fixedColor !== null) {
      return [{ color: fixedColor, var: null }];
    }
    // Blank cell - return only active color options with their variables
    const result: { color: number; var: number | null }[] = [];
    for (const c of activeColors) {
      const v = colorVars.get(colorVarKey(row, col, c))!;
      result.push({ color: c, var: v });
    }
    return result;
  }

  // Collect all edges and create edge variables
  const edgeVars = new Map<string, number>();
  const allEdges: Edge[] = [];
  const addedEdgeKeys = new Set<string>();

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const u: GridPoint = { row, col };
      const neighbors = getNeighbors(u, width, height, gridType);
      for (const v of neighbors) {
        const key = edgeKey(u, v);
        if (!addedEdgeKeys.has(key)) {
          addedEdgeKeys.add(key);
          const varNum = builder.createNamedVariable(`edge_${key}`);
          edgeVars.set(key, varNum);
          allEdges.push({ u, v });
        }
      }
    }
  }

  // ============================================
  // 1. DISCONNECTION BETWEEN DIFFERENT COLORS
  // ============================================
  // For every neighboring pair {u,v}, if they have different colors, forbid the edge
  // This is conditional on the color assignments for blank cells
  for (const edge of allEdges) {
    const uColors = getCellColorInfo(edge.u.row, edge.u.col);
    const vColors = getCellColorInfo(edge.v.row, edge.v.col);
    const edgeVar = edgeVars.get(edgeKey(edge.u, edge.v))!;

    // For each combination of colors where u and v have different colors,
    // add constraint: if u has color cU and v has color cV and cU != cV, then edge is blocked
    for (const uInfo of uColors) {
      for (const vInfo of vColors) {
        if (uInfo.color !== vInfo.color) {
          // Constraint: NOT(u has cU) OR NOT(v has cV) OR NOT(edge kept)
          // i.e., if both colors are assigned and they differ, block the edge
          const clause: number[] = [-edgeVar];
          if (uInfo.var !== null) clause.push(-uInfo.var);
          if (vInfo.var !== null) clause.push(-vInfo.var);
          builder.solver.addClause(clause);
        }
      }
    }
  }

  // ============================================
  // 2. CONNECTIVITY WITHIN EACH COLOR
  // ============================================
  // For each color, encode spanning tree constraints
  // With blank cells, we need conditional constraints based on color assignment
  // OPTIMIZATION: Only process active colors (those with at least one fixed cell)
  // EXCEPTION: Skip hatch color - it doesn't need to form a connected component

  for (const color of activeColors) {
    // Skip hatch color - it doesn't need to form a connected component
    if (color === HATCH_COLOR) {
      continue;
    }

    // Find all vertices that could have this color (fixed to this color OR blank)
    const potentialVertices: GridPoint[] = [];
    const fixedVertices: GridPoint[] = [];

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const cellColor = colors[row][col];
        
        if (cellColor === color) {
          potentialVertices.push({ row, col });
          fixedVertices.push({ row, col });
        } else if (cellColor === null) {
          potentialVertices.push({ row, col });
        }
      }
    }

    if (potentialVertices.length <= 1) {
      // At most one vertex can have this color - trivially connected
      continue;
    }

    // Helper to get membership variable for a vertex and this color
    // Returns the variable, or null if the vertex is fixed to this color (always true)
    function getMemberVar(v: GridPoint): number | null {
      const cellColor = colors[v.row][v.col];
      if (cellColor === color) {
        return null; // Fixed to this color - always member
      }
      // Must be blank - return the color variable
      return colorVars.get(colorVarKey(v.row, v.col, color))!;
    }

    // Sort potential vertices lexicographically
    potentialVertices.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    // Create a set of potential vertices for quick lookup
    const potentialSet = new Set(
      potentialVertices.map((v) => `${v.row},${v.col}`)
    );

    // Find potential same-color neighbors for each vertex
    const potentialNeighbors = new Map<string, GridPoint[]>();
    for (const v of potentialVertices) {
      const key = `${v.row},${v.col}`;
      const neighbors = getNeighbors(v, width, height, gridType).filter((n) =>
        potentialSet.has(`${n.row},${n.col}`)
      );
      potentialNeighbors.set(key, neighbors);
    }

    // =============================================
    // ROOT SELECTION
    // =============================================
    // The root is the lexicographically smallest fixed vertex for this color.
    // Since we only process activeColors (colors with at least one fixed cell),
    // there is always at least one fixed vertex to serve as root.
    const fixedRoot = fixedVertices.reduce((min, v) => {
      if (v.row < min.row || (v.row === min.row && v.col < min.col)) {
        return v;
      }
      return min;
    }, fixedVertices[0]);

    // Helper to check if a vertex is the root
    function isRoot(v: GridPoint): boolean {
      return v.row === fixedRoot.row && v.col === fixedRoot.col;
    }

    // 2b) Parent (tree) variables
    const parentVars = new Map<string, number>();

    for (const v of potentialVertices) {
      const neighbors = potentialNeighbors.get(`${v.row},${v.col}`)!;
      for (const u of neighbors) {
        const pKey = parentKey(color, u, v);
        const pVar = builder.createNamedVariable(pKey);
        parentVars.set(pKey, pVar);

        // Parent implies edge exists: p → edge
        const eKey = edgeKey(u, v);
        const edgeVar = edgeVars.get(eKey)!;
        builder.addImplies(pVar, edgeVar);

        // Parent implies both vertices have this color
        const uMember = getMemberVar(u);
        const vMember = getMemberVar(v);
        if (uMember !== null) {
          builder.addImplies(pVar, uMember); // p → u has color
        }
        if (vMember !== null) {
          builder.addImplies(pVar, vMember); // p → v has color
        }
      }
    }

    // 2c) Parent constraints for each vertex
    for (const v of potentialVertices) {
      const vIsRoot = isRoot(v);
      const neighbors = potentialNeighbors.get(`${v.row},${v.col}`)!;
      const vMember = getMemberVar(v);

      // Get all parent variables where some u is parent of v
      const parentVarsForV: number[] = [];
      for (const u of neighbors) {
        const pKey = parentKey(color, u, v);
        const pVar = parentVars.get(pKey);
        if (pVar !== undefined) {
          parentVarsForV.push(pVar);
        }
      }

      if (vIsRoot) {
        // Root - has no parent
        for (const pVar of parentVarsForV) {
          builder.addUnit(-pVar);
        }
      } else {
        // Non-root - must have exactly one parent (if it has this color)
        // At-most-one parent
        if (parentVarsForV.length > 1) {
          builder.addAtMostOne(parentVarsForV);
        }

        // At-least-one parent (conditional on having this color)
        if (parentVarsForV.length > 0) {
          if (vMember !== null) {
            // If this vertex has this color, it needs a parent
            builder.solver.addClause([-vMember, ...parentVarsForV]);
          } else {
            // Fixed to this color - must have a parent
            builder.addOr(parentVarsForV);
          }
        } else {
          // No potential parents available
          if (vMember === null) {
            return null; // Fixed vertex isolated - impossible to connect
          }
          // If blank, forbid this color (can't have a parent)
          builder.addUnit(-vMember);
        }
      }
    }

    // 2d) Level variables for cycle elimination
    const numBits = bitsNeeded(potentialVertices.length);
    const levelVars = new Map<string, number[]>();

    for (const v of potentialVertices) {
      const lKey = levelKey(color, v);
      const bits = createBinaryIntVariables(builder, lKey, numBits);
      levelVars.set(`${v.row},${v.col}`, bits);
    }

    // Root has level 0
    const rootBits = levelVars.get(`${fixedRoot.row},${fixedRoot.col}`)!;
    for (const bit of rootBits) {
      builder.addUnit(-bit);
    }

    // Level ordering constraints
    let auxCounter = 0;
    for (const v of potentialVertices) {
      const neighbors = potentialNeighbors.get(`${v.row},${v.col}`)!;
      const vBits = levelVars.get(`${v.row},${v.col}`)!;

      for (const u of neighbors) {
        const pKey = parentKey(color, u, v);
        const pVar = parentVars.get(pKey);
        if (pVar === undefined) continue;

        const uBits = levelVars.get(`${u.row},${u.col}`)!;
        const auxPrefix = `cmp_${color}_${u.row}${u.col}_${v.row}${v.col}_${auxCounter++}`;
        const n = numBits;

        // eq[i] = (uBits[i] ↔ vBits[i])
        const eq: number[] = [];
        const lt: number[] = [];

        for (let i = 0; i < n; i++) {
          const eqVar = builder.createNamedVariable(`${auxPrefix}_eq_${i}`);
          eq.push(eqVar);

          builder.solver.addClause([-eqVar, -uBits[i], vBits[i]]);
          builder.solver.addClause([-eqVar, uBits[i], -vBits[i]]);
          builder.solver.addClause([eqVar, uBits[i], vBits[i]]);
          builder.solver.addClause([eqVar, -uBits[i], -vBits[i]]);
        }

        for (let i = 0; i < n; i++) {
          lt.push(builder.createNamedVariable(`${auxPrefix}_lt_${i}`));
        }

        for (let bitIdx = n - 1; bitIdx >= 0; bitIdx--) {
          const ltVar = lt[bitIdx];

          if (bitIdx === n - 1) {
            builder.solver.addClause([-ltVar, -uBits[bitIdx]]);
            builder.solver.addClause([-ltVar, vBits[bitIdx]]);
            builder.solver.addClause([ltVar, uBits[bitIdx], -vBits[bitIdx]]);
          } else {
            const prevLt = lt[bitIdx + 1];
            const prefixEq = builder.createNamedVariable(
              `${auxPrefix}_prefixEq_${bitIdx}`
            );

            if (bitIdx === n - 2) {
              builder.solver.addClause([-prefixEq, eq[n - 1]]);
              builder.solver.addClause([prefixEq, -eq[n - 1]]);
            } else {
              const prevPrefix = builder.getVariable(
                `${auxPrefix}_prefixEq_${bitIdx + 1}`
              )!;
              builder.solver.addClause([-prefixEq, prevPrefix]);
              builder.solver.addClause([-prefixEq, eq[bitIdx + 1]]);
              builder.solver.addClause([prefixEq, -prevPrefix, -eq[bitIdx + 1]]);
            }

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

            builder.solver.addClause([-ltVar, prevLt, strictHere]);
            builder.solver.addClause([ltVar, -prevLt]);
            builder.solver.addClause([ltVar, -strictHere]);
          }
        }

        builder.solver.addClause([-pVar, lt[0]]);
      }
    }
  }

  // ============================================
  // 3. PATHLENGTH LOWER BOUND CONSTRAINTS
  // ============================================
  // For each pathlength constraint with a root and minimum distances,
  // enforce that the path from root to each specified cell is at least the minimum distance.
  //
  // We use the standard bounded-reachability SAT encoding:
  //   R[i][v] = "v is reachable from root using kept edges in at most i steps"
  //
  // Constraints:
  //   Base: R[0][root] = true, R[0][other] = false (only for cells in ball)
  //   Step: R[i][v] ↔ R[i-1][v] OR ⋁_{u neighbor of v} (R[i-1][u] ∧ edge(u,v))
  //   Forbidden: For each cell with minDistance d: ¬R[d-1][cell] (not reachable in < d steps)
  //
  // OPTIMIZATION 1: Ball pruning
  // Only create R[i][v] for vertices that are geometrically reachable from root
  // within i steps (Manhattan distance ≤ i for square grids). This commonly cuts
  // pathlength encoding by 5-50× depending on K and grid size.
  //
  // OPTIMIZATION 2: Remove reachThrough helper variables
  // Instead of creating a helper variable for each (R[i-1][n] ∧ edge), encode directly:
  // - Forward: ¬R[i-1][n] ∨ ¬edge ∨ R[i][v] (if neighbor reachable and edge kept, then current reachable)
  // - Backward: uses a big OR clause (already have this)
  // This removes one variable per neighbor per step per cell.
  //
  // This correctly enforces that the shortest-path distance from root to cell is >= d.
  
  const pathlengthConstraints = options?.pathlengthConstraints ?? [];
  
  // Track distance levels for output (computed via BFS after solving)
  const constraintRoots: { constraintId: string; root: GridPoint }[] = [];
  
  /**
   * Compute Manhattan distance for square grid, or appropriate distance for other grid types
   */
  function gridDistance(p1: GridPoint, p2: GridPoint, gType: GridType): number {
    const dr = Math.abs(p1.row - p2.row);
    const dc = Math.abs(p1.col - p2.col);
    
    if (gType === "square") {
      // Manhattan distance for 4-neighbor grid
      return dr + dc;
    } else if (gType === "hex") {
      // Hex distance for odd-r offset coordinates
      // Convert to axial/cube coordinates for proper hex distance
      // For odd-r offset: col stays, row converts based on parity
      // Simplified: use conservative lower bound (Chebyshev)
      // This ensures we don't exclude reachable cells
      return Math.max(dr, dc);
    } else if (gType === "octagon") {
      // Chebyshev distance (can move in 8 directions)
      return Math.max(dr, dc);
    } else {
      // Cairo and CairoBridge: these have 5-7 neighbors
      // Use Chebyshev as conservative lower bound (can reach diagonally)
      return Math.max(dr, dc);
    }
  }
  
  /**
   * Get all cells within distance d from root (the "ball" of radius d)
   */
  function getBall(root: GridPoint, d: number, gType: GridType): Set<string> {
    const ball = new Set<string>();
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (gridDistance(root, { row, col }, gType) <= d) {
          ball.add(`${row},${col}`);
        }
      }
    }
    return ball;
  }
  
  for (const constraint of pathlengthConstraints) {
    if (!constraint.root) {
      // No root set - skip this constraint
      continue;
    }
    
    const root = constraint.root;
    constraintRoots.push({ constraintId: constraint.id, root });
    
    // Get all cells with minimum distance requirements
    const minDistanceEntries = Object.entries(constraint.minDistances);
    if (minDistanceEntries.length === 0) {
      // No distance requirements - skip
      continue;
    }
    
    // Find the maximum K we need to encode (max minDistance - 1)
    let maxK = 0;
    for (const [, dist] of minDistanceEntries) {
      if (dist > 0) {
        maxK = Math.max(maxK, dist - 1);
      }
    }
    
    if (maxK === 0) {
      // All minDistances are 1 or less - no constraints needed
      continue;
    }
    
    // OPTIMIZATION: Precompute balls for each step
    // ball[i] contains all cells that could potentially be reached in i steps
    const balls: Set<string>[] = [];
    for (let step = 0; step <= maxK; step++) {
      balls.push(getBall(root, step, gridType));
    }
    
    // R[i][row,col] variables: reachable in at most i steps
    // OPTIMIZATION: Only create variables for cells in the ball
    const R: Map<string, number>[] = [];
    for (let step = 0; step <= maxK; step++) {
      R.push(new Map<string, number>());
    }
    
    // Create variables only for cells in the ball at each step
    for (let step = 0; step <= maxK; step++) {
      const ball = balls[step];
      for (const key of ball) {
        const varName = `R_${constraint.id}_${step}_${key.replace(',', '_')}`;
        R[step].set(key, builder.createNamedVariable(varName));
      }
    }
    
    // Base case (step 0): only root is reachable
    const rootKey = `${root.row},${root.col}`;
    const r0Root = R[0].get(rootKey);
    if (r0Root !== undefined) {
      builder.addUnit(r0Root); // R[0][root] = true
    }
    // All other cells in ball[0] are not reachable (ball[0] only contains root for distance 0)
    for (const key of balls[0]) {
      if (key !== rootKey) {
        const r0 = R[0].get(key);
        if (r0 !== undefined) {
          builder.addUnit(-r0); // R[0][other] = false
        }
      }
    }
    
    // Inductive step: R[i][v] ↔ R[i-1][v] OR ⋁_{u neighbor} (R[i-1][u] ∧ edge(u,v))
    // OPTIMIZATION: Only process cells in the ball, and remove reachThrough helper vars
    for (let step = 1; step <= maxK; step++) {
      const currentBall = balls[step];
      const prevBall = balls[step - 1];
      
      for (const key of currentBall) {
        const [rowStr, colStr] = key.split(',');
        const row = parseInt(rowStr, 10);
        const col = parseInt(colStr, 10);
        
        const rCurr = R[step].get(key)!;
        
        // Check if this cell was in the previous ball
        const rPrev = R[step - 1].get(key);
        
        const neighbors = getNeighbors({ row, col }, width, height, gridType);
        
        // Collect valid neighbors (those in the previous ball)
        const validNeighbors: { n: GridPoint; rPrevN: number; edgeVar: number }[] = [];
        
        for (const n of neighbors) {
          const nKey = `${n.row},${n.col}`;
          if (!prevBall.has(nKey)) continue; // Neighbor not in previous ball
          
          const rPrevN = R[step - 1].get(nKey);
          if (rPrevN === undefined) continue;
          
          const eKey = edgeKey({ row, col }, n);
          const edgeVar = edgeVars.get(eKey);
          if (edgeVar === undefined) continue;
          
          validNeighbors.push({ n, rPrevN, edgeVar });
        }
        
        // Forward implications (without helper variables):
        // 1. If was reachable before, still reachable: R[i-1][v] → R[i][v]
        if (rPrev !== undefined) {
          builder.solver.addClause([-rPrev, rCurr]);
        }
        
        // 2. If neighbor reachable and edge kept, then current reachable:
        //    (R[i-1][n] ∧ edge(n,v)) → R[i][v]
        //    Equivalent to: ¬R[i-1][n] ∨ ¬edge ∨ R[i][v]
        for (const { rPrevN, edgeVar } of validNeighbors) {
          builder.solver.addClause([-rPrevN, -edgeVar, rCurr]);
        }
        
        // Backward: R[i][v] → (R[i-1][v] OR ⋁_{n} (R[i-1][n] ∧ edge(n,v)))
        // This is harder to encode without helper variables, but we can use:
        // If R[i][v] is true, then either:
        //   - R[i-1][v] is true, OR
        //   - For some neighbor n: R[i-1][n] ∧ edge(n,v)
        //
        // We can encode this as a big clause if we accept that the clause
        // only enforces "at least one way to reach", but for SAT it's correct.
        // Actually, without helper variables, we need a different approach.
        //
        // Alternative: Use the "at least one" clause with implications
        // ¬R[i][v] ∨ R[i-1][v] ∨ ⋁_{n} (R[i-1][n] ∧ edge(n,v))
        //
        // But (R[i-1][n] ∧ edge(n,v)) can't be directly in a clause.
        // So we need helper variables for the backward direction only,
        // OR we can use a weaker encoding that's still sound.
        //
        // For sound encoding, we need: if R[i][v] is true, there must be some
        // justification. The backward clause is essential for propagation.
        //
        // Let's keep helper variables for backward direction only (smaller impact)
        // but encode forward directly.
        
        // Create helper variables for backward clause
        const backwardTerms: number[] = [];
        if (rPrev !== undefined) {
          backwardTerms.push(rPrev);
        }
        
        for (const { n, rPrevN, edgeVar } of validNeighbors) {
          // Create helper: reachThrough = R[i-1][n] ∧ edge
          const reachThrough = builder.createNamedVariable(
            `rt_${constraint.id}_${step}_${n.row}_${n.col}_to_${row}_${col}`
          );
          backwardTerms.push(reachThrough);
          
          // reachThrough → R[i-1][n] (redundant with forward, but needed for definition)
          builder.solver.addClause([-reachThrough, rPrevN]);
          // reachThrough → edge
          builder.solver.addClause([-reachThrough, edgeVar]);
          // (R[i-1][n] ∧ edge) → reachThrough
          builder.solver.addClause([-rPrevN, -edgeVar, reachThrough]);
        }
        
        // Backward: R[i][v] → (rPrev OR ⋁ reachThrough)
        if (backwardTerms.length > 0) {
          builder.solver.addClause([-rCurr, ...backwardTerms]);
        } else {
          // No way to reach this cell - force it to false
          builder.addUnit(-rCurr);
        }
      }
    }
    
    // Constraint: cells with minDistance d must NOT be reachable in < d steps
    // i.e., ¬R[d-1][cell] for each cell with minDistance d
    for (const [cellKey, minDist] of minDistanceEntries) {
      if (minDist <= 1) continue; // minDist of 1 means any distance >= 1 is OK (always satisfied)
      
      const [rowStr, colStr] = cellKey.split(',');
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);
      
      // Validate cell is in bounds
      if (row < 0 || row >= height || col < 0 || col >= width) continue;
      
      const stepToForbid = minDist - 1;
      if (stepToForbid > maxK) continue; // Already covered
      
      // OPTIMIZATION: Check if cell is even in the ball at this step
      // If it's not, the constraint is already satisfied (can't reach it)
      if (!balls[stepToForbid].has(cellKey)) {
        continue; // Cell not in ball - constraint trivially satisfied
      }
      
      const rStep = R[stepToForbid].get(cellKey);
      if (rStep !== undefined) {
        builder.addUnit(-rStep); // NOT reachable in < minDist steps
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

  // Extract solution: edges and assigned colors
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

  // Extract assigned colors
  const assignedColors: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0)
  );

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const fixedColor = colors[row][col];
      if (fixedColor !== null) {
        assignedColors[row][col] = fixedColor;
      } else {
        // Find which color variable is true (only check active colors)
        let foundColor = false;
        for (const c of activeColors) {
          const varNum = colorVars.get(colorVarKey(row, col, c));
          if (varNum !== undefined && result.assignment.get(varNum)) {
            assignedColors[row][col] = c;
            foundColor = true;
            break;
          }
        }
        // If no color variable is true, default to first active color
        if (!foundColor && activeColors.length > 0) {
          assignedColors[row][col] = activeColors[0];
        }
      }
    }
  }

  // Compute distance levels via BFS from each constraint root
  let distanceLevels: Record<string, number[][]> | null = null;
  if (constraintRoots.length > 0) {
    distanceLevels = {};
    
    // Build adjacency from kept edges
    const adjacency = new Map<string, GridPoint[]>();
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        adjacency.set(`${row},${col}`, []);
      }
    }
    for (const edge of keptEdges) {
      const uKey = `${edge.u.row},${edge.u.col}`;
      const vKey = `${edge.v.row},${edge.v.col}`;
      adjacency.get(uKey)!.push(edge.v);
      adjacency.get(vKey)!.push(edge.u);
    }
    
    // BFS from each root
    for (const { constraintId, root } of constraintRoots) {
      const levels = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => -1) // -1 means unreachable
      );
      
      levels[root.row][root.col] = 0;
      const queue: GridPoint[] = [root];
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentLevel = levels[current.row][current.col];
        const neighbors = adjacency.get(`${current.row},${current.col}`)!;
        
        for (const neighbor of neighbors) {
          if (levels[neighbor.row][neighbor.col] === -1) {
            levels[neighbor.row][neighbor.col] = currentLevel + 1;
            queue.push(neighbor);
          }
        }
      }
      
      distanceLevels[constraintId] = levels;
    }
  }

  return { keptEdges, wallEdges, assignedColors, distanceLevels };
}
