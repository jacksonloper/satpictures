/**
 * Web Worker for running the DPLL SAT solver in a background thread
 *
 * This worker uses the classic DPLL algorithm (1962) for SAT solving.
 */

import { solveForestGridColoring } from "./forest-grid-solver";
import type {
  ColorGrid,
  GridSolution,
  GridType,
  PathlengthConstraint,
  ColorRoots,
} from "./graph-types";
import { DPLLSolver } from "../solvers";

export interface DPLLSolverRequest {
  gridType: GridType;
  width: number;
  height: number;
  colors: (number | null)[][];
  pathlengthConstraints: PathlengthConstraint[];
  colorRoots: ColorRoots;
  // Legacy fields
  grid?: ColorGrid;
}

export interface DPLLSolverResponse {
  success: boolean;
  solution: GridSolution | null;
  error?: string;
  solverType: "dpll";
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

  // Detect common errors
  if (
    errorMessage.includes("Out of memory") ||
    errorMessage.includes("Maximum call stack")
  ) {
    return "The problem is too complex for the DPLL solver. Try using a more efficient solver like CaDiCaL or MiniSat.";
  }

  return errorMessage;
}

self.onmessage = (event: MessageEvent<DPLLSolverRequest>) => {
  const {
    gridType,
    width,
    height,
    colors,
    pathlengthConstraints,
    colorRoots,
    grid: legacyGrid,
  } = event.data;

  // Support both new and legacy request formats
  const grid: ColorGrid = legacyGrid ?? { width, height, colors };

  try {
    // Create solver
    const solver = new DPLLSolver();

    // Solve using DPLL with the forest encoding
    const solution = solveForestGridColoring(grid, {
      solver,
      gridType,
      pathlengthConstraints,
      colorRoots,
      onStatsReady: (stats) => {
        // Send progress message with stats before solving
        const progressResponse: DPLLSolverResponse = {
          success: true,
          solution: null,
          solverType: "dpll",
          messageType: "progress",
          stats,
        };
        self.postMessage(progressResponse);
      },
    });

    const response: DPLLSolverResponse = {
      success: true,
      solution,
      solverType: "dpll",
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: DPLLSolverResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      solverType: "dpll",
      messageType: "result",
    };
    self.postMessage(response);
  }
};
