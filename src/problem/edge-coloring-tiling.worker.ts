/**
 * Web Worker for running the Edge Coloring Tiling SAT solver in a background thread
 * 
 * This worker loads the CaDiCaL WASM module and uses it for SAT solving
 * of edge coloring polyomino tiling problems.
 */

/// <reference lib="webworker" />

import { solveEdgeColoringTiling } from "./edge-coloring-tiling";
import type { EdgeColoringResult, EdgeColoringPlacement, ColoredTile } from "./edge-coloring-tiling";
import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";

export interface EdgeColoringTilingSolverRequest {
  /** The colored tile definition */
  tile: ColoredTile;
  /** Width of the tiling grid */
  tilingWidth: number;
  /** Height of the tiling grid */
  tilingHeight: number;
}

export interface EdgeColoringTilingSolverResponse {
  success: boolean;
  result: EdgeColoringResult | null;
  error?: string;
  /** Type of message: 'progress' for stats before solving, 'result' for final result */
  messageType?: "progress" | "result";
  /** SAT problem stats (sent in progress message before solving) */
  stats?: { numVars: number; numClauses: number };
}

// Re-export types for consumers
export type { EdgeColoringResult, EdgeColoringPlacement, ColoredTile };

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
    this.solverPtr = this.module.ccall("ccadical_init", "number", [], []) as number;
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
    this.module.ccall("ccadical_add", null, ["number", "number"], [this.solverPtr, litOrZero]);
  }

  addClause(clause: number[]): void {
    for (const lit of clause) {
      this.add(lit);
    }
    this.add(0);
  }

  assume(lit: number): void {
    this.module.ccall("ccadical_assume", null, ["number", "number"], [this.solverPtr, lit]);
  }

  solve(): boolean | undefined {
    const result = this.module.ccall("ccadical_solve", "number", ["number"], [this.solverPtr]) as number;
    if (result === 10) {
      return true;
    } else if (result === 20) {
      return false;
    } else {
      return undefined;
    }
  }

  value(lit: number): number {
    const v = this.module.ccall("ccadical_val", "number", ["number", "number"], [this.solverPtr, lit]) as number;
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
    this.module.ccall("ccadical_constrain", null, ["number", "number"], [this.solverPtr, litOrZero]);
  }

  constrainClause(clause: number[]): void {
    for (const lit of clause) {
      this.constrain(lit);
    }
    this.constrain(0);
  }

  setOption(name: string, v: number): void {
    this.module.ccall("ccadical_set_option", null, ["number", "string", "number"], [this.solverPtr, name, v]);
  }

  printStatistics(): void {
    this.module.ccall("ccadical_print_statistics", null, ["number"], [this.solverPtr]);
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
    return "Out of memory - the problem is too complex. Try using a smaller tile or tiling grid.";
  }
  
  return errorMessage;
}

/**
 * Load the CaDiCaL WASM module by fetching and evaluating the script
 */
function loadCadicalModule(): Promise<CadicalModule> {
  return new Promise((resolve, reject) => {
    // Fetch the Emscripten-generated JS file from our own server (same-origin)
    fetch("/cadical/cadical-emscripten.js")
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch CaDiCaL script: ${response.status}`);
        }
        return response.text();
      })
      .then(scriptText => {
        (self as Record<string, unknown>)["Module"] = {
          locateFile: (path: string) => `/cadical/${path}`
        };
        
        // Execute the script using indirect eval to get global scope.
        (0, eval)(scriptText);
        
        if (self.Module) {
          self.Module.onRuntimeInitialized = () => resolve(self.Module!);
        } else {
          reject(new Error("CaDiCaL module failed to load"));
        }
      })
      .catch(error => {
        reject(new Error(`Failed to load CaDiCaL: ${error}`));
      });
  });
}

// Track if module is loaded
let modulePromise: Promise<CadicalModule> | null = null;

function getModule(): Promise<CadicalModule> {
  if (!modulePromise) {
    modulePromise = loadCadicalModule().catch(error => {
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

self.onmessage = async (event: MessageEvent<EdgeColoringTilingSolverRequest>) => {
  const { tile, tilingWidth, tilingHeight } = event.data;

  try {
    // Load the module (cached after first load)
    const module = await getModule();
    
    // Create a new CaDiCaL instance
    const cadical = new Cadical(module);
    
    // Create solver
    const solver = new CadicalSolver(cadical);
    
    // Progress callback
    const onStatsReady = (stats: { numVars: number; numClauses: number }) => {
      const progressResponse: EdgeColoringTilingSolverResponse = {
        success: true,
        result: null,
        messageType: "progress",
        stats,
      };
      self.postMessage(progressResponse);
    };
    
    // Solve the tiling problem
    const result = solveEdgeColoringTiling(tile, tilingWidth, tilingHeight, solver, onStatsReady);
    
    // Clean up
    cadical.release();
    
    // Convert Map to serializable format
    const serializableResult = {
      ...result,
      placements: result.placements?.map(p => ({
        ...p,
        edgeColors: Array.from(p.edgeColors.entries()),
      })),
    };
    
    const response: EdgeColoringTilingSolverResponse = {
      success: true,
      result: serializableResult as unknown as EdgeColoringResult,
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: EdgeColoringTilingSolverResponse = {
      success: false,
      result: null,
      error: formatErrorMessage(error),
      messageType: "result",
    };
    self.postMessage(response);
  }
};
