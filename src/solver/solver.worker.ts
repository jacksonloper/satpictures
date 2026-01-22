/**
 * Web Worker for running the SAT solver in a background thread
 */

import { solveGridColoring } from "./grid-coloring";
import type { ColorGrid, GridSolution, GridType } from "./grid-coloring";

export type SolverType = "minisat" | "cadical";

export interface SolverRequest {
  grid: ColorGrid;
  numColors: number;
  minWallsProportion?: number;
  gridType?: GridType;
  reachabilityK?: number;
}

export interface SolverResponse {
  success: boolean;
  solution: GridSolution | null;
  error?: string;
  solverType: SolverType;
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
  const { grid, numColors, minWallsProportion, gridType, reachabilityK } = event.data;

  try {
    const solution = solveGridColoring(grid, numColors, { minWallsProportion, gridType, reachabilityK });
    const response: SolverResponse = {
      success: true,
      solution,
      solverType: "minisat",
    };
    self.postMessage(response);
  } catch (error) {
    const response: SolverResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      solverType: "minisat",
    };
    self.postMessage(response);
  }
};
