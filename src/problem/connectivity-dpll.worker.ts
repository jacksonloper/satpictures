/**
 * Web Worker for running the DPLL SAT solver with connectivity encoding
 *
 * This worker uses the classic DPLL algorithm (1962) for SAT solving
 * with the connectivity encoding (arborescence-style).
 */

import { solveConnectivityGridColoring } from "./connectivity-grid-solver";
import type { ColorGrid, GridSolution, GridType } from "./graph-types";
import { DPLLSolver } from "../solvers";

export interface ConnectivityDPLLRequest {
  gridType: GridType;
  width: number;
  height: number;
  colors: (number | null)[][];
  reduceToTree?: boolean;
  // Legacy fields
  grid?: ColorGrid;
}

export interface ConnectivityDPLLResponse {
  success: boolean;
  solution: GridSolution | null;
  error?: string;
  solverType: "dpll";
  messageType?: "progress" | "result";
  stats?: { numVars: number; numClauses: number };
}

/**
 * Detect if an error is a memory-related error and provide a user-friendly message
 */
function formatErrorMessage(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Detect common errors
  if (
    errorMessage.includes("Out of memory") ||
    errorMessage.includes("Maximum call stack")
  ) {
    return "The problem is too complex for the DPLL solver. Try using a more efficient solver like CaDiCaL or MiniSat.";
  }

  return errorMessage;
}

self.onmessage = (event: MessageEvent<ConnectivityDPLLRequest>) => {
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
    // Create solver
    const solver = new DPLLSolver();

    // Solve using DPLL with the connectivity encoding
    const solution = solveConnectivityGridColoring(grid, {
      solver,
      gridType,
      reduceToTree,
      onStatsReady: (stats) => {
        // Send progress message with stats before solving
        const progressResponse: ConnectivityDPLLResponse = {
          success: true,
          solution: null,
          solverType: "dpll",
          messageType: "progress",
          stats,
        };
        self.postMessage(progressResponse);
      },
    });

    const response: ConnectivityDPLLResponse = {
      success: true,
      solution,
      solverType: "dpll",
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: ConnectivityDPLLResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      solverType: "dpll",
      messageType: "result",
    };
    self.postMessage(response);
  }
};
