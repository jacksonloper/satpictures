/**
 * Web Worker for running the Connectivity SAT solver in a background thread
 *
 * This worker uses the connectivity encoding (arborescence-style) for SAT solving.
 * It's used by the simplified connectivity page where only colors are edited.
 */

import { solveConnectivityGridColoring } from "./connectivity-grid-solver";
import type { ColorGrid, GridSolution, GridType } from "./graph-types";

export type ConnectivitySolverType = "minisat" | "cadical" | "dpll";

/**
 * Clear request JSON for the connectivity SAT solver.
 * Simplified compared to the main solver - no roots or distance constraints.
 */
export interface ConnectivitySolverRequest {
  /** Grid type determines neighbor relationships */
  gridType: GridType;
  /** Grid width (number of columns) */
  width: number;
  /** Grid height (number of rows) */
  height: number;
  /**
   * Cell colors as 2D array [row][col].
   * - Positive integers (0, 1, 2, ...) represent fixed colors
   * - null represents blank cells (solver decides the color)
   * - Special color -2 (HATCH_COLOR) means "doesn't need to be connected"
   */
  colors: (number | null)[][];
  /** Whether to reduce to tree using Kruskal (optional) */
  reduceToTree?: boolean;
  // Legacy fields
  grid?: ColorGrid;
}

/**
 * Clear response JSON from the connectivity SAT solver.
 */
export interface ConnectivitySolverResponse {
  /** Whether the solve operation completed without errors */
  success: boolean;
  /** The grid solution if satisfiable, null if unsatisfiable */
  solution: GridSolution | null;
  /** Error message if success is false */
  error?: string;
  /** Which solver was used */
  solverType: ConnectivitySolverType;
  /** Type of message: 'progress' for stats before solving, 'result' for final result */
  messageType?: "progress" | "result";
  /** SAT problem stats (sent in progress message before solving) */
  stats?: { numVars: number; numClauses: number };
}

/**
 * Detect if an error is a memory-related error and provide a user-friendly message
 */
function formatErrorMessage(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Detect MiniSat memory errors
  if (
    errorMessage.includes("Cannot enlarge memory arrays") ||
    errorMessage.includes("TOTAL_MEMORY") ||
    errorMessage.includes("Out of memory") ||
    errorMessage.includes("abort()")
  ) {
    return "Out of memory - the grid is too complex to solve. Try using fewer colors or a smaller grid.";
  }

  return errorMessage;
}

self.onmessage = (event: MessageEvent<ConnectivitySolverRequest>) => {
  const {
    gridType,
    width,
    height,
    colors,
    reduceToTree,
    grid: legacyGrid,
  } = event.data;

  // Support both new and legacy request formats
  const grid: ColorGrid = legacyGrid ?? { width, height, colors };

  try {
    const solution = solveConnectivityGridColoring(grid, {
      gridType,
      reduceToTree,
      onStatsReady: (stats) => {
        // Send progress message with stats before solving
        const progressResponse: ConnectivitySolverResponse = {
          success: true,
          solution: null,
          solverType: "minisat",
          messageType: "progress",
          stats,
        };
        self.postMessage(progressResponse);
      },
    });
    const response: ConnectivitySolverResponse = {
      success: true,
      solution,
      solverType: "minisat",
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: ConnectivitySolverResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      solverType: "minisat",
      messageType: "result",
    };
    self.postMessage(response);
  }
};
