/**
 * Web Worker for running the Polyomino/Polyhex/Polyiamond Tiling SAT solver in a background thread
 * 
 * This worker loads the CaDiCaL WASM module and uses it for SAT solving
 * of polyomino, polyhex, and polyiamond tiling problems.
 */

/// <reference lib="webworker" />

import { solvePolyominoTiling } from "./polyomino-tiling";
import type { TilingResult, Placement } from "./polyomino-tiling";
import { solvePolyhexTiling } from "./polyhex-tiling";
import type { HexTilingResult, HexPlacement } from "./polyhex-tiling";
import { solvePolyiamondTiling } from "./polyiamond-tiling";
import type { TriTilingResult, TriPlacement } from "./polyiamond-tiling";
import { solveEdgeColoredPolyominoTiling } from "./edge-colored-polyomino-tiling";
import type { EdgeColoredTilingResult, EdgeColoredPlacement, EdgeColoredTile, EdgeColor, CellEdgeColors } from "./edge-colored-polyomino-tiling";
import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";

/** Polyform type for the solver */
export type PolyformType = "polyomino" | "polyhex" | "polyiamond";

/** Serializable edge color data for tiles */
export interface SerializableEdgeColorData {
  /** Edge colors keyed by "row,col" */
  [key: string]: CellEdgeColors;
}

export interface PolyominoTilingSolverRequest {
  /** The tile cells (boolean grid) - kept for backward compatibility */
  cells?: boolean[][];
  /** Multiple tiles to use for tiling (new: takes precedence over cells) */
  tiles?: boolean[][][];
  /** Width of the tiling grid */
  tilingWidth: number;
  /** Height of the tiling grid */
  tilingHeight: number;
  /** Polyform type (default: "polyomino" for backward compatibility) */
  polyformType?: PolyformType;
  /** Edge coloring mode (only for polyomino) */
  edgeColoringEnabled?: boolean;
  /** Edge colors for each tile (only when edgeColoringEnabled) */
  tileEdgeColors?: SerializableEdgeColorData[];
}

/** Serializable edge color result */
export interface SerializableEdgeColorResult {
  [key: string]: EdgeColor;
}

export interface PolyominoTilingSolverResponse {
  success: boolean;
  result: TilingResult | HexTilingResult | TriTilingResult | EdgeColoredTilingResult | null;
  error?: string;
  /** Type of message: 'progress' for stats before solving, 'result' for final result */
  messageType?: "progress" | "result";
  /** SAT problem stats (sent in progress message before solving) */
  stats?: { numVars: number; numClauses: number };
  /** Polyform type that was solved */
  polyformType?: PolyformType;
  /** Whether edge coloring was used */
  edgeColoringEnabled?: boolean;
  /** Serializable edge colors (converted from Map) */
  edgeColorsResult?: SerializableEdgeColorResult;
}

// Re-export types for consumers
export type { TilingResult, Placement, HexTilingResult, HexPlacement, TriTilingResult, TriPlacement, EdgeColoredTilingResult, EdgeColoredPlacement, EdgeColoredTile, EdgeColor, CellEdgeColors };

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
 * 
 * SECURITY NOTE: This function uses eval() to load the Emscripten-generated JavaScript.
 * This is necessary because:
 * 1. Vite bundles workers as ES modules by default
 * 2. ES module workers don't support importScripts()
 * 3. The Emscripten-generated script expects to run in global scope
 * 4. The script is loaded from a controlled, same-origin source (/cadical/cadical-emscripten.js)
 * 
 * This is a known limitation when integrating Emscripten modules with modern ES module bundlers.
 * The security risk is mitigated by:
 * - Only evaluating scripts from our own server (same-origin)
 * - The script content is fetched from a static asset, not user input
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
        // The Emscripten module expects scriptDirectory to be set for locating the WASM file
        // We need to set it up and expose the Module globally
        // Also configure locateFile to help find the WASM
        (self as Record<string, unknown>)["Module"] = {
          locateFile: (path: string) => `/cadical/${path}`
        };
        
        // Execute the script using indirect eval to get global scope.
        // Indirect eval (0, eval)() runs in global scope rather than local scope.
        // This is required because Emscripten scripts expect global scope access.
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
    modulePromise = loadCadicalModule().catch(error => {
      // Reset the promise on failure so subsequent requests can retry
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

self.onmessage = async (event: MessageEvent<PolyominoTilingSolverRequest>) => {
  const { cells, tiles, tilingWidth, tilingHeight, polyformType = "polyomino", edgeColoringEnabled = false, tileEdgeColors } = event.data;
  
  // Use tiles array if provided, otherwise fall back to single cells for backward compatibility
  const tilesToUse: boolean[][][] = tiles ?? (cells ? [cells] : []);

  try {
    // Load the module (cached after first load)
    const module = await getModule();
    
    // Create a new CaDiCaL instance
    const cadical = new Cadical(module);
    
    // Create solver
    const solver = new CadicalSolver(cadical);
    
    // Progress callback
    const onStatsReady = (stats: { numVars: number; numClauses: number }) => {
      const progressResponse: PolyominoTilingSolverResponse = {
        success: true,
        result: null,
        messageType: "progress",
        stats,
        polyformType,
        edgeColoringEnabled,
      };
      self.postMessage(progressResponse);
    };
    
    // Solve the tiling problem based on polyform type
    let result: TilingResult | HexTilingResult | TriTilingResult | EdgeColoredTilingResult;
    let edgeColorsResult: SerializableEdgeColorResult | undefined;
    
    if (polyformType === "polyhex") {
      result = solvePolyhexTiling(tilesToUse, tilingWidth, tilingHeight, solver, onStatsReady);
    } else if (polyformType === "polyiamond") {
      result = solvePolyiamondTiling(tilesToUse, tilingWidth, tilingHeight, solver, onStatsReady);
    } else if (edgeColoringEnabled && tileEdgeColors) {
      // Edge-colored polyomino tiling
      const edgeColoredTiles: EdgeColoredTile[] = tilesToUse.map((tileCells, index) => {
        const edgeData = tileEdgeColors[index] || {};
        const edgeMap = new Map<string, CellEdgeColors>();
        for (const [key, colors] of Object.entries(edgeData)) {
          edgeMap.set(key, colors as CellEdgeColors);
        }
        // Fill in default colors for any missing cells
        for (let row = 0; row < tileCells.length; row++) {
          for (let col = 0; col < (tileCells[row]?.length || 0); col++) {
            if (tileCells[row][col]) {
              const key = `${row},${col}`;
              if (!edgeMap.has(key)) {
                edgeMap.set(key, { top: 0, right: 0, bottom: 0, left: 0 });
              }
            }
          }
        }
        return { cells: tileCells, edgeColors: edgeMap };
      });
      
      const ecResult = solveEdgeColoredPolyominoTiling(edgeColoredTiles, tilingWidth, tilingHeight, solver, onStatsReady);
      result = ecResult;
      
      // Convert edge colors Map to serializable object
      if (ecResult.edgeColors) {
        edgeColorsResult = {};
        for (const [key, color] of ecResult.edgeColors) {
          edgeColorsResult[key] = color;
        }
      }
    } else {
      result = solvePolyominoTiling(tilesToUse, tilingWidth, tilingHeight, solver, onStatsReady);
    }
    
    // Clean up
    cadical.release();
    
    const response: PolyominoTilingSolverResponse = {
      success: true,
      result,
      messageType: "result",
      polyformType,
      edgeColoringEnabled,
      edgeColorsResult,
    };
    self.postMessage(response);
  } catch (error) {
    const response: PolyominoTilingSolverResponse = {
      success: false,
      result: null,
      error: formatErrorMessage(error),
      messageType: "result",
    };
    self.postMessage(response);
  }
};
