/**
 * DIMACS Size Analysis Test
 *
 * This script measures DIMACS file sizes for various grid configurations.
 * It investigates:
 * - 11x11 octagon grid with maze setup
 * - Various grid types (square, hex, octagon, cairo, cairobridge)
 * - Effect of wall percentage bounds
 * - Effect of reachability K parameter
 *
 * Run with: npx tsx tests/dimacs-size.test.ts
 */

import { gzipSync } from "zlib";
import { solveGridColoring, HATCH_COLOR, RED_DOT_COLOR, RED_HATCH_COLOR } from "../src/solver";
import type { ColorGrid, GridType } from "../src/solver";
import { DimacsSolver, MiniSatFormulaBuilder } from "../src/sat";

/**
 * Create maze setup grid - same as App.tsx createMazeSetupGrid
 */
function createMazeSetupGrid(width: number, height: number): ColorGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) => {
        // Origin: second row, first column - red dot
        if (row === 1 && col === 0) return RED_DOT_COLOR;
        // Target: penultimate row, last column - red hatch
        if (row === height - 2 && col === width - 1) return RED_HATCH_COLOR;
        // Border cells (except origin and target): orange hatch (walls)
        if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
          return HATCH_COLOR;
        }
        // Interior: red (color 0)
        return 0;
      })
    ),
  };
}

/**
 * Measure DIMACS size without actually solving
 */
function measureDimacsSize(
  grid: ColorGrid,
  numColors: number,
  gridType: GridType,
  minWallsProportion: number = 0,
  reachabilityK: number = 0
): {
  variables: number;
  clauses: number;
  literals: number;
  dimacsBytes: number;
  gzippedBytes: number;
} {
  const solver = new DimacsSolver();
  const builder = new MiniSatFormulaBuilder(solver);

  // Run the encoding (this won't solve, just capture clauses)
  solveGridColoring(grid, numColors, {
    solver,
    builder,
    gridType,
    minWallsProportion,
    reachabilityK,
  });

  const stats = solver.getStats();
  const dimacs = solver.toDimacs();
  const gzipped = gzipSync(Buffer.from(dimacs, "utf-8"));

  return {
    ...stats,
    gzippedBytes: gzipped.length,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

function printStats(
  label: string,
  stats: ReturnType<typeof measureDimacsSize>
): void {
  console.log(`\n=== ${label} ===`);
  console.log(`  Variables:    ${stats.variables.toLocaleString()}`);
  console.log(`  Clauses:      ${stats.clauses.toLocaleString()}`);
  console.log(`  Literals:     ${stats.literals.toLocaleString()}`);
  console.log(`  DIMACS size:  ${formatBytes(stats.dimacsBytes)}`);
  console.log(`  Gzipped size: ${formatBytes(stats.gzippedBytes)}`);
}

// ============================================
// MAIN INVESTIGATION
// ============================================

console.log("========================================");
console.log("DIMACS SIZE ANALYSIS");
console.log("========================================");

// 1. Main question: 11x11 octagon maze setup (default K=0)
console.log("\n\n### 1. 11x11 OCTAGON WITH MAZE SETUP (K=0) ###");
const grid11x11Octo = createMazeSetupGrid(11, 11);
const stats11x11Octo = measureDimacsSize(grid11x11Octo, 6, "octagon", 0, 0);
printStats("11x11 Octagon Maze (K=0)", stats11x11Octo);

// 2. Investigate different grid types with same maze setup
console.log("\n\n### 2. GRID TYPE COMPARISON (11x11 Maze Setup, K=0) ###");

const gridTypes: GridType[] = ["square", "hex", "octagon", "cairo", "cairobridge"];
const gridTypeResults: { type: GridType; stats: ReturnType<typeof measureDimacsSize> }[] = [];

for (const gridType of gridTypes) {
  const grid = createMazeSetupGrid(11, 11);
  const stats = measureDimacsSize(grid, 6, gridType, 0, 0);
  gridTypeResults.push({ type: gridType, stats });
  printStats(`11x11 ${gridType} Maze`, stats);
}

// Summary table
console.log("\n--- Grid Type Summary Table ---");
console.log("Grid Type    | Variables    | Clauses      | DIMACS Size  | Gzipped");
console.log("-------------|-------------|--------------|--------------|----------");
for (const { type, stats } of gridTypeResults) {
  console.log(
    `${type.padEnd(12)} | ${stats.variables.toString().padStart(11)} | ${stats.clauses.toString().padStart(12)} | ${formatBytes(stats.dimacsBytes).padStart(12)} | ${formatBytes(stats.gzippedBytes)}`
  );
}

// 3. Investigate wall percentage effect
console.log("\n\n### 3. WALL PERCENTAGE EFFECT (11x11 Octagon Maze, K=0) ###");

const wallPercentages = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
const wallResults: { pct: number; stats: ReturnType<typeof measureDimacsSize> }[] = [];

for (const pct of wallPercentages) {
  const grid = createMazeSetupGrid(11, 11);
  const stats = measureDimacsSize(grid, 6, "octagon", pct, 0);
  wallResults.push({ pct, stats });
  printStats(`Octagon Maze (wall=${(pct * 100).toFixed(0)}%)`, stats);
}

console.log("\n--- Wall Percentage Summary Table ---");
console.log("Wall %  | Variables    | Clauses      | DIMACS Size  | Gzipped");
console.log("--------|-------------|--------------|--------------|----------");
for (const { pct, stats } of wallResults) {
  console.log(
    `${(pct * 100).toFixed(0).padStart(5)}%  | ${stats.variables.toString().padStart(11)} | ${stats.clauses.toString().padStart(12)} | ${formatBytes(stats.dimacsBytes).padStart(12)} | ${formatBytes(stats.gzippedBytes)}`
  );
}

// 4. Investigate K (reachability) effect
console.log("\n\n### 4. REACHABILITY K EFFECT (11x11 Octagon Maze, wall=0%) ###");

const kValues = [0, 5, 10, 15, 20, 25, 30];
const kResults: { k: number; stats: ReturnType<typeof measureDimacsSize> }[] = [];

for (const k of kValues) {
  const grid = createMazeSetupGrid(11, 11);
  const stats = measureDimacsSize(grid, 6, "octagon", 0, k);
  kResults.push({ k, stats });
  printStats(`Octagon Maze (K=${k})`, stats);
}

console.log("\n--- Reachability K Summary Table ---");
console.log("K       | Variables    | Clauses      | DIMACS Size  | Gzipped");
console.log("--------|-------------|--------------|--------------|----------");
for (const { k, stats } of kResults) {
  console.log(
    `${k.toString().padStart(5)}   | ${stats.variables.toString().padStart(11)} | ${stats.clauses.toString().padStart(12)} | ${formatBytes(stats.dimacsBytes).padStart(12)} | ${formatBytes(stats.gzippedBytes)}`
  );
}

// 5. Combined: various grid types with K=10
console.log("\n\n### 5. GRID TYPES WITH K=10 (11x11 Maze Setup) ###");

const gridTypesK10Results: { type: GridType; stats: ReturnType<typeof measureDimacsSize> }[] = [];

for (const gridType of gridTypes) {
  const grid = createMazeSetupGrid(11, 11);
  const stats = measureDimacsSize(grid, 6, gridType, 0, 10);
  gridTypesK10Results.push({ type: gridType, stats });
  printStats(`${gridType} (K=10)`, stats);
}

console.log("\n--- Grid Types with K=10 Summary Table ---");
console.log("Grid Type    | Variables    | Clauses      | DIMACS Size  | Gzipped");
console.log("-------------|-------------|--------------|--------------|----------");
for (const { type, stats } of gridTypesK10Results) {
  console.log(
    `${type.padEnd(12)} | ${stats.variables.toString().padStart(11)} | ${stats.clauses.toString().padStart(12)} | ${formatBytes(stats.dimacsBytes).padStart(12)} | ${formatBytes(stats.gzippedBytes)}`
  );
}

// 6. Different grid sizes for octagon
console.log("\n\n### 6. GRID SIZE SCALING (Octagon Maze Setup, K=0) ###");

const sizes = [5, 7, 9, 11, 13, 15];
const sizeResults: { size: number; stats: ReturnType<typeof measureDimacsSize> }[] = [];

for (const size of sizes) {
  const grid = createMazeSetupGrid(size, size);
  const stats = measureDimacsSize(grid, 6, "octagon", 0, 0);
  sizeResults.push({ size, stats });
  printStats(`${size}x${size} Octagon Maze`, stats);
}

console.log("\n--- Grid Size Summary Table ---");
console.log("Size    | Variables    | Clauses      | DIMACS Size  | Gzipped");
console.log("--------|-------------|--------------|--------------|----------");
for (const { size, stats } of sizeResults) {
  console.log(
    `${size.toString().padStart(4)}x${size}  | ${stats.variables.toString().padStart(11)} | ${stats.clauses.toString().padStart(12)} | ${formatBytes(stats.dimacsBytes).padStart(12)} | ${formatBytes(stats.gzippedBytes)}`
  );
}

console.log("\n\n========================================");
console.log("ANALYSIS COMPLETE");
console.log("========================================");
