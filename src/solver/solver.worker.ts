/**
 * Web Worker for running the SAT solver in a background thread
 */

import { solveGridColoringWithSolver } from "./grid-coloring";
import type { ColorGrid, GridSolution, SolverType } from "./grid-coloring";

export interface SolverRequest {
  grid: ColorGrid;
  numColors: number;
  solverType?: SolverType;
}

export interface SolverResponse {
  success: boolean;
  solution: GridSolution | null;
  error?: string;
  solveTimeMs?: number;
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
  const { grid, numColors, solverType = "minisat" } = event.data;

  try {
    const startTime = performance.now();
    const solution = solveGridColoringWithSolver(grid, solverType, numColors);
    const endTime = performance.now();
    const solveTimeMs = endTime - startTime;
    
    const response: SolverResponse = {
      success: true,
      solution,
      solveTimeMs,
    };
    self.postMessage(response);
  } catch (error) {
    const response: SolverResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
    };
    self.postMessage(response);
  }
};
