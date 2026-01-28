/**
 * Web Worker for running the Polyform Tiling SAT solver in a background thread
 * 
 * This worker loads the CaDiCaL WASM module and uses it for tiling SAT solving.
 */

/// <reference lib="webworker" />

import { solveTiling, type PolyformType, type Placement } from "./tiling-solver";
import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";

export interface TilingSolverRequest {
  /** The tile cells (boolean grid) */
  tileCells: boolean[][];
  /** Type of polyform (determines transforms) */
  polyformType: PolyformType;
  /** Target grid width */
  targetWidth: number;
  /** Target grid height */
  targetHeight: number;
}

export interface TilingSolverResponse {
  success: boolean;
  satisfiable: boolean;
  /** Selected placements if satisfiable */
  placements: Placement[];
  /** Error message if not successful */
  error?: string;
  /** Statistics */
  stats?: {
    numVars: number;
    numClauses: number;
    numPlacements: number;
    numTransforms: number;
  };
  /** Message type */
  messageType: "progress" | "result";
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
 * Cadical class implementation (matches the one from cadical.worker.ts)
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
  
  if (
    errorMessage.includes("Cannot enlarge memory arrays") ||
    errorMessage.includes("memory") ||
    errorMessage.includes("Out of memory") ||
    errorMessage.includes("abort()")
  ) {
    return "Out of memory - the tiling problem is too complex. Try a smaller grid or simpler tile.";
  }
  
  return errorMessage;
}

/**
 * Load the CaDiCaL WASM module by fetching and evaluating the script
 */
function loadCadicalModule(): Promise<CadicalModule> {
  return new Promise((resolve, reject) => {
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
    modulePromise = loadCadicalModule();
  }
  return modulePromise;
}

self.onmessage = async (event: MessageEvent<TilingSolverRequest>) => {
  const { tileCells, polyformType, targetWidth, targetHeight } = event.data;

  try {
    // Send progress message
    const progressResponse: TilingSolverResponse = {
      success: true,
      satisfiable: false,
      placements: [],
      messageType: "progress",
    };
    self.postMessage(progressResponse);

    // Load the module (cached after first load)
    const module = await getModule();
    
    // Create a new CaDiCaL instance
    const cadical = new Cadical(module);
    
    // Create solver
    const solver = new CadicalSolver(cadical);
    
    // Solve the tiling problem
    const result = solveTiling(tileCells, polyformType, targetWidth, targetHeight, solver);
    
    // Clean up
    cadical.release();
    
    const response: TilingSolverResponse = {
      success: true,
      satisfiable: result.satisfiable,
      placements: result.placements,
      stats: result.stats,
      messageType: "result",
    };
    self.postMessage(response);
  } catch (error) {
    const response: TilingSolverResponse = {
      success: false,
      satisfiable: false,
      placements: [],
      error: formatErrorMessage(error),
      messageType: "result",
    };
    self.postMessage(response);
  }
};
