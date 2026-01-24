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
  constrainBinaryEqual,
  constrainEqualsPlusOne,
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
  // 3. PATHLENGTH CONSTRAINTS
  // ============================================
  // For each pathlength constraint with a root and distance requirements:
  //
  // REGULAR MODE (treeMaze = false):
  //   Enforce that the path from root to each specified cell is at least the minimum distance.
  //   Uses the standard bounded-reachability SAT encoding:
  //     R[i][v] = "v is reachable from root using kept edges in at most i steps"
  //
  // TREE MAZE MODE (treeMaze = true):
  //   Enforce that the graph forms a tree (no cycles) and distances are EXACT.
  //   This is more efficient because we use equality constraints instead of less-than.
  //   Uses binary-encoded level variables where:
  //     level[child] = level[parent] + 1
  //   Each cell has exactly one parent (tree structure).
  
  const pathlengthConstraints = options?.pathlengthConstraints ?? [];
  
  // Track distance levels for output (computed via BFS after solving)
  const constraintRoots: { constraintId: string; root: GridPoint }[] = [];
  
  for (const constraint of pathlengthConstraints) {
    if (!constraint.root) {
      // No root set - skip this constraint
      continue;
    }
    
    const root = constraint.root;
    constraintRoots.push({ constraintId: constraint.id, root });
    
    // Get all cells with distance requirements
    const distanceEntries = Object.entries(constraint.minDistances);
    
    if (constraint.treeMaze) {
      // ============================================
      // TREE MAZE MODE: Binary-encoded exact distances
      // ============================================
      // This mode enforces:
      // 1. The graph of kept edges forms a tree rooted at constraint.root
      // 2. Each cell's level (distance from root) is exactly encoded
      // 3. Distance constraints become exact equality constraints
      
      // Calculate maximum distance needed for encoding:
      // - Must be at least as large as any specified distance constraint
      // - Also consider the grid size as a baseline
      // The number of bits must be sufficient to represent all required distances
      let maxRequiredDist = width + height - 1; // Baseline from grid size
      for (const [, dist] of distanceEntries) {
        if (dist > maxRequiredDist) {
          maxRequiredDist = dist;
        }
      }
      const numBits = bitsNeeded(maxRequiredDist + 1);
      
      // Helper to check if a cell is HATCH (should be excluded from tree structure)
      function isHatchCell(row: number, col: number): boolean {
        return colors[row][col] === HATCH_COLOR;
      }
      
      // Create binary-encoded level variables for each non-HATCH cell
      const treeLevelVars = new Map<string, number[]>();
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          // Skip HATCH cells - they don't participate in tree structure
          if (isHatchCell(row, col)) continue;
          
          const key = `${row},${col}`;
          const bits = createBinaryIntVariables(
            builder,
            `treeLvl_${constraint.id}_${row}_${col}`,
            numBits
          );
          treeLevelVars.set(key, bits);
        }
      }
      
      // Root has level 0
      const rootKey = `${root.row},${root.col}`;
      const rootBits = treeLevelVars.get(rootKey);
      if (rootBits) {
        constrainBinaryEqual(builder, rootBits, 0);
      }
      
      // Create tree parent variables: treeParent[v][u] = "u is the parent of v in the tree"
      const treeParentVars = new Map<string, number>();
      
      function treeParentKey(child: GridPoint, parent: GridPoint): string {
        return `treeParent_${constraint.id}_${child.row},${child.col}_from_${parent.row},${parent.col}`;
      }
      
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          // Skip HATCH cells - they're not part of the tree structure
          if (isHatchCell(row, col)) continue;
          
          const v: GridPoint = { row, col };
          const neighbors = getNeighbors(v, width, height, gridType);
          
          for (const u of neighbors) {
            // Skip edges to HATCH cells
            if (isHatchCell(u.row, u.col)) continue;
            
            const pKey = treeParentKey(v, u);
            const pVar = builder.createNamedVariable(pKey);
            treeParentVars.set(pKey, pVar);
            
            // If u is parent of v, then the edge between them must exist
            const eKey = edgeKey(u, v);
            const edgeVar = edgeVars.get(eKey);
            if (edgeVar !== undefined) {
              builder.addImplies(pVar, edgeVar);
            }
            
            // If u is parent of v, then level[v] = level[u] + 1
            const uBits = treeLevelVars.get(`${u.row},${u.col}`)!;
            const vBits = treeLevelVars.get(`${v.row},${v.col}`)!;
            constrainEqualsPlusOne(builder, vBits, uBits, pVar, `treeAdd_${constraint.id}_${v.row}${v.col}_${u.row}${u.col}`);
          }
        }
      }
      
      // KEY CONSTRAINT FOR TREE STRUCTURE (TEMPORARILY DISABLED):
      // This constraint forces all kept edges to be part of the tree structure,
      // but it conflicts with the connectivity spanning tree constraints.
      // TODO: Need to integrate tree maze with the connectivity encoding properly.
      /*
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          // Skip HATCH cells
          if (isHatchCell(row, col)) continue;
          
          const v: GridPoint = { row, col };
          const neighbors = getNeighbors(v, width, height, gridType);
          
          for (const u of neighbors) {
            // Skip edges to HATCH cells
            if (isHatchCell(u.row, u.col)) continue;
            
            // Only process each edge once (when u < v lexicographically)
            if (u.row > v.row || (u.row === v.row && u.col >= v.col)) continue;
            
            const eKey = edgeKey(u, v);
            const edgeVar = edgeVars.get(eKey);
            if (edgeVar === undefined) continue;
            
            const pUV = treeParentVars.get(treeParentKey(v, u)); // u is parent of v
            const pVU = treeParentVars.get(treeParentKey(u, v)); // v is parent of u
            
            if (pUV !== undefined && pVU !== undefined) {
              // edge(u,v) → (parent(u,v) ∨ parent(v,u))
              // -edge ∨ parent(u,v) ∨ parent(v,u)
              builder.solver.addClause([-edgeVar, pUV, pVU]);
            }
          }
        }
      }
      */
      
      // Each non-root, non-HATCH cell: at most one parent (allows cells to not be in tree)
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          // Skip HATCH cells
          if (isHatchCell(row, col)) continue;
          
          if (row === root.row && col === root.col) {
            // Root has no parent
            const neighbors = getNeighbors(root, width, height, gridType);
            for (const u of neighbors) {
              if (isHatchCell(u.row, u.col)) continue;
              const pKey = treeParentKey(root, u);
              const pVar = treeParentVars.get(pKey);
              if (pVar !== undefined) {
                builder.addUnit(-pVar);
              }
            }
          } else {
            // Non-root: at most one parent (allows cells to not be in tree)
            const v: GridPoint = { row, col };
            const neighbors = getNeighbors(v, width, height, gridType);
            const parentVarsForV: number[] = [];
            
            for (const u of neighbors) {
              if (isHatchCell(u.row, u.col)) continue;
              const pKey = treeParentKey(v, u);
              const pVar = treeParentVars.get(pKey);
              if (pVar !== undefined) {
                parentVarsForV.push(pVar);
              }
            }
            
            // At most one parent (allows cells to not be in the tree)
            if (parentVarsForV.length > 1) {
              builder.addAtMostOne(parentVarsForV);
            }
          }
        }
      }
      
      // Apply exact distance constraints
      // For cells with distance requirements, they MUST be in the tree (have a parent if not root)
      for (const [cellKey, exactDist] of distanceEntries) {
        if (exactDist < 0) continue;
        
        const [rowStr, colStr] = cellKey.split(',');
        const row = parseInt(rowStr, 10);
        const col = parseInt(colStr, 10);
        
        // Validate cell is in bounds
        if (row < 0 || row >= height || col < 0 || col >= width) continue;
        
        // Skip HATCH cells - they can't be part of tree structure
        if (isHatchCell(row, col)) continue;
        
        // In tree maze mode, the distance is EXACT
        const cellBits = treeLevelVars.get(cellKey);
        if (!cellBits) continue; // Skip if no level variables (shouldn't happen for non-HATCH)
        constrainBinaryEqual(builder, cellBits, exactDist);
        
        // Ensure this cell is in the tree (has exactly one parent, unless it's the root)
        if (!(row === root.row && col === root.col)) {
          const v: GridPoint = { row, col };
          const neighbors = getNeighbors(v, width, height, gridType);
          const parentVarsForV: number[] = [];
          
          for (const u of neighbors) {
            if (isHatchCell(u.row, u.col)) continue;
            const pKey = treeParentKey(v, u);
            const pVar = treeParentVars.get(pKey);
            if (pVar !== undefined) {
              parentVarsForV.push(pVar);
            }
          }
          
          // This cell MUST have at least one parent (be in the tree)
          if (parentVarsForV.length > 0) {
            builder.addOr(parentVarsForV);
          }
        }
      }
      
    } else {
      // ============================================
      // REGULAR MODE: Bounded reachability encoding
      // ============================================
      // Enforce distance >= minDistance using standard bounded-reachability encoding
      
      if (distanceEntries.length === 0) {
        // No distance requirements - skip
        continue;
      }
      
      // Find the maximum K we need to encode (max minDistance - 1)
      let maxK = 0;
      for (const [, dist] of distanceEntries) {
        if (dist > 0) {
          maxK = Math.max(maxK, dist - 1);
        }
      }
      
      if (maxK === 0) {
        // All minDistances are 1 or less - no constraints needed
        continue;
      }
      
      // R[i][row,col] variables: reachable in at most i steps
      const R: Map<string, number>[] = [];
      for (let step = 0; step <= maxK; step++) {
        R.push(new Map<string, number>());
      }
      
      // Create variables for all cells at all steps
      for (let step = 0; step <= maxK; step++) {
        for (let row = 0; row < height; row++) {
          for (let col = 0; col < width; col++) {
            const key = `${row},${col}`;
            const varName = `R_${constraint.id}_${step}_${row}_${col}`;
            R[step].set(key, builder.createNamedVariable(varName));
          }
        }
      }
      
      // Base case (step 0): only root is reachable
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const key = `${row},${col}`;
          const r0 = R[0].get(key)!;
          if (row === root.row && col === root.col) {
            // R[0][root] = true
            builder.addUnit(r0);
          } else {
            // R[0][other] = false
            builder.addUnit(-r0);
          }
        }
      }
      
      // Inductive step: R[i][v] ↔ R[i-1][v] OR ⋁_{u neighbor} (R[i-1][u] ∧ edge(u,v))
      for (let step = 1; step <= maxK; step++) {
        for (let row = 0; row < height; row++) {
          for (let col = 0; col < width; col++) {
            const key = `${row},${col}`;
            const rCurr = R[step].get(key)!;
            const rPrev = R[step - 1].get(key)!;
            const neighbors = getNeighbors({ row, col }, width, height, gridType);
            
            // Collect all "reachable through neighbor" terms
            const reachThroughNeighbor: number[] = [];
            
            for (const n of neighbors) {
              const nKey = `${n.row},${n.col}`;
              const rPrevN = R[step - 1].get(nKey)!;
              const eKey = edgeKey({ row, col }, n);
              const edgeVar = edgeVars.get(eKey);
              if (edgeVar === undefined) continue;
              
              // Create helper variable: reachThrough = R[i-1][n] ∧ edge(n,v)
              const reachThrough = builder.createNamedVariable(
                `reach_${constraint.id}_${step}_${n.row}_${n.col}_to_${row}_${col}`
              );
              reachThroughNeighbor.push(reachThrough);
              
              // reachThrough → R[i-1][n]
              builder.solver.addClause([-reachThrough, rPrevN]);
              // reachThrough → edge
              builder.solver.addClause([-reachThrough, edgeVar]);
              // (R[i-1][n] ∧ edge) → reachThrough
              builder.solver.addClause([-rPrevN, -edgeVar, reachThrough]);
            }
            
            // R[i][v] ↔ R[i-1][v] OR ⋁ reachThroughNeighbor
            // Forward: (R[i-1][v] OR any reachThrough) → R[i][v]
            builder.solver.addClause([-rPrev, rCurr]); // R[i-1][v] → R[i][v]
            for (const rt of reachThroughNeighbor) {
              builder.solver.addClause([-rt, rCurr]); // reachThrough → R[i][v]
            }
            
            // Backward: R[i][v] → (R[i-1][v] OR ⋁ reachThroughNeighbor)
            const backwardClause = [-rCurr, rPrev, ...reachThroughNeighbor];
            builder.solver.addClause(backwardClause);
          }
        }
      }
      
      // Constraint: cells with minDistance d must NOT be reachable in < d steps
      // i.e., ¬R[d-1][cell] for each cell with minDistance d
      for (const [cellKey, minDist] of distanceEntries) {
        if (minDist <= 1) continue; // minDist of 1 means any distance >= 1 is OK (always satisfied)
        
        const [rowStr, colStr] = cellKey.split(',');
        const row = parseInt(rowStr, 10);
        const col = parseInt(colStr, 10);
        
        // Validate cell is in bounds
        if (row < 0 || row >= height || col < 0 || col >= width) continue;
        
        const stepToForbid = minDist - 1;
        if (stepToForbid > maxK) continue; // Already covered
        
        const rStep = R[stepToForbid].get(cellKey);
        if (rStep !== undefined) {
          builder.addUnit(-rStep); // NOT reachable in < minDist steps
        }
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
