/**
 * Web Worker for running the CaDiCaL SAT solver in a background thread
 * 
 * This worker loads the CaDiCaL WASM module and uses it for SAT solving.
 */

/// <reference lib="webworker" />

import { solveGridColoring } from "./grid-coloring";
import type { ColorGrid, GridSolution, GridType, PathlengthConstraint } from "./grid-coloring";
import { CadicalSolver, CadicalFormulaBuilder } from "../sat";
import type { CadicalClass } from "../sat";

export interface CadicalSolverRequest {
  gridType: GridType;
  width: number;
  height: number;
  colors: (number | null)[][];
  pathlengthConstraints: PathlengthConstraint[];
  // Legacy fields
  grid?: ColorGrid;
  numColors?: number;
}

export interface CadicalSolverResponse {
  success: boolean;
  solution: GridSolution | null;
  error?: string;
  solverType: "cadical";
}

// Type definitions for the Emscripten module
// Note: We import CadicalClass from types but define CadicalModule locally
// because the module loading pattern requires a slightly different interface
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
// Using self as the global context for web workers
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
    return "Out of memory - the grid is too complex to solve. Try using fewer colors or a smaller grid.";
  }
  
  return errorMessage;
}

/**
 * Load the CaDiCaL WASM module by fetching and evaluating the script
 */
function loadCadicalModule(): Promise<CadicalModule> {
  return new Promise((resolve, reject) => {
    // Fetch the Emscripten-generated JS file
    fetch("/cadical/cadical-emscripten.js")
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch CaDiCaL script: ${response.status}`);
        }
        return response.text();
      })
      .then(scriptText => {
        // The Emscripten module expects scriptDirectory to be set for locating the WASM file
        // We need to set it up and expose the Module globally
        // Also configure locateFile to help find the WASM
        (self as Record<string, unknown>)["Module"] = {
          locateFile: (path: string) => `/cadical/${path}`
        };
        
        // Execute the script using indirect eval to get global scope.
        // Note: We use eval() here because:
        // 1. Vite bundles workers as ES modules by default
        // 2. ES module workers don't support importScripts()
        // 3. The Emscripten-generated script expects to run in global scope
        // 4. Indirect eval (0, eval)() runs in global scope rather than local scope
        (0, eval)(scriptText);
        
        // Module should now be available on self
        if (self.Module) {
          // Set up the callback for when runtime is initialized
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

self.onmessage = async (event: MessageEvent<CadicalSolverRequest>) => {
  const { gridType, width, height, colors, pathlengthConstraints, grid: legacyGrid, numColors } = event.data;

  // Support both new and legacy request formats
  const grid: ColorGrid = legacyGrid ?? { width, height, colors };
  const effectiveNumColors = numColors ?? 6;

  try {
    // Load the module (cached after first load)
    const module = await getModule();
    
    // Create a new CaDiCaL instance
    const cadical = new Cadical(module);
    
    // Create solver and builder
    const solver = new CadicalSolver(cadical);
    const builder = new CadicalFormulaBuilder(solver);
    
    // Solve using CaDiCaL
    const solution = solveGridColoring(grid, effectiveNumColors, { solver, builder, gridType, pathlengthConstraints });
    
    // Clean up
    cadical.release();
    
    const response: CadicalSolverResponse = {
      success: true,
      solution,
      solverType: "cadical",
    };
    self.postMessage(response);
  } catch (error) {
    const response: CadicalSolverResponse = {
      success: false,
      solution: null,
      error: formatErrorMessage(error),
      solverType: "cadical",
    };
    self.postMessage(response);
  }
};
