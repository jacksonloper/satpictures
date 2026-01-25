/**
 * Web Worker for running the CaDiCaL SAT solver with connectivity encoding
 *
 * This worker loads the CaDiCaL WASM module and uses it for SAT solving
 * with the connectivity encoding (arborescence-style).
 */

/// <reference lib="webworker" />

import { solveConnectivityGridColoring } from "./connectivity-grid-solver";
import type { ColorGrid, GridSolution, GridType } from "./graph-types";
import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";

export interface ConnectivityCadicalRequest {
  gridType: GridType;
  width: number;
  height: number;
  colors: (number | null)[][];
  reduceToTree?: boolean;
  // Legacy fields
  grid?: ColorGrid;
}

export interface ConnectivityCadicalResponse {
  success: boolean;
  solution: GridSolution | null;
  error?: string;
  solverType: "cadical";
  messageType?: "progress" | "result";
  stats?: { numVars: number; numClauses: number };
}

// Type definitions for the Emscripten module
interface CadicalModule {
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  onRuntimeInitialized?: () => void;
  locateFile?: (path: string) => string;
}

// Global Module will be set by the Emscripten-generated JS
declare const self: typeof globalThis & {
  Module?: CadicalModule;
};

/**
 * Cadical class implementation (matches the one from cadical.js)
 */
class Cadical implements CadicalClass {
  private solverPtr: number | undefined = undefined;
  private module: CadicalModule;

  constructor(module: CadicalModule) {
    this.module = module;
    this.init();
  }

  init(): void {
    this.release();
    this.solverPtr = this.module.ccall(
      "ccadical_init",
      "number",
      [],
      []
    ) as number;
  }

  initPlain(): void {
    this.init();
    this.setOption("compact", 0);
    this.setOption("decompose", 0);
    this.setOption("deduplicate", 0);
    this.setOption("elim", 0);
    this.setOption("probe", 0);
    this.setOption("subsume", 0);
    this.setOption("ternary", 0);
    this.setOption("transred", 0);
    this.setOption("vivify", 0);
  }

  initSat(): void {
    this.init();
    this.setOption("elimreleff", 10);
    this.setOption("stabilizeonly", 1);
    this.setOption("subsumereleff", 60);
  }

  initUnsat(): void {
    this.init();
    this.setOption("stabilize", 0);
    this.setOption("walk", 0);
  }

  release(): void {
    if (this.solverPtr !== undefined) {
      this.module.ccall("ccadical_release", null, ["number"], [this.solverPtr]);
    }
    this.solverPtr = undefined;
  }

  signature(): string {
    return this.module.ccall("ccadical_signature", "string", [], []) as string;
  }

  add(litOrZero: number): void {
    this.module.ccall(
      "ccadical_add",
      null,
      ["number", "number"],
      [this.solverPtr, litOrZero]
    );
  }

  addClause(clause: number[]): void {
    for (const lit of clause) {
      this.add(lit);
    }
    this.add(0);
  }

  assume(lit: number): void {
    this.module.ccall(
      "ccadical_assume",
      null,
      ["number", "number"],
      [this.solverPtr, lit]
    );
  }

  solve(): boolean | undefined {
    const result = this.module.ccall(
      "ccadical_solve",
      "number",
      ["number"],
      [this.solverPtr]
    ) as number;
    if (result === 10) {
      return true;
    } else if (result === 20) {
      return false;
    } else {
      return undefined;
    }
  }

  value(lit: number): number {
    const v = this.module.ccall(
      "ccadical_val",
      "number",
      ["number", "number"],
      [this.solverPtr, lit]
    ) as number;
    if (v === 0) {
      return lit;
    } else {
      return v;
    }
  }

  model(vars: number[]): number[] {
    return vars.map((v) => this.value(v));
  }

  constrain(litOrZero: number): void {
    this.module.ccall(
      "ccadical_constrain",
      null,
      ["number", "number"],
      [this.solverPtr, litOrZero]
    );
  }

  constrainClause(clause: number[]): void {
    for (const lit of clause) {
      this.constrain(lit);
    }
    this.constrain(0);
  }

  setOption(name: string, v: number): void {
    this.module.ccall(
      "ccadical_set_option",
      null,
      ["number", "string", "number"],
      [this.solverPtr, name, v]
    );
  }

  printStatistics(): void {
    this.module.ccall("ccadical_print_statistics", null, ["number"], [
      this.solverPtr,
    ]);
  }
}

/**
 * Detect if an error is a memory-related error and provide a user-friendly message
 */
function formatErrorMessage(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Detect CaDiCaL/WASM memory errors
  if (
    errorMessage.includes("Cannot enlarge memory arrays") ||
    errorMessage.includes("memory") ||
    errorMessage.includes("Out of memory") ||
    errorMessage.includes("abort()")
  ) {
    return "Out of memory - the grid is too complex to solve. Try using fewer colors or a smaller grid.";
  }

  return errorMessage;
}

/**
 * Load the CaDiCaL WASM module by fetching and evaluating the script
 */
function loadCadicalModule(): Promise<CadicalModule> {
  return new Promise((resolve, reject) => {
    fetch("/cadical/cadical-emscripten.js")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch CaDiCaL script: ${response.status}`);
        }
        return response.text();
      })
      .then((scriptText) => {
        (self as Record<string, unknown>)["Module"] = {
          locateFile: (path: string) => `/cadical/${path}`,
        };

        (0, eval)(scriptText);

        if (self.Module) {
          self.Module.onRuntimeInitialized = () => resolve(self.Module!);
        } else {
          reject(new Error("CaDiCaL module failed to load"));
        }
      })
      .catch((error) => {
        reject(new Error(`Failed to load CaDiCaL: ${error}`));
      });
  });
}

// Track if module is loaded
let modulePromise: Promise<CadicalModule> | null = null;

function getModule(): Promise<CadicalModule> {
  if (!modulePromise) {
    modulePromise = loadCadicalModule();
  }
  return modulePromise;
}

self.onmessage = async (event: MessageEvent<ConnectivityCadicalRequest>) => {
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
    // Load the module (cached after first load)
    const module = await getModule();

    // Create a new CaDiCaL instance
    const cadical = new Cadical(module);

    // Create solver
    const solver = new CadicalSolver(cadical);

    // Solve using CaDiCaL with the connectivity encoding
    const solution = solveConnectivityGridColoring(grid, {
      solver,
      gridType,
      reduceToTree,
      onStatsReady: (stats) => {
        // Send progress message with stats before solving
        const progressResponse: ConnectivityCadicalResponse = {
          success: true,
          solution: null,
          solverType: "cadical",
          messageType: "progress",
          stats,
        };
        self.postMessage(progressResponse);
      },
    });

    // Clean up
    cadical.release();

    const response: ConnectivityCadicalResponse = {
      success: true,
      solution,
      solverType: "cadical",
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: ConnectivityCadicalResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      solverType: "cadical",
      messageType: "result",
    };
    self.postMessage(response);
  }
};
