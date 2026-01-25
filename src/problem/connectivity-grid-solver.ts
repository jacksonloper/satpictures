/**
 * Connectivity Grid Solver
 *
 * This module bridges the grid-based UI with the connectivity SAT encoding.
 * It converts grid data to the format expected by buildConnectivitySatCNF,
 * solves the CNF using the provided SAT solver, and converts the solution
 * back to the GridSolution format.
 *
 * Key differences from forest-grid-solver:
 * - No distance/root constraints from user
 * - Roots are automatically chosen (lexicographically smallest fixed vertex)
 * - Focuses on connectivity only
 */

import type {
  ColorGrid,
  Edge,
  GridPoint,
  GridSolution,
  GridType,
} from "./graph-types";
import { HATCH_COLOR } from "./graph-types";
import { edgeKey, getNeighbors } from "./grid-neighbors";
import { buildConnectivitySatCNF } from "./connectivity-sat";
import type { SATSolver, SolveResult } from "../solvers";
import { MiniSatSolver } from "../solvers";

/**
 * Options for the connectivity grid solver
 */
export interface ConnectivitySolveOptions {
  /** Custom SAT solver instance (defaults to MiniSat) */
  solver?: SATSolver;
  /** Grid type: square (4-neighbors) or hex (6-neighbors) */
  gridType?: GridType;
  /** Whether to reduce to tree using Kruskal (optional, default false) */
  reduceToTree?: boolean;
  /** Callback to report stats before solving (e.g., for progress messages) */
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void;
}

/**
 * Convert a grid point to a string key
 */
function pointKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Solve the grid coloring problem using the connectivity SAT encoding.
 *
 * This function enforces that each color forms a connected component,
 * using an arborescence-style encoding for excellent SAT solver propagation.
 *
 * Key constraints:
 * - Each vertex has exactly one color
 * - Kept edges are monochromatic
 * - Each color class is connected (via tree rooted at auto-selected vertex)
 *
 * @param grid The grid with colors assigned to cells (null = blank, solver decides)
 * @param options Optional solver configuration
 * @returns The grid solution or null if unsatisfiable
 */
export function solveConnectivityGridColoring(
  grid: ColorGrid,
  options?: ConnectivitySolveOptions
): GridSolution | null {
  const { width, height, colors } = grid;
  const gridType = options?.gridType ?? "square";
  const reduceToTree = options?.reduceToTree ?? false;

  // Validation: At least one color must be selected
  const isAllBlank = colors.every((row) => row.every((c) => c === null));
  if (isAllBlank) {
    throw new Error("At least one color must be selected");
  }

  // Track which cells are hatch cells - these are completely removed from the graph
  const isHatchCell = (row: number, col: number): boolean => {
    return colors[row][col] === HATCH_COLOR;
  };

  // Build nodes list - exclude hatch cells entirely
  const nodes: string[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!isHatchCell(row, col)) {
        nodes.push(pointKey(row, col));
      }
    }
  }

  // Build edges list - exclude any edge involving a hatch cell
  const edges: [string, string][] = [];
  const addedEdges = new Set<string>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Skip hatch cells as source
      if (isHatchCell(row, col)) continue;

      const u: GridPoint = { row, col };
      const neighbors = getNeighbors(u, width, height, gridType);
      for (const v of neighbors) {
        // Skip edges to hatch cells
        if (isHatchCell(v.row, v.col)) continue;

        const key = edgeKey(u, v);
        if (!addedEdges.has(key)) {
          addedEdges.add(key);
          edges.push([pointKey(u.row, u.col), pointKey(v.row, v.col)]);
        }
      }
    }
  }

  // Determine which colors are used (have at least one fixed cell, excluding hatch)
  const usedColors = new Set<number>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = colors[row][col];
      if (c !== null && c !== HATCH_COLOR) {
        usedColors.add(c);
      }
    }
  }

  if (usedColors.size === 0) {
    throw new Error("No colors to solve for");
  }

  // Build nodeColorHint map - only for non-hatch cells
  // For fixed cells: hint = the fixed color
  // For blank cells: hint = -1 (any color)
  const nodeColorHint: Record<string, number> = {};
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Skip hatch cells - they're not in the graph
      if (isHatchCell(row, col)) continue;

      const cellColor = colors[row][col];
      const key = pointKey(row, col);
      if (cellColor === null) {
        nodeColorHint[key] = -1; // any color
      } else {
        nodeColorHint[key] = cellColor;
      }
    }
  }

  // Build the CNF
  const cnfResult = buildConnectivitySatCNF({
    nodes,
    edges,
    nodeColorHint,
    reduceToTree,
  });

  // Report stats before solving (for progress messages)
  if (options?.onStatsReady) {
    options.onStatsReady({
      numVars: cnfResult.numVars,
      numClauses: cnfResult.clauses.length,
    });
  }

  // Use provided solver or create a new MiniSat solver
  const solver = options?.solver ?? new MiniSatSolver();

  // Add all clauses to the solver
  // First, we need to create all variables
  for (let i = 1; i <= cnfResult.numVars; i++) {
    solver.newVariable();
  }

  // Add all clauses
  for (const clause of cnfResult.clauses) {
    solver.addClause(clause);
  }

  // Solve
  const result: SolveResult = solver.solve();

  if (!result.satisfiable) {
    return null;
  }

  // Extract solution
  const { varOf, meta } = cnfResult;
  const { colors: activeColors } = meta;

  // Extract assigned colors from the solution
  const assignedColors: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0)
  );

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const key = pointKey(row, col);
      const fixedColor = colors[row][col];

      if (fixedColor !== null && fixedColor !== HATCH_COLOR) {
        // Fixed non-hatch color - use it directly
        assignedColors[row][col] = fixedColor;
      } else if (fixedColor === HATCH_COLOR) {
        // Hatch color - keep it
        assignedColors[row][col] = HATCH_COLOR;
      } else {
        // Blank cell - find which color variable is true
        let foundColor = false;
        for (const c of activeColors) {
          const colVarName = `X(${key})=${c}`;
          const varId = varOf.get(colVarName);
          if (varId !== undefined && result.assignment.get(varId)) {
            assignedColors[row][col] = c;
            foundColor = true;
            break;
          }
        }
        // Fallback: if SAT solver didn't explicitly set a color (can happen with
        // don't-care variables), use the first active color as a default
        if (!foundColor && activeColors.length > 0) {
          assignedColors[row][col] = activeColors[0];
        }
      }
    }
  }

  // Extract kept edges from the solution (only edges between non-hatch cells)
  let keptEdges: Edge[] = [];
  const wallEdges: Edge[] = [];

  // If reduceToTree is enabled, we only keep edges with directed flow
  // Otherwise, we keep all edges marked as kept by the SAT solver
  if (reduceToTree) {
    // For tree mode: only keep edges where there is directed flow (F(u->v,>=1) or F(v->u,>=1))
    // This creates a spanning tree structure
    for (const [uKey, vKey] of meta.edges) {
      const [uRow, uCol] = uKey.split(",").map(Number);
      const [vRow, vCol] = vKey.split(",").map(Number);
      const u: GridPoint = { row: uRow, col: uCol };
      const v: GridPoint = { row: vRow, col: vCol };

      // Check if there is flow on this edge (in either direction)
      // Flow variables: F(u->v,>=1) and F(v->u,>=1)
      const flowUV = `F(${uKey}->${vKey},>=1)`;
      const flowVU = `F(${vKey}->${uKey},>=1)`;
      const flowUVId = varOf.get(flowUV);
      const flowVUId = varOf.get(flowVU);
      
      const hasFlowUV = flowUVId !== undefined && result.assignment.get(flowUVId);
      const hasFlowVU = flowVUId !== undefined && result.assignment.get(flowVUId);

      if (hasFlowUV || hasFlowVU) {
        keptEdges.push({ u, v });
      } else {
        wallEdges.push({ u, v });
      }
    }
  } else {
    // Normal mode: keep all edges marked as kept
    for (const [uKey, vKey] of meta.edges) {
      const [uRow, uCol] = uKey.split(",").map(Number);
      const [vRow, vCol] = vKey.split(",").map(Number);
      const u: GridPoint = { row: uRow, col: uCol };
      const v: GridPoint = { row: vRow, col: vCol };

      // Check the keep variable
      const keepKey = uKey < vKey ? `${uKey}--${vKey}` : `${vKey}--${uKey}`;
      const keepVarName = `Y(${keepKey})`;
      const keepVarId = varOf.get(keepVarName);

      if (keepVarId !== undefined && result.assignment.get(keepVarId)) {
        keptEdges.push({ u, v });
      } else {
        wallEdges.push({ u, v });
      }
    }
  }

  // Add walls between hatch cells and non-hatch cells
  // These edges weren't in the SAT problem but should be displayed as walls
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const u: GridPoint = { row, col };
      const uIsHatch = isHatchCell(row, col);
      const neighbors = getNeighbors(u, width, height, gridType);

      for (const v of neighbors) {
        const vIsHatch = isHatchCell(v.row, v.col);

        // Add wall if exactly one of the cells is hatch
        // Only add once (when u < v to avoid duplicates)
        if (uIsHatch !== vIsHatch) {
          const uKey = pointKey(row, col);
          const vKey = pointKey(v.row, v.col);
          if (uKey < vKey) {
            wallEdges.push({ u, v });
          }
        }
      }
    }
  }

  // Compute distance levels via BFS from each auto-selected root
  // This shows distance from each color's tree root in the solution viewer
  let distanceLevels: Record<string, number[][]> | null = null;
  const colorRootsList: { colorKey: string; root: GridPoint }[] = [];

  // Get roots from meta.rootOfColor (auto-selected roots)
  for (const [colorStr, rootKey] of Object.entries(meta.rootOfColor)) {
    const [rootRow, rootCol] = rootKey.split(",").map(Number);
    colorRootsList.push({ 
      colorKey: `color_${colorStr}`, 
      root: { row: rootRow, col: rootCol } 
    });
  }

  if (colorRootsList.length > 0) {
    distanceLevels = {};

    // Build adjacency from kept edges
    const adjacency = new Map<string, GridPoint[]>();
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        adjacency.set(pointKey(row, col), []);
      }
    }
    for (const edge of keptEdges) {
      const uKey = pointKey(edge.u.row, edge.u.col);
      const vKey = pointKey(edge.v.row, edge.v.col);
      adjacency.get(uKey)!.push(edge.v);
      adjacency.get(vKey)!.push(edge.u);
    }

    // BFS from each color root
    for (const { colorKey, root } of colorRootsList) {
      const levels = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => -1)
      );

      levels[root.row][root.col] = 0;
      const queue: GridPoint[] = [root];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentLevel = levels[current.row][current.col];
        const neighbors = adjacency.get(pointKey(current.row, current.col))!;

        for (const neighbor of neighbors) {
          if (levels[neighbor.row][neighbor.col] === -1) {
            levels[neighbor.row][neighbor.col] = currentLevel + 1;
            queue.push(neighbor);
          }
        }
      }

      distanceLevels[colorKey] = levels;
    }
  }

  return {
    keptEdges,
    wallEdges,
    assignedColors,
    distanceLevels,
    stats: {
      numVars: cnfResult.numVars,
      numClauses: cnfResult.clauses.length,
    },
  };
}
