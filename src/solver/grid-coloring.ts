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
 * The base red color that RED_DOT_COLOR and RED_HATCH_COLOR are treated as for connectivity purposes.
 * These special colors are just markers/constraints - in the solution output they become RED_BASE_COLOR.
 */
export const RED_BASE_COLOR = 0;

/**
 * Get the effective color for connectivity and disconnection purposes.
 * RED_DOT_COLOR and RED_HATCH_COLOR are treated as RED_BASE_COLOR (0) for coloring,
 * they just add extra constraints.
 */
function getEffectiveColor(color: number): number {
  if (color === RED_DOT_COLOR || color === RED_HATCH_COLOR) {
    return RED_BASE_COLOR;
  }
  return color;
}

/**
 * Grid type - square, hex, octagon, or cairo
 */
export type GridType = "square" | "hex" | "octagon" | "cairo";

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
  reachabilityLevels?: number[][] | null; // Optional: distance from RED_DOT_COLOR origin (null if not computed)
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
 * Get the Cairo pentagon type (0-3) based on position.
 * The four types correspond to four rotations of the pentagon.
 * Type is determined by (row % 2, col % 2):
 *   Type 0: (0, 0) - even row, even col
 *   Type 1: (0, 1) - even row, odd col  
 *   Type 2: (1, 0) - odd row, even col
 *   Type 3: (1, 1) - odd row, odd col
 */
export function getCairoType(row: number, col: number): number {
  // Type is based on parity (row % 2, 1 - col % 2) to ensure:
  // - centroid_x(0,0) < centroid_x(1,0)
  // - centroid_x(0,1) < centroid_x(1,1)
  // This flips the col parity so even columns are to the left of odd columns
  // parity_rot = {(0,0): 0°, (1,0): 90°, (0,1): -90°, (1,1): 180°}
  const a = row % 2;
  const b = 1 - (col % 2);
  return a * 2 + b;
}

/**
 * Get the 5-neighbors of a point for Cairo pentagon grid within bounds.
 * 
 * Cairo pentagons have 5 neighbors each. The neighbors depend on the type (rotation)
 * of the pentagon, which is determined by (row % 2, 1 - col % 2).
 * 
 * The adjacency pattern is derived from the actual Cairo tiling geometry where
 * pentagons are arranged in 2x2 groups sharing a common hub vertex.
 * 
 * Type mapping: type = (row % 2) * 2 + (1 - col % 2)
 *   Type 0 (row%2=0, col%2=1): neighbors at 4 cardinal + NW
 *   Type 1 (row%2=0, col%2=0): neighbors at 4 cardinal + SW  
 *   Type 2 (row%2=1, col%2=1): neighbors at 4 cardinal + NE
 *   Type 3 (row%2=1, col%2=0): neighbors at 4 cardinal + SE
 */
function getCairoNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  const type = getCairoType(p.row, p.col);
  
  // Deltas as [row_delta, col_delta] for each type
  // Derived from the actual Cairo tiling geometry
  // type = (row % 2) * 2 + (1 - col % 2)
  const deltas: { [key: number]: [number, number][] } = {
    0: [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, 0]],  // row%2=0, col%2=1
    1: [[-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]],   // row%2=0, col%2=0
    2: [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]],   // row%2=1, col%2=1
    3: [[-1, 0], [0, -1], [0, 1], [1, 0], [1, 1]],    // row%2=1, col%2=0
  };
  
  for (const [dr, dc] of deltas[type]) {
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
  if (gridType === "cairo") {
    return getCairoNeighbors(p, width, height);
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

  return { keptEdges, wallEdges, assignedColors, reachabilityLevels: null };
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
  // CAIRO GRID: Not yet supported by solver
  // ============================================
  // Cairo tiling has complex adjacency rules that the solver doesn't handle yet.
  // Return null to indicate unsatisfiable/unsupported.
  if (gridType === "cairo") {
    return null;
  }

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
  // RED_DOT_COLOR and RED_HATCH_COLOR are treated as RED_BASE_COLOR for this purpose.
  const usedColors = new Set<number>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = colors[row][col];
      if (c !== null) {
        // Use effective color - RED_DOT_COLOR and RED_HATCH_COLOR → RED_BASE_COLOR
        usedColors.add(getEffectiveColor(c));
      }
    }
  }
  // Convert to sorted array for consistent ordering
  // This will NOT include RED_DOT_COLOR or RED_HATCH_COLOR as separate colors
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
  // Note: Blank cells can only be assigned regular colors (not RED_DOT_COLOR or RED_HATCH_COLOR)
  const colorVars = new Map<string, number>(); // Maps colorVarKey to variable number

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (colors[row][col] === null) {
        // Blank cell - create variables only for active colors (which are all regular colors)
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
  // Note: Returns EFFECTIVE colors (RED_DOT_COLOR and RED_HATCH_COLOR → RED_BASE_COLOR)
  function getCellColorInfo(
    row: number,
    col: number
  ): { color: number; var: number | null }[] {
    const fixedColor = colors[row][col];
    if (fixedColor !== null) {
      // Return the effective color for connectivity purposes
      return [{ color: getEffectiveColor(fixedColor), var: null }];
    }
    // Blank cell - return only active color options with their variables
    const result: { color: number; var: number | null }[] = [];
    for (const c of activeColors) {
      const v = colorVars.get(colorVarKey(row, col, c))!;
      // Use effective color for comparison
      result.push({ color: getEffectiveColor(c), var: v });
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
  // Exception: cells that are isolated (all neighbors are fixed to different colors) 
  // don't need any edges - they form valid singleton regions
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
        // Check if this cell could possibly have a same-color neighbor
        // A cell is "potentially connected" if:
        // - It's blank (could be any color, so can match any neighbor)
        // - OR it has at least one neighbor that is blank or same color
        const cellColor = colors[row][col];
        const effectiveCellColor = cellColor !== null ? getEffectiveColor(cellColor) : null;
        
        let hasPotentialSameColorNeighbor = effectiveCellColor === null; // blank cells can match any neighbor
        if (!hasPotentialSameColorNeighbor && effectiveCellColor !== null) {
          // Fixed cell - check if any neighbor could be the same color
          for (const n of neighbors) {
            const neighborColor = colors[n.row][n.col];
            const effectiveNeighborColor = neighborColor !== null ? getEffectiveColor(neighborColor) : null;
            if (effectiveNeighborColor === null || effectiveNeighborColor === effectiveCellColor) {
              // Neighbor is blank (could match) or has same color
              hasPotentialSameColorNeighbor = true;
              break;
            }
          }
        }
        
        // Only require at least 1 edge if the cell could have a same-color neighbor
        // Isolated singleton cells (all neighbors are different fixed colors) don't need edges
        if (hasPotentialSameColorNeighbor) {
          // At least 1 edge: OR of all incident edges
          builder.addOr(incidentEdges);
        }

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
  // NOTE: RED_DOT_COLOR and RED_HATCH_COLOR cells participate in RED_BASE_COLOR's connectivity

  for (const color of activeColors) {
    // Skip hatch color - it doesn't need to form a connected component
    if (color === HATCH_COLOR) {
      continue;
    }

    // Find all vertices that could have this color (fixed to this color OR blank)
    // For RED_BASE_COLOR, also include RED_DOT_COLOR and RED_HATCH_COLOR cells
    const potentialVertices: GridPoint[] = [];
    const fixedVertices: GridPoint[] = [];

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const cellColor = colors[row][col];
        const effectiveColor = cellColor !== null ? getEffectiveColor(cellColor) : null;
        
        if (effectiveColor === color) {
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
      const effectiveColor = cellColor !== null ? getEffectiveColor(cellColor) : null;
      if (effectiveColor === color) {
        return null; // Fixed to this color (or effective color) - always member
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
  // Find all cells that have RED_DOT_COLOR as input (these are fixed, not assignable to blank cells)
  // Since RED_DOT_COLOR is not in activeColors, blank cells cannot be assigned this marker
  const redDotCells: GridPoint[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (colors[row][col] === RED_DOT_COLOR) {
        redDotCells.push({ row, col });
      }
    }
  }

  // If there are multiple RED_DOT_COLOR cells, it's unsatisfiable (at most one allowed)
  if (redDotCells.length > 1) {
    return null;
  }

  // ============================================
  // 4. BOUNDED REACHABILITY CONSTRAINT
  // ============================================
  // RED_HATCH_COLOR cells must have reachability > K from RED_DOT_COLOR origin
  // This is computed over all edges (any color can participate in the reachability path)
  //
  // We use the standard bounded-reachability SAT encoding:
  //   R[i][v] = "v is reachable from origin using kept edges in at most i steps"
  //
  // Constraints:
  //   Base: R[0][origin] = true, R[0][other] = false
  //   Step: R[i][v] ↔ R[i-1][v] OR ⋁_{u neighbor of v} (R[i-1][u] ∧ edge(u,v))
  //   Forbidden: For each RED_HATCH cell h: ¬R[K][h] (not reachable in ≤ K steps)
  //
  // This correctly enforces that the shortest-path distance from origin to h is > K.
  
  const reachabilityK = options?.reachabilityK ?? 0;
  
  // Find all RED_HATCH_COLOR cells (these are fixed, not assignable to blank cells)
  const redHatchCells: GridPoint[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (colors[row][col] === RED_HATCH_COLOR) {
        redHatchCells.push({ row, col });
      }
    }
  }

  // Only add reachability constraints if we have RED_DOT_COLOR and RED_HATCH_COLOR cells and K > 0
  if (redDotCells.length > 0 && redHatchCells.length > 0 && reachabilityK > 0) {
    const origin = redDotCells[0]; // Guaranteed at most one by earlier check
    
    // R[i][row,col] variables: reachable in at most i steps
    // We only need levels 0 through K (to check if reachable in ≤ K steps)
    const R: Map<string, number>[] = [];
    for (let step = 0; step <= reachabilityK; step++) {
      R.push(new Map<string, number>());
    }
    
    // Create variables for all cells at all steps
    for (let step = 0; step <= reachabilityK; step++) {
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const key = `${row},${col}`;
          const varName = `R_${step}_${row}_${col}`;
          R[step].set(key, builder.createNamedVariable(varName));
        }
      }
    }
    
    // Base case (step 0): only origin is reachable
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const key = `${row},${col}`;
        const r0 = R[0].get(key)!;
        if (row === origin.row && col === origin.col) {
          // R[0][origin] = true
          builder.addUnit(r0);
        } else {
          // R[0][other] = false
          builder.addUnit(-r0);
        }
      }
    }
    
    // Inductive step: R[i][v] ↔ R[i-1][v] OR ⋁_{u neighbor} (R[i-1][u] ∧ edge(u,v))
    // Encoding:
    //   R[i][v] → R[i-1][v] OR ⋁_{u neighbor} (R[i-1][u] ∧ edge(u,v))
    //   (R[i-1][v] OR any neighbor term) → R[i][v]
    for (let step = 1; step <= reachabilityK; step++) {
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const key = `${row},${col}`;
          const rCurr = R[step].get(key)!;
          const rPrev = R[step - 1].get(key)!;
          const neighbors = getNeighbors({ row, col }, width, height, gridType);
          
          // Collect all "reachable through neighbor" terms
          // For each neighbor u: reachThroughU[u] = R[i-1][u] ∧ edge(u,v)
          const reachThroughNeighbor: number[] = [];
          
          for (const n of neighbors) {
            const nKey = `${n.row},${n.col}`;
            const rPrevN = R[step - 1].get(nKey)!;
            const eKey = edgeKey({ row, col }, n);
            const edgeVar = edgeVars.get(eKey);
            if (edgeVar === undefined) continue;
            
            // Create helper variable: reachThrough = R[i-1][n] ∧ edge(n,v)
            const reachThrough = builder.createNamedVariable(
              `reach_through_${step}_${n.row}_${n.col}_to_${row}_${col}`
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
    
    // Constraint: RED_HATCH cells must NOT be reachable in ≤ K steps
    // i.e., ¬R[K][h] for each RED_HATCH cell h
    for (const cell of redHatchCells) {
      const key = `${cell.row},${cell.col}`;
      const rK = R[reachabilityK].get(key)!;
      builder.addUnit(-rK); // NOT reachable in ≤ K steps
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
  // NOTE: RED_DOT_COLOR and RED_HATCH_COLOR are converted to RED_BASE_COLOR in the output
  // These special colors are just input markers for constraints, not actual output colors
  const assignedColors: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0)
  );

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const fixedColor = colors[row][col];
      if (fixedColor !== null) {
        // Convert special marker colors to their effective (base) color
        assignedColors[row][col] = getEffectiveColor(fixedColor);
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

  // Compute reachability levels via BFS from RED_DOT_COLOR origin
  let reachabilityLevels: number[][] | null = null;
  if (redDotCells.length > 0) {
    reachabilityLevels = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => -1) // -1 means unreachable
    );
    
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
    
    // BFS from origin
    const queue: GridPoint[] = [];
    for (const origin of redDotCells) {
      reachabilityLevels[origin.row][origin.col] = 0;
      queue.push(origin);
    }
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLevel = reachabilityLevels[current.row][current.col];
      const neighbors = adjacency.get(`${current.row},${current.col}`)!;
      
      for (const neighbor of neighbors) {
        if (reachabilityLevels[neighbor.row][neighbor.col] === -1) {
          reachabilityLevels[neighbor.row][neighbor.col] = currentLevel + 1;
          queue.push(neighbor);
        }
      }
    }
  }

  return { keptEdges, wallEdges, assignedColors, reachabilityLevels };
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
