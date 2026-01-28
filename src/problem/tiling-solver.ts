/**
 * Tiling Grid Solver
 *
 * This module bridges the tile-based UI with the tiling SAT encoding.
 * It converts tile data to the format expected by buildTilingSatCNF,
 * solves the CNF using the provided SAT solver, and converts the solution
 * back to a usable format for visualization.
 */

import type { GridType } from "./graph-types";
import { buildTilingSatCNF, extractTilingSolution } from "./tiling-sat";
import type { TilePoint, TilingSolution } from "./tiling-sat";
import type { SATSolver, SolveResult } from "../solvers";
import { MiniSatSolver } from "../solvers";

/**
 * Options for the tiling solver
 */
export interface TilingSolveOptions {
  /** Custom SAT solver instance (defaults to MiniSat) */
  solver?: SATSolver;
  /** Callback to report stats before solving */
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void;
}

/**
 * Convert a color grid to a tile (list of selected cells)
 * A cell is part of the tile if it's not null
 */
export function colorGridToTile(
  colors: (number | null)[][],
  width: number,
  height: number
): TilePoint[] {
  const tile: TilePoint[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (colors[row]?.[col] !== null && colors[row]?.[col] !== undefined) {
        tile.push({ row, col });
      }
    }
  }
  return tile;
}

/**
 * Normalize a tile so its minimum row and column are 0
 */
export function normalizeTile(tile: TilePoint[]): TilePoint[] {
  if (tile.length === 0) return [];
  const minRow = Math.min(...tile.map((p) => p.row));
  const minCol = Math.min(...tile.map((p) => p.col));
  return tile.map((p) => ({
    row: p.row - minRow,
    col: p.col - minCol,
  }));
}

/**
 * Solve the tiling problem.
 *
 * @param tile The tile shape: list of relative (row, col) coordinates
 * @param targetWidth Target grid width
 * @param targetHeight Target grid height
 * @param gridType Grid type (square or hex)
 * @param options Optional solver configuration
 * @returns The tiling solution or null if unsatisfiable
 */
export function solveTiling(
  tile: TilePoint[],
  targetWidth: number,
  targetHeight: number,
  gridType: GridType,
  options?: TilingSolveOptions
): TilingSolution | null {
  // Normalize the tile
  const normalizedTile = normalizeTile(tile);

  if (normalizedTile.length === 0) {
    throw new Error("Tile must have at least one cell");
  }

  // Build the CNF
  const cnfResult = buildTilingSatCNF({
    tile: normalizedTile,
    targetWidth,
    targetHeight,
    gridType,
  });

  // Report stats before solving
  if (options?.onStatsReady) {
    options.onStatsReady({
      numVars: cnfResult.numVars,
      numClauses: cnfResult.clauses.length,
    });
  }

  // Use provided solver or create a new MiniSat solver
  const solver = options?.solver ?? new MiniSatSolver();

  // Create all variables
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

  // Extract and return the solution
  return extractTilingSolution(cnfResult, result.assignment);
}
