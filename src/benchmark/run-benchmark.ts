/**
 * Benchmark script for SAT encoding optimizations
 * 
 * Tests a 10x10 maze with pathlength constraint minimum 40 using CaDiCaL solver.
 * Run with: npx tsx src/benchmark/run-benchmark.ts
 */

import { solveGridColoring } from "../problem/grid-coloring";
import type { ColorGrid, PathlengthConstraint } from "../problem/graph-types";
import { CadicalSolver, CadicalFormulaBuilder } from "../solvers";
import type { CadicalClass } from "../solvers";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// ESM compatibility for __dirname and require
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Type definitions for the Emscripten module
interface CadicalModule {
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  onRuntimeInitialized?: () => void;
}

/**
 * Cadical class implementation for Node.js
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
 * Load the CaDiCaL WASM module in Node.js
 */
async function loadCadicalModule(): Promise<CadicalModule> {
  // Set up the module path
  const cadicalDir = path.join(__dirname, "../../public/cadical");
  const jsPath = path.join(cadicalDir, "cadical-emscripten.js");
  
  // Check if the file exists
  if (!fs.existsSync(jsPath)) {
    throw new Error(`CaDiCaL JS file not found: ${jsPath}`);
  }
  
  // Set up global Module for Emscripten
  const globalAny = global as Record<string, unknown>;
  globalAny.Module = {
    locateFile: (wasmPath: string) => path.join(cadicalDir, wasmPath)
  };
  
  return new Promise((resolve, reject) => {
    try {
      const module = require(jsPath) as CadicalModule;
      
      // Wait for runtime to initialize
      if (module.onRuntimeInitialized) {
        const originalCallback = module.onRuntimeInitialized;
        module.onRuntimeInitialized = () => {
          originalCallback?.();
          resolve(module);
        };
      } else {
        // Module may already be ready
        setTimeout(() => resolve(module), 100);
      }
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create a 10x10 test grid with 4 colors in quadrants
 * 
 * Color layout:
 *   0 0 0 0 0 | 1 1 1 1 1
 *   0 0 0 0 0 | 1 1 1 1 1
 *   0 0 0 0 0 | 1 1 1 1 1
 *   0 0 0 0 0 | 1 1 1 1 1
 *   0 0 0 0 0 | 1 1 1 1 1
 *   --------------------
 *   2 2 2 2 2 | 3 3 3 3 3
 *   2 2 2 2 2 | 3 3 3 3 3
 *   2 2 2 2 2 | 3 3 3 3 3
 *   2 2 2 2 2 | 3 3 3 3 3
 *   2 2 2 2 2 | 3 3 3 3 3
 */
function createTestGrid(width: number, height: number): ColorGrid {
  const colors: (number | null)[][] = [];
  
  for (let row = 0; row < height; row++) {
    const rowColors: (number | null)[] = [];
    for (let col = 0; col < width; col++) {
      // Create quadrant-based color assignment
      const isTop = row < height / 2;
      const isLeft = col < width / 2;
      
      // Fix the corner cells, leave the rest blank for more complex solving
      const isCorner = (row === 0 || row === height - 1) && (col === 0 || col === width - 1);
      const isEdge = row === 0 || row === height - 1 || col === 0 || col === width - 1;
      
      if (isCorner || isEdge) {
        // Assign quadrant colors
        if (isTop && isLeft) rowColors.push(0);
        else if (isTop && !isLeft) rowColors.push(1);
        else if (!isTop && isLeft) rowColors.push(2);
        else rowColors.push(3);
      } else {
        // Interior cells are blank
        rowColors.push(null);
      }
    }
    colors.push(rowColors);
  }
  
  return { width, height, colors };
}

/**
 * Create a simpler test grid with all fixed colors
 */
function createSimpleTestGrid(width: number, height: number): ColorGrid {
  const colors: (number | null)[][] = [];
  
  for (let row = 0; row < height; row++) {
    const rowColors: (number | null)[] = [];
    for (let col = 0; col < width; col++) {
      // Create quadrant-based color assignment
      const isTop = row < height / 2;
      const isLeft = col < width / 2;
      
      // All cells are fixed
      if (isTop && isLeft) rowColors.push(0);
      else if (isTop && !isLeft) rowColors.push(1);
      else if (!isTop && isLeft) rowColors.push(2);
      else rowColors.push(3);
    }
    colors.push(rowColors);
  }
  
  return { width, height, colors };
}

interface BenchmarkResult {
  success: boolean;
  variableCount: number;
  clauseCount: number;
  encodeTimeMs: number;
  solveTimeMs: number;
  totalTimeMs: number;
  satisfiable: boolean;
  error?: string;
}

/**
 * Run a single benchmark
 */
function runBenchmark(
  grid: ColorGrid,
  pathlengthConstraints: PathlengthConstraint[],
  cadicalModule: CadicalModule
): BenchmarkResult {
  const startTime = performance.now();
  
  // Deprecated parameter kept for API compatibility
  const numColors = 6;
  
  try {
    // Create a new CaDiCaL instance
    const cadical = new Cadical(cadicalModule);
    const solver = new CadicalSolver(cadical);
    const builder = new CadicalFormulaBuilder(solver);
    
    const encodeStart = performance.now();
    
    // Run the solver
    const solution = solveGridColoring(grid, numColors, {
      solver,
      builder,
      gridType: "square",
      pathlengthConstraints,
    });
    
    const solveEnd = performance.now();
    
    // Get statistics
    const variableCount = solver.getVariableCount();
    const clauseCount = solver.getClauseCount();
    
    // Clean up
    cadical.release();
    
    const endTime = performance.now();
    
    return {
      success: true,
      variableCount,
      clauseCount,
      encodeTimeMs: solveEnd - encodeStart, // Includes both encoding and solving
      solveTimeMs: 0, // We can't separate encode from solve with current API
      totalTimeMs: endTime - startTime,
      satisfiable: solution !== null,
    };
  } catch (error) {
    const endTime = performance.now();
    return {
      success: false,
      variableCount: 0,
      clauseCount: 0,
      encodeTimeMs: 0,
      solveTimeMs: 0,
      totalTimeMs: endTime - startTime,
      satisfiable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Main benchmark function
 */
async function main() {
  console.log("=".repeat(60));
  console.log("SAT Encoding Benchmark");
  console.log("=".repeat(60));
  console.log("");
  
  // Load CaDiCaL
  console.log("Loading CaDiCaL WASM module...");
  const cadicalModule = await loadCadicalModule();
  console.log("CaDiCaL loaded successfully");
  console.log("");
  
  // Test 1: Simple 10x10 grid without pathlength constraints
  console.log("-".repeat(60));
  console.log("Test 1: 10x10 grid (all fixed colors, no pathlength constraints)");
  console.log("-".repeat(60));
  
  const simpleGrid = createSimpleTestGrid(10, 10);
  const result1 = runBenchmark(simpleGrid, [], cadicalModule);
  
  console.log(`  Variables: ${result1.variableCount}`);
  console.log(`  Clauses: ${result1.clauseCount}`);
  console.log(`  Total time: ${result1.totalTimeMs.toFixed(2)}ms`);
  console.log(`  Satisfiable: ${result1.satisfiable}`);
  if (result1.error) console.log(`  Error: ${result1.error}`);
  console.log("");
  
  // Test 2: 10x10 grid with blank cells
  console.log("-".repeat(60));
  console.log("Test 2: 10x10 grid (edge cells fixed, interior blank)");
  console.log("-".repeat(60));
  
  const blankGrid = createTestGrid(10, 10);
  const result2 = runBenchmark(blankGrid, [], cadicalModule);
  
  console.log(`  Variables: ${result2.variableCount}`);
  console.log(`  Clauses: ${result2.clauseCount}`);
  console.log(`  Total time: ${result2.totalTimeMs.toFixed(2)}ms`);
  console.log(`  Satisfiable: ${result2.satisfiable}`);
  if (result2.error) console.log(`  Error: ${result2.error}`);
  console.log("");
  
  // Test 3: 10x10 grid with pathlength constraint minimum 40
  console.log("-".repeat(60));
  console.log("Test 3: 10x10 grid with pathlength constraint (min 40)");
  console.log("-".repeat(60));
  
  // Test configuration
  const gridSize = 10;
  const minPathDistance = 40;
  
  // Create pathlength constraint from corner (0,0) to opposite corner
  // with minimum distance that forces a long winding path
  const pathlengthConstraints: PathlengthConstraint[] = [
    {
      id: "path1",
      root: { row: 0, col: 0 },
      minDistances: {
        [`${gridSize - 1},${gridSize - 1}`]: minPathDistance, // Opposite corner
      },
    },
  ];
  
  // For this test, use the simple grid with all fixed colors
  // so we're just testing the pathlength constraint encoding
  const result3 = runBenchmark(simpleGrid, pathlengthConstraints, cadicalModule);
  
  console.log(`  Variables: ${result3.variableCount}`);
  console.log(`  Clauses: ${result3.clauseCount}`);
  console.log(`  Total time: ${result3.totalTimeMs.toFixed(2)}ms`);
  console.log(`  Satisfiable: ${result3.satisfiable}`);
  if (result3.error) console.log(`  Error: ${result3.error}`);
  console.log("");
  
  // Test 4: Combined test - blank cells + pathlength constraint
  console.log("-".repeat(60));
  console.log("Test 4: 10x10 grid (blank interior) + pathlength (min 40)");
  console.log("-".repeat(60));
  
  const result4 = runBenchmark(blankGrid, pathlengthConstraints, cadicalModule);
  
  console.log(`  Variables: ${result4.variableCount}`);
  console.log(`  Clauses: ${result4.clauseCount}`);
  console.log(`  Total time: ${result4.totalTimeMs.toFixed(2)}ms`);
  console.log(`  Satisfiable: ${result4.satisfiable}`);
  if (result4.error) console.log(`  Error: ${result4.error}`);
  console.log("");
  
  // Summary with baseline comparison
  console.log("=".repeat(80));
  console.log("Summary with Baseline Comparison");
  console.log("=".repeat(80));
  console.log("");
  console.log("Baseline values (before optimization):");
  console.log("  Test 1: 6760 vars, 20996 clauses");
  console.log("  Test 2: 30128 vars, 99620 clauses");
  console.log("  Test 3: 24800 vars, 85057 clauses");
  console.log("  Test 4: 48168 vars, 163681 clauses");
  console.log("");
  console.log("Optimizations applied:");
  console.log("  1. Sequential counter encoding for AtMostOne (O(n) vs O(n²) clauses)");
  console.log("  2. Ball pruning for pathlength (only create R[i][v] for cells within dist i)");
  console.log("");
  console.log("Test                                    | Vars    | Clauses | Time(ms) | SAT");
  console.log("-".repeat(80));
  
  // Calculate improvements
  const baseline = [
    { vars: 6760, clauses: 20996 },
    { vars: 30128, clauses: 99620 },
    { vars: 24800, clauses: 85057 },
    { vars: 48168, clauses: 163681 }
  ];
  const results = [result1, result2, result3, result4];
  const names = [
    "1. Simple grid (no pathlength)         ",
    "2. Blank interior (no pathlength)      ",
    "3. Simple grid + pathlength (min 40)   ",
    "4. Blank interior + pathlength (min 40)"
  ];
  
  for (let i = 0; i < 4; i++) {
    const r = results[i];
    const b = baseline[i];
    const varChange = ((r.variableCount - b.vars) / b.vars * 100).toFixed(1);
    const clauseChange = ((r.clauseCount - b.clauses) / b.clauses * 100).toFixed(1);
    console.log(`${names[i]} | ${r.variableCount.toString().padStart(7)} | ${r.clauseCount.toString().padStart(7)} | ${r.totalTimeMs.toFixed(1).padStart(8)} | ${r.satisfiable}`);
    console.log(`  Change from baseline:                 | ${varChange.padStart(6)}% | ${clauseChange.padStart(6)}% |          |`);
  }
  console.log("");
}

main().catch(console.error);
