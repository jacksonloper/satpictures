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
  addAtLeastKFalse,
  createBinaryIntVariables,
  MiniSatFormulaBuilder,
  MiniSatSolver,
} from "../sat";
import type { FormulaBuilder, SATSolver, SolveResult } from "../sat";

/**
 * Special hatch color index - cells with this color don't need to form 
 * a connected component, but must still be disconnected from other colors
 */
export const HATCH_COLOR = -2;

/**
 * Special red with dot color index - serves as the origin for bounded reachability tree.
 * At most one tile can have this color.
 */
export const RED_DOT_COLOR = -3;

/**
 * Special red with hatch color index - constrained to have reachability greater than K
 * from the RED_DOT_COLOR origin.
 */
export const RED_HATCH_COLOR = -4;

/**
 * Grid type - square, hex, or octagon
 */
export type GridType = "square" | "hex" | "octagon";

/**
 * Represents a point in the grid
 */
export interface GridPoint {
  row: number;
  col: number;
}

/**
 * Grid with colors assigned to each point
 * null means the cell is blank and the solver should determine its color
 */
export interface ColorGrid {
  width: number;
  height: number;
  colors: (number | null)[][]; // colors[row][col], null = blank
}

/**
 * An edge between two adjacent grid points
 */
export interface Edge {
  u: GridPoint;
  v: GridPoint;
}

/**
 * Solution: which edges to keep (no wall) and assigned colors for blank cells
 */
export interface GridSolution {
  keptEdges: Edge[];
  wallEdges: Edge[];
  assignedColors: number[][]; // Full grid with all colors determined
}

/**
 * Get the 4-neighbors of a point for square grid within bounds
 */
function getSquareNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
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
 * Get the 6-neighbors of a point for hex grid (offset coordinates) within bounds
 * Uses "odd-r" offset coordinates where odd rows are shifted right
 */
function getHexNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  
  // For hex grids with odd-r offset coordinates:
  // Even rows: NW, NE, W, E, SW, SE offsets
  // Odd rows: different offsets due to stagger
  const isOddRow = p.row % 2 === 1;
  
  const deltas = isOddRow
    ? [
        [-1, 0],  // NW
        [-1, 1],  // NE
        [0, -1],  // W
        [0, 1],   // E
        [1, 0],   // SW
        [1, 1],   // SE
      ]
    : [
        [-1, -1], // NW
        [-1, 0],  // NE
        [0, -1],  // W
        [0, 1],   // E
        [1, -1],  // SW
        [1, 0],   // SE
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
 * Get the 8-neighbors of a point for octagon grid (like square but with 8 directions)
 * Each octagon can connect to 4 cardinal + 4 diagonal neighbors
 */
function getOctagonNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  const deltas = [
    [-1, -1], // NW (diagonal)
    [-1, 0],  // N
    [-1, 1],  // NE (diagonal)
    [0, -1],  // W
    [0, 1],   // E
    [1, -1],  // SW (diagonal)
    [1, 0],   // S
    [1, 1],   // SE (diagonal)
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
 * Get neighbors based on grid type
 */
function getNeighbors(p: GridPoint, width: number, height: number, gridType: GridType = "square"): GridPoint[] {
  if (gridType === "hex") {
    return getHexNeighbors(p, width, height);
  }
  if (gridType === "octagon") {
    return getOctagonNeighbors(p, width, height);
  }
  return getSquareNeighbors(p, width, height);
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
 * Create a key for a cell's color variable
 */
function colorVarKey(row: number, col: number, color: number): string {
  return `cellColor_${row},${col}_${color}`;
}

/**
 * Create a trivial solution for an all-blank grid.
 * Assigns all cells to color 0 and keeps all edges (fully connected).
 * This satisfies the connectivity constraint trivially since all cells
 * are the same color and form one connected component.
 */
function createTrivialSolution(width: number, height: number, gridType: GridType = "square"): GridSolution {
  const keptEdges: Edge[] = [];
  const wallEdges: Edge[] = [];
  const addedEdges = new Set<string>();

  // Keep all internal edges (no walls within the grid)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const neighbors = getNeighbors({ row, col }, width, height, gridType);
      for (const n of neighbors) {
        const key = edgeKey({ row, col }, n);
        if (!addedEdges.has(key)) {
          addedEdges.add(key);
          keptEdges.push({
            u: { row, col },
            v: n,
          });
        }
      }
    }
  }

  // Assign all cells to color 0
  const assignedColors: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0)
  );

  return { keptEdges, wallEdges, assignedColors };
}

/**
 * Options for the grid coloring solver
 */
export interface SolveOptions {
  /** Custom SAT solver instance (defaults to MiniSat) */
  solver?: SATSolver;
  /** Custom formula builder (defaults to MiniSatFormulaBuilder) */
  builder?: FormulaBuilder;
  /** Minimum proportion of edges that must be walls (0 to 1, default 0) */
  minWallsProportion?: number;
  /** Grid type: square (4-neighbors) or hex (6-neighbors) */
  gridType?: GridType;
  /** K value for bounded reachability - RED_HATCH_COLOR cells must have reachability > K from RED_DOT_COLOR (default 0) */
  reachabilityK?: number;
}

/**
 * Encode and solve the grid coloring problem
 * 
 * @param grid The grid with colors assigned to cells (null = blank, solver decides)
 * @param _numColors Number of available colors (parameter kept for API compatibility,
 *                   but blank cells are now only assigned colors that already have fixed cells)
 * @param options Optional solver configuration
 */
export function solveGridColoring(
  grid: ColorGrid,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _numColors: number = 6,
  options?: SolveOptions
): GridSolution | null {
  const { width, height, colors } = grid;
  const gridType = options?.gridType ?? "square";

  // ============================================
  // FAST PATH: All-blank grid optimization
  // ============================================
  // If the grid is entirely blank, return a trivial solution:
  // assign all cells to color 0 and keep all edges (fully connected)
  const isAllBlank = colors.every((row) => row.every((c) => c === null));
  if (isAllBlank) {
    return createTrivialSolution(width, height, gridType);
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
      return [{ color: fixedColor, var: null }]; // Fixed color, no variable
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
  // 1a. MINIMUM WALLS CONSTRAINT
  // ============================================
  // If minWallsProportion is specified, require at least that proportion of edges to be walls.
  // A wall means the edge variable is false (edge not kept).
  const minWallsProportion = options?.minWallsProportion ?? 0;
  if (minWallsProportion > 0 && allEdges.length > 0) {
    const minWalls = Math.ceil(minWallsProportion * allEdges.length);
    if (minWalls > 0) {
      // Collect all edge variables
      const edgeVarList = allEdges.map(edge => edgeVars.get(edgeKey(edge.u, edge.v))!);
      // Add constraint: at least minWalls of the edge variables must be false (walls)
      addAtLeastKFalse(builder, edgeVarList, minWalls, "minWalls");
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
  // 1b. DEGREE CONSTRAINTS (1-3 edges per cell)
  // ============================================
  // Each cell must have between 1 and 3 edges (passages)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Get all edge variables incident to this cell
      const incidentEdges: number[] = [];
      const neighbors = getNeighbors({ row, col }, width, height, gridType);
      for (const n of neighbors) {
        const key = edgeKey({ row, col }, n);
        const edgeVar = edgeVars.get(key);
        if (edgeVar !== undefined) {
          incidentEdges.push(edgeVar);
        }
      }

      if (incidentEdges.length > 0) {
        // At least 1 edge: OR of all incident edges
        builder.addOr(incidentEdges);

        // At most 3 edges: for each subset of 4 edges, at least one must be false
        // This means we forbid any 4 edges from being true simultaneously
        if (incidentEdges.length >= 4) {
          // Generate all 4-combinations and add a clause for each
          // For each combo of 4, at least one must be false (NOT all 4 true)
          const n = incidentEdges.length;
          for (let i = 0; i < n - 3; i++) {
            for (let j = i + 1; j < n - 2; j++) {
              for (let k = j + 1; k < n - 1; k++) {
                for (let l = k + 1; l < n; l++) {
                  // At least one of these 4 edges must be false
                  builder.solver.addClause([
                    -incidentEdges[i],
                    -incidentEdges[j],
                    -incidentEdges[k],
                    -incidentEdges[l],
                  ]);
                }
              }
            }
          }
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
    // Skip red_dot and red_hatch colors - they have special handling
    if (color === HATCH_COLOR || color === RED_DOT_COLOR || color === RED_HATCH_COLOR) {
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
    // DYNAMIC ROOT SELECTION
    // =============================================
    // For colors with no fixed vertices, the root is the lex-smallest member.
    // Create "isRoot" variable for each potential vertex.
    // isRoot[v] = true iff v is a member AND all lex-smaller vertices are not members
    const hasFixedRoot = fixedVertices.length > 0;
    const fixedRoot = hasFixedRoot
      ? fixedVertices.reduce((min, v) => {
          if (v.row < min.row || (v.row === min.row && v.col < min.col)) {
            return v;
          }
          return min;
        }, fixedVertices[0])
      : null;

    // For dynamic roots, create isRoot variables
    const isRootVars = new Map<string, number>();
    if (!hasFixedRoot) {
      // For each vertex, isRoot[v] means v is the root for this color
      // isRoot[v] ↔ member[v] ∧ ∀u<v: ¬member[u]
      for (let i = 0; i < potentialVertices.length; i++) {
        const v = potentialVertices[i];
        const vKey = `${v.row},${v.col}`;
        const isRootVar = builder.createNamedVariable(
          `isRoot_${color}_${v.row},${v.col}`
        );
        isRootVars.set(vKey, isRootVar);

        const vMember = getMemberVar(v)!; // All potential vertices are blank here

        if (i === 0) {
          // First vertex: isRoot ↔ member
          // isRoot → member
          builder.addImplies(isRootVar, vMember);
          // member → isRoot
          builder.addImplies(vMember, isRootVar);
        } else {
          // isRoot[v] ↔ member[v] ∧ ¬member[u0] ∧ ¬member[u1] ∧ ...
          // where u0, u1, ... are all vertices before v

          // Collect all previous member variables
          const prevMembers: number[] = [];
          for (let j = 0; j < i; j++) {
            const u = potentialVertices[j];
            const uMember = getMemberVar(u)!;
            prevMembers.push(uMember);
          }

          // isRoot → member[v]
          builder.addImplies(isRootVar, vMember);

          // isRoot → ¬member[u] for all previous u
          for (const uMember of prevMembers) {
            builder.solver.addClause([-isRootVar, -uMember]);
          }

          // (member[v] ∧ ¬member[u0] ∧ ...) → isRoot
          // Contrapositive: ¬isRoot → (¬member[v] ∨ member[u0] ∨ ...)
          builder.solver.addClause([isRootVar, -vMember, ...prevMembers]);
        }
      }
    }

    // Helper to check if a vertex is the root
    function isRoot(v: GridPoint): boolean | number {
      if (hasFixedRoot) {
        return v.row === fixedRoot!.row && v.col === fixedRoot!.col;
      }
      // Return the isRoot variable
      return isRootVars.get(`${v.row},${v.col}`)!;
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

      if (typeof vIsRoot === "boolean" && vIsRoot) {
        // Fixed root - has no parent
        for (const pVar of parentVarsForV) {
          builder.addUnit(-pVar);
        }
      } else if (typeof vIsRoot === "boolean" && !vIsRoot) {
        // Fixed non-root with fixed color - must have exactly one parent
        // At-most-one parent
        if (parentVarsForV.length > 1) {
          builder.addAtMostOne(parentVarsForV);
        }

        // At-least-one parent (since it's fixed to this color)
        if (parentVarsForV.length > 0) {
          if (vMember !== null) {
            builder.solver.addClause([-vMember, ...parentVarsForV]);
          } else {
            builder.addOr(parentVarsForV);
          }
        } else {
          if (vMember === null) {
            return null; // Fixed vertex isolated
          }
          builder.addUnit(-vMember);
        }
      } else {
        // Dynamic root case - vIsRoot is a variable
        const isRootVar = vIsRoot as number;

        // At-most-one parent (always applies)
        if (parentVarsForV.length > 1) {
          builder.addAtMostOne(parentVarsForV);
        }

        // If root, no parent: isRoot → ¬p for all p
        for (const pVar of parentVarsForV) {
          builder.solver.addClause([-isRootVar, -pVar]);
        }

        // If member and not root, must have parent: (member ∧ ¬isRoot) → OR(parents)
        // i.e., ¬member ∨ isRoot ∨ OR(parents)
        if (parentVarsForV.length > 0) {
          if (vMember !== null) {
            builder.solver.addClause([-vMember, isRootVar, ...parentVarsForV]);
          } else {
            // Fixed member, must be root or have parent
            builder.solver.addClause([isRootVar, ...parentVarsForV]);
          }
        } else {
          // No potential parents - must be root if member
          if (vMember !== null) {
            // member → isRoot
            builder.addImplies(vMember, isRootVar);
          } else {
            // Fixed member with no parents - must be root
            builder.addUnit(isRootVar);
          }
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

    // Root has level 0: for fixed root, set directly; for dynamic root, conditional
    if (hasFixedRoot) {
      const rootBits = levelVars.get(`${fixedRoot!.row},${fixedRoot!.col}`)!;
      for (const bit of rootBits) {
        builder.addUnit(-bit);
      }
    } else {
      // For dynamic roots: isRoot[v] → level[v] = 0
      for (const v of potentialVertices) {
        const vKey = `${v.row},${v.col}`;
        const isRootVar = isRootVars.get(vKey)!;
        const vBits = levelVars.get(vKey)!;
        for (const bit of vBits) {
          builder.solver.addClause([-isRootVar, -bit]); // isRoot → bit = 0
        }
      }
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
  // 3. RED_DOT_COLOR CONSTRAINT: At most one cell
  // ============================================
  // Find all cells that have RED_DOT_COLOR (either fixed or variable)
  const redDotCells: { row: number; col: number; var: number | null }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cellColor = colors[row][col];
      if (cellColor === RED_DOT_COLOR) {
        redDotCells.push({ row, col, var: null }); // Fixed to RED_DOT_COLOR
      } else if (cellColor === null && activeColors.includes(RED_DOT_COLOR)) {
        const v = colorVars.get(colorVarKey(row, col, RED_DOT_COLOR));
        if (v !== undefined) {
          redDotCells.push({ row, col, var: v });
        }
      }
    }
  }

  // If there are multiple possible RED_DOT_COLOR cells, add at-most-one constraint
  if (redDotCells.length > 1) {
    // Collect all the variables for cells that could have RED_DOT_COLOR
    // For fixed cells, we count them separately
    const fixedRedDotCount = redDotCells.filter(c => c.var === null).length;
    const redDotVars = redDotCells.filter(c => c.var !== null).map(c => c.var!);
    
    if (fixedRedDotCount > 1) {
      // More than one cell is already fixed to RED_DOT_COLOR - unsatisfiable
      return null;
    } else if (fixedRedDotCount === 1) {
      // Exactly one fixed RED_DOT_COLOR - all other potential cells must NOT have RED_DOT_COLOR
      for (const v of redDotVars) {
        builder.addUnit(-v);
      }
    } else {
      // No fixed RED_DOT_COLOR cells - at most one can be selected
      builder.addAtMostOne(redDotVars);
    }
  }

  // ============================================
  // 4. BOUNDED REACHABILITY CONSTRAINT
  // ============================================
  // RED_HATCH_COLOR cells must have reachability > K from RED_DOT_COLOR origin
  // This is computed over all edges (any color can participate in the reachability path)
  const reachabilityK = options?.reachabilityK ?? 0;
  
  // Find all RED_HATCH_COLOR cells
  const redHatchCells: GridPoint[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (colors[row][col] === RED_HATCH_COLOR) {
        redHatchCells.push({ row, col });
      }
    }
  }

  // Only add reachability constraints if we have both RED_DOT_COLOR and RED_HATCH_COLOR cells
  if (redDotCells.length > 0 && redHatchCells.length > 0 && reachabilityK > 0) {
    // For each cell, create a reachability level variable (distance from any RED_DOT_COLOR origin)
    // Level is unbounded, but we only need to track up to K+1 for the constraint
    const totalCells = width * height;
    const reachNumBits = bitsNeeded(totalCells + 1); // Need to represent 0 to totalCells
    const reachLevelVars = new Map<string, number[]>();
    
    // Create reachability level variables for all cells
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const key = `${row},${col}`;
        const bits = createBinaryIntVariables(builder, `reach_level_${row},${col}`, reachNumBits);
        reachLevelVars.set(key, bits);
      }
    }
    
    // For RED_DOT_COLOR cells (the origin), level = 0
    for (const cell of redDotCells) {
      const key = `${cell.row},${cell.col}`;
      const bits = reachLevelVars.get(key)!;
      
      if (cell.var === null) {
        // Fixed to RED_DOT_COLOR - level must be 0
        for (const bit of bits) {
          builder.addUnit(-bit);
        }
      } else {
        // Variable - if this cell is RED_DOT_COLOR, then level = 0
        // cell.var → (all bits = 0)
        for (const bit of bits) {
          builder.solver.addClause([-cell.var, -bit]);
        }
      }
    }
    
    // For each cell, if it's reachable (level > 0), it must have a neighbor with level = current_level - 1
    // and an edge to that neighbor
    // This enforces that level represents shortest path distance
    // Constraint: For all cells v, for all neighbors u:
    //   level[v] = level[u] + 1 if there's an edge (u,v) and level[u] < level[v]
    // More simply: level[v] <= min(level[u] + 1) for all neighbors u with edge
    
    // Instead of full min encoding, we use: 
    // For each cell v that's not the origin:
    //   There exists a neighbor u such that edge(u,v) exists AND level[v] = level[u] + 1
    // This is the parent relationship for BFS tree
    
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        // Skip RED_DOT_COLOR cells (they are the origin with level 0)
        const cellColor = colors[row][col];
        const isOrigin = cellColor === RED_DOT_COLOR;
        if (isOrigin) continue;
        
        const vKey = `${row},${col}`;
        const vBits = reachLevelVars.get(vKey)!;
        const neighbors = getNeighbors({ row, col }, width, height, gridType);
        
        // Create "parent" variables for this cell (similar to tree connectivity)
        const parentVars: number[] = [];
        for (const n of neighbors) {
          const nKey = `${n.row},${n.col}`;
          const nBits = reachLevelVars.get(nKey)!;
          const eKey = edgeKey({ row, col }, n);
          const edgeVar = edgeVars.get(eKey);
          if (edgeVar === undefined) continue;
          
          // Create a parent variable: "n is parent of (row,col) in reachability tree"
          const pVar = builder.createNamedVariable(`reach_parent_${n.row},${n.col}->${row},${col}`);
          parentVars.push(pVar);
          
          // If pVar is true, then edge must exist
          builder.addImplies(pVar, edgeVar);
          
          // If pVar is true, then level[v] = level[n] + 1
          // This requires comparing binary numbers
          // level[v] = level[n] + 1
          // We encode: pVar → (level[v] = level[n] + 1)
          
          // For the increment encoding, we use a ripple-carry adder logic
          // level[v] = level[n] + 1
          // bit 0: vBits[0] = NOT nBits[0], carry = nBits[0]
          // bit i: vBits[i] = nBits[i] XOR carry, next_carry = nBits[i] AND carry
          
          // Create carry variables for the addition
          const carries: number[] = [];
          for (let i = 0; i < reachNumBits; i++) {
            carries.push(builder.createNamedVariable(`reach_carry_${n.row},${n.col}->${row},${col}_${i}`));
          }
          
          // Under assumption pVar:
          // carry[0] = 1 (adding 1)
          builder.solver.addClause([-pVar, carries[0]]);
          
          // For each bit position:
          for (let i = 0; i < reachNumBits; i++) {
            if (i === 0) {
              // vBits[0] = nBits[0] XOR 1 = NOT nBits[0]
              // pVar → (vBits[0] ↔ NOT nBits[0])
              builder.solver.addClause([-pVar, -vBits[0], -nBits[0]]);
              builder.solver.addClause([-pVar, vBits[0], nBits[0]]);
              
              // carry[1] = nBits[0] AND 1 = nBits[0] (if we have more bits)
              if (i + 1 < reachNumBits) {
                builder.solver.addClause([-pVar, -carries[i + 1], nBits[0]]);
                builder.solver.addClause([-pVar, carries[i + 1], -nBits[0]]);
              }
            } else {
              // vBits[i] = nBits[i] XOR carries[i]
              // pVar → (vBits[i] ↔ (nBits[i] XOR carries[i]))
              
              // XOR encoding: vBits[i] = nBits[i] XOR carries[i]
              // If pVar: vBits[i] is true iff exactly one of nBits[i], carries[i] is true
              builder.solver.addClause([-pVar, -vBits[i], nBits[i], carries[i]]);
              builder.solver.addClause([-pVar, -vBits[i], -nBits[i], -carries[i]]);
              builder.solver.addClause([-pVar, vBits[i], nBits[i], -carries[i]]);
              builder.solver.addClause([-pVar, vBits[i], -nBits[i], carries[i]]);
              
              // Next carry: carries[i+1] = nBits[i] AND carries[i]
              if (i + 1 < reachNumBits) {
                builder.solver.addClause([-pVar, -carries[i + 1], nBits[i]]);
                builder.solver.addClause([-pVar, -carries[i + 1], carries[i]]);
                builder.solver.addClause([-pVar, carries[i + 1], -nBits[i], -carries[i]]);
              }
            }
          }
        }
        
        // Every non-origin cell must have exactly one parent in the reachability tree
        // (This ensures all cells are reachable from the origin)
        // But we only enforce this if the cell is not isolated - it needs at least one edge
        if (parentVars.length > 0) {
          // At least one parent (the cell is reachable)
          // For now, we don't require all cells to be reachable - only that 
          // if a cell IS reachable, it follows the level constraint
          
          // We need: at most one parent (tree structure)
          builder.addAtMostOne(parentVars);
        }
      }
    }
    
    // Constraint: RED_HATCH_COLOR cells must have level > K
    // level > K means level >= K+1, so we need the binary value >= K+1
    for (const cell of redHatchCells) {
      const key = `${cell.row},${cell.col}`;
      const bits = reachLevelVars.get(key)!;
      
      // Encode: level >= K+1 (i.e., level > K)
      // We need to create a constraint that the binary number is >= K+1
      const minLevel = reachabilityK + 1;
      
      // Create auxiliary variables to encode level >= minLevel
      // This uses the approach: level >= minLevel iff NOT(level < minLevel)
      // level < minLevel iff level <= minLevel - 1
      
      // Direct encoding: at least one bit position where the constraint forces >= minLevel
      // Binary comparison: bits represent level, we need level >= minLevel
      
      // We encode this by requiring that the binary value is at least minLevel
      // Using a standard binary >= comparison
      const minLevelBinary: boolean[] = [];
      let temp = minLevel;
      for (let i = 0; i < reachNumBits; i++) {
        minLevelBinary.push((temp & 1) === 1);
        temp >>= 1;
      }
      
      // Encode: bits >= minLevelBinary
      // From MSB to LSB: 
      // - If bits[i] > minLevelBinary[i], we're done (>=)
      // - If bits[i] < minLevelBinary[i], fail
      // - If bits[i] == minLevelBinary[i], check next bit
      
      // Create auxiliary variables for "prefix equal" and "greater at position"
      // geq[i] = true iff bits[0..i] >= minLevelBinary[0..i]
      // Starting from MSB (highest bit)
      
      // Alternative: use a sequential encoding
      // ok[i] = true iff considering bits i..n-1 (MSB down), bits >= minLevelBinary
      // ok[n-1] = (bits[n-1] >= minLevelBinary[n-1])
      //         = (bits[n-1] OR NOT minLevelBinary[n-1])
      // ok[i] = (bits[i] > minLevelBinary[i]) OR (bits[i] == minLevelBinary[i] AND ok[i+1])
      
      const okVars: number[] = [];
      for (let i = 0; i < reachNumBits; i++) {
        okVars.push(builder.createNamedVariable(`reach_geq_${cell.row},${cell.col}_${i}`));
      }
      
      // Start from MSB (index reachNumBits - 1)
      for (let i = reachNumBits - 1; i >= 0; i--) {
        const bit = bits[i];
        const minBit = minLevelBinary[i];
        
        if (i === reachNumBits - 1) {
          // ok[MSB]: bits[MSB] >= minLevelBinary[MSB]
          if (minBit) {
            // minBit is 1, so we need bit to be 1
            // ok ↔ bit
            builder.solver.addClause([-okVars[i], bit]);
            builder.solver.addClause([okVars[i], -bit]);
          } else {
            // minBit is 0, so bit >= 0 is always true
            // ok is always true
            builder.addUnit(okVars[i]);
          }
        } else {
          // ok[i] = (bit > minBit) OR (bit == minBit AND ok[i+1])
          // bit > minBit: only possible if minBit=0 and bit=1
          // bit == minBit: (bit AND minBit) OR (NOT bit AND NOT minBit)
          
          if (minBit) {
            // minBit = 1
            // bit > minBit is impossible
            // bit == minBit means bit = 1
            // ok[i] = (bit AND ok[i+1])
            builder.solver.addClause([-okVars[i], bit]);
            builder.solver.addClause([-okVars[i], okVars[i + 1]]);
            builder.solver.addClause([okVars[i], -bit, -okVars[i + 1]]);
          } else {
            // minBit = 0
            // bit > minBit means bit = 1
            // bit == minBit means bit = 0
            // ok[i] = bit OR (NOT bit AND ok[i+1]) = bit OR ok[i+1]
            builder.solver.addClause([-okVars[i], bit, okVars[i + 1]]);
            builder.solver.addClause([okVars[i], -bit]);
            builder.solver.addClause([okVars[i], -okVars[i + 1]]);
          }
        }
      }
      
      // The final constraint: ok[0] must be true (level >= minLevel)
      builder.addUnit(okVars[0]);
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
        // This should not happen with a valid SAT solution, but handles edge cases
        if (!foundColor && activeColors.length > 0) {
          assignedColors[row][col] = activeColors[0];
        }
      }
    }
  }

  return { keptEdges, wallEdges, assignedColors };
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
