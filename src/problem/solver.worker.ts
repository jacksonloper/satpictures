/**
 * Web Worker for running the SAT solver in a background thread
 */

import { solveForestGridColoring } from "./forest-grid-solver";
import type { ColorGrid, GridSolution, GridType, PathlengthConstraint, ColorRoots } from "./graph-types";

export type SolverType = "minisat" | "cadical";

/**
 * Clear request JSON for the SAT solver.
 * Encodes everything the user has specified about the grid coloring problem.
 */
export interface SolverRequest {
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
  /**
   * List of pathlength lower bound constraints.
   * Each constraint specifies a root cell and minimum distances from that root.
   */
  pathlengthConstraints: PathlengthConstraint[];
  /**
   * Map from color index to root cell for that color.
   * Each non-hatch color used in the grid must have exactly one root specified.
   */
  colorRoots: ColorRoots;
  // Legacy fields (kept for compatibility, will be removed)
  grid?: ColorGrid;
  numColors?: number;
}

/**
 * Clear response JSON from the SAT solver.
 * Contains the solution if one was found.
 */
export interface SolverResponse {
  /** Whether the solve operation completed without errors */
  success: boolean;
  /** The grid solution if satisfiable, null if unsatisfiable */
  solution: GridSolution | null;
  /** Error message if success is false */
  error?: string;
  /** Which solver was used */
  solverType: SolverType;
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

self.onmessage = (event: MessageEvent<SolverRequest>) => {
  const { gridType, width, height, colors, pathlengthConstraints, colorRoots, grid: legacyGrid } = event.data;

  // Support both new and legacy request formats
  const grid: ColorGrid = legacyGrid ?? { width, height, colors };

  try {
    const solution = solveForestGridColoring(grid, { 
      gridType, 
      pathlengthConstraints, 
      colorRoots,
      onStatsReady: (stats) => {
        // Send progress message with stats before solving
        const progressResponse: SolverResponse = {
          success: true,
          solution: null,
          solverType: "minisat",
          messageType: "progress",
          stats,
        };
        self.postMessage(progressResponse);
      },
    });
    const response: SolverResponse = {
      success: true,
      solution,
      solverType: "minisat",
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: SolverResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      solverType: "minisat",
      messageType: "result",
    };
    self.postMessage(response);
  }
};
