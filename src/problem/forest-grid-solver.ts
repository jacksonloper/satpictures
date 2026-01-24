/**
 * Forest Grid Solver
 *
 * This module bridges the grid-based UI with the colored forest SAT encoding.
 * It converts grid data to the format expected by buildColoredForestSatCNF,
 * solves the CNF using the provided SAT solver, and converts the solution
 * back to the GridSolution format.
 */

import type { ColorGrid, Edge, GridPoint, GridSolution, GridType, PathlengthConstraint } from "./graph-types";
import { HATCH_COLOR } from "./graph-types";
import { edgeKey, getNeighbors } from "./grid-neighbors";
import { buildColoredForestSatCNF } from "./colored-forest-sat";
import type { SATSolver, SolveResult } from "../solvers";
import { MiniSatSolver } from "../solvers";

/**
 * Options for the forest grid solver
 */
export interface ForestSolveOptions {
  /** Custom SAT solver instance (defaults to MiniSat) */
  solver?: SATSolver;
  /** Grid type: square (4-neighbors) or hex (6-neighbors) */
  gridType?: GridType;
  /** List of pathlength lower bound constraints */
  pathlengthConstraints?: PathlengthConstraint[];
}

/**
 * Convert a grid point to a string key
 */
function pointKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Solve the grid coloring problem using the colored forest SAT encoding.
 *
 * This function enforces that each color forms a tree (not just connected component),
 * with anti-parallel-parent constraints and global distance caps to eliminate artifacts.
 *
 * @param grid The grid with colors assigned to cells (null = blank, solver decides)
 * @param options Optional solver configuration
 * @returns The grid solution or null if unsatisfiable
 */
export function solveForestGridColoring(
  grid: ColorGrid,
  options?: ForestSolveOptions
): GridSolution | null {
  const { width, height, colors } = grid;
  const gridType = options?.gridType ?? "square";
  const pathlengthConstraints = options?.pathlengthConstraints ?? [];

  // Validation: At least one color must be selected
  const isAllBlank = colors.every((row) => row.every((c) => c === null));
  if (isAllBlank) {
    throw new Error("At least one color must be selected");
  }

  // Build nodes list (all grid cells)
  const nodes: string[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      nodes.push(pointKey(row, col));
    }
  }

  // Build edges list (based on grid type neighbors)
  const edges: [string, string][] = [];
  const addedEdges = new Set<string>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const u: GridPoint = { row, col };
      const neighbors = getNeighbors(u, width, height, gridType);
      for (const v of neighbors) {
        const key = edgeKey(u, v);
        if (!addedEdges.has(key)) {
          addedEdges.add(key);
          edges.push([pointKey(u.row, u.col), pointKey(v.row, v.col)]);
        }
      }
    }
  }

  // Determine which colors are used (have at least one fixed cell)
  const usedColors = new Set<number>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = colors[row][col];
      if (c !== null && c !== HATCH_COLOR) {
        usedColors.add(c);
      }
    }
  }

  // Build nodeColorHint map
  // For fixed cells: hint = the fixed color
  // For blank cells: hint = -1 (any color)
  const nodeColorHint: Record<string, number> = {};
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cellColor = colors[row][col];
      const key = pointKey(row, col);
      if (cellColor === null) {
        nodeColorHint[key] = -1; // any color
      } else if (cellColor === HATCH_COLOR) {
        // Hatch cells don't participate in tree structure and aren't assigned a forest color.
        // We exclude them from the forest encoding by not adding a color hint.
        // They will keep their HATCH_COLOR in the output.
      } else {
        nodeColorHint[key] = cellColor;
      }
    }
  }

  // Build rootOfColor map
  // For each color, find the lexicographically smallest fixed cell as the root
  const rootOfColor: Record<string, string> = {};
  for (const color of usedColors) {
    let minRoot: GridPoint | null = null;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (colors[row][col] === color) {
          if (minRoot === null || row < minRoot.row || (row === minRoot.row && col < minRoot.col)) {
            minRoot = { row, col };
          }
        }
      }
    }
    if (minRoot) {
      rootOfColor[String(color)] = pointKey(minRoot.row, minRoot.col);
    }
  }

  // If no colors have roots, we can't build the encoding
  if (Object.keys(rootOfColor).length === 0) {
    return null;
  }

  // Build distLowerBounds from pathlength constraints
  const distLowerBounds: [string, number][] = [];
  for (const constraint of pathlengthConstraints) {
    if (!constraint.root) continue;
    
    // For each cell with a min distance requirement, add a lower bound
    for (const [cellKey, minDist] of Object.entries(constraint.minDistances)) {
      if (minDist > 0) {
        distLowerBounds.push([cellKey, minDist]);
      }
    }
  }

  // Build the CNF
  const cnfResult = buildColoredForestSatCNF({
    nodes,
    edges,
    nodeColorHint,
    rootOfColor,
    distLowerBounds,
  });

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
          const colVarName = `col(${key})=${c}`;
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

  // Extract kept edges from the solution
  const keptEdges: Edge[] = [];
  const wallEdges: Edge[] = [];

  for (const [uKey, vKey] of meta.edges) {
    const [uRow, uCol] = uKey.split(",").map(Number);
    const [vRow, vCol] = vKey.split(",").map(Number);
    const u: GridPoint = { row: uRow, col: uCol };
    const v: GridPoint = { row: vRow, col: vCol };

    // Check the keep variable
    const keepKey = uKey < vKey ? `${uKey}--${vKey}` : `${vKey}--${uKey}`;
    const keepVarName = `keep(${keepKey})`;
    const keepVarId = varOf.get(keepVarName);

    if (keepVarId !== undefined && result.assignment.get(keepVarId)) {
      keptEdges.push({ u, v });
    } else {
      wallEdges.push({ u, v });
    }
  }

  // Compute distance levels via BFS from each constraint root
  let distanceLevels: Record<string, number[][]> | null = null;
  const constraintRoots: { constraintId: string; root: GridPoint }[] = [];

  for (const constraint of pathlengthConstraints) {
    if (constraint.root) {
      constraintRoots.push({ constraintId: constraint.id, root: constraint.root });
    }
  }

  if (constraintRoots.length > 0) {
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

    // BFS from each root
    for (const { constraintId, root } of constraintRoots) {
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

      distanceLevels[constraintId] = levels;
    }
  }

  return { keptEdges, wallEdges, assignedColors, distanceLevels };
}
