/**
 * Web Worker for running the tiling SAT solver in a background thread
 */

import { solveTiling, colorGridToTile, normalizeTile } from "./tiling-solver";
import type { TilingSolution, TilePoint } from "./tiling-sat";
import type { GridType } from "./graph-types";

/**
 * Request JSON for the tiling SAT solver.
 */
export interface TilingSolverRequest {
  /** Grid type (square or hex) */
  gridType: GridType;
  /** Tile definition: colors array where non-null cells form the tile */
  tileColors: (number | null)[][];
  /** Tile width */
  tileWidth: number;
  /** Tile height */
  tileHeight: number;
  /** Target grid width */
  targetWidth: number;
  /** Target grid height */
  targetHeight: number;
}

/**
 * Response JSON from the tiling SAT solver.
 */
export interface TilingSolverResponse {
  /** Whether the solve operation completed without errors */
  success: boolean;
  /** The tiling solution if satisfiable, null if unsatisfiable */
  solution: TilingSolution | null;
  /** Error message if success is false */
  error?: string;
  /** Type of message: 'progress' for stats before solving, 'result' for final result */
  messageType?: "progress" | "result";
  /** SAT problem stats (sent in progress message before solving) */
  stats?: { numVars: number; numClauses: number };
}

/**
 * Detect if an error is a memory-related error
 */
function formatErrorMessage(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (
    errorMessage.includes("Cannot enlarge memory arrays") ||
    errorMessage.includes("TOTAL_MEMORY") ||
    errorMessage.includes("Out of memory") ||
    errorMessage.includes("abort()")
  ) {
    return "Out of memory - the tiling problem is too complex. Try a smaller tile or target grid.";
  }
  
  return errorMessage;
}

self.onmessage = (event: MessageEvent<TilingSolverRequest>) => {
  const { gridType, tileColors, tileWidth, tileHeight, targetWidth, targetHeight } = event.data;

  try {
    // Convert colors to tile points
    const tile: TilePoint[] = colorGridToTile(tileColors, tileWidth, tileHeight);
    const normalizedTile = normalizeTile(tile);

    if (normalizedTile.length === 0) {
      const response: TilingSolverResponse = {
        success: false,
        solution: null,
        error: "Tile must have at least one cell selected",
        messageType: "result",
      };
      self.postMessage(response);
      return;
    }

    const solution = solveTiling(
      normalizedTile,
      targetWidth,
      targetHeight,
      gridType,
      {
        onStatsReady: (stats) => {
          const progressResponse: TilingSolverResponse = {
            success: true,
            solution: null,
            messageType: "progress",
            stats,
          };
          self.postMessage(progressResponse);
        },
      }
    );

    const response: TilingSolverResponse = {
      success: true,
      solution,
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: TilingSolverResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      messageType: "result",
    };
    self.postMessage(response);
  }
};
