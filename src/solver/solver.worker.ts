/**
 * Web Worker for running the SAT solver in a background thread
 */

import { solveGridColoring } from "./grid-coloring";
import type { ColorGrid, GridSolution } from "./grid-coloring";

export interface SolverRequest {
  grid: ColorGrid;
  numColors: number;
}

export interface SolverResponse {
  success: boolean;
  solution: GridSolution | null;
  error?: string;
}

self.onmessage = (event: MessageEvent<SolverRequest>) => {
  const { grid, numColors } = event.data;

  try {
    const solution = solveGridColoring(grid, numColors);
    const response: SolverResponse = {
      success: true,
      solution,
    };
    self.postMessage(response);
  } catch (error) {
    const response: SolverResponse = {
      success: false,
      solution: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    self.postMessage(response);
  }
};
