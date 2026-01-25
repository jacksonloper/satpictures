/**
 * Benchmark Test: Tree vs No-Tree SAT Encoding
 *
 * Compares the performance of:
 * - Old encoding (solveGridColoring): Connected component via spanning tree + bounded reachability
 * - New encoding (solveForestGridColoring): Tree-based with unary distance variables
 *
 * Uses the ACTUAL implementations for accurate comparison.
 * 
 * Test setup: 12x12 grid, maze-style with hatch border and min distance constraints.
 */

import { HATCH_COLOR } from "./graph-types";
import type { ColorGrid, PathlengthConstraint, ColorRoots, GridType } from "./graph-types";
import { solveGridColoring } from "./grid-coloring";
import { solveForestGridColoring } from "./forest-grid-solver";
import { MiniSatSolver, MiniSatFormulaBuilder } from "../solvers";

// Color constants
const RED = 0;

/**
 * Create a maze-style grid setup matching the browser's createMazeSetupGrid
 */
function createMazeSetup(size: number, minDistance: number): {
  grid: ColorGrid;
  pathlengthConstraints: PathlengthConstraint[];
  colorRoots: ColorRoots;
  rootCell: { row: number; col: number };
  targetCell: { row: number; col: number };
} {
  const colors: (number | null)[][] = [];
  
  const middleRow = Math.floor(size / 2);
  const entranceCol = 0;
  const exitCol = size - 1;
  
  for (let row = 0; row < size; row++) {
    const rowColors: (number | null)[] = [];
    for (let col = 0; col < size; col++) {
      if (row === middleRow && col === entranceCol) {
        rowColors.push(RED);
      } else if (row === middleRow && col === exitCol) {
        rowColors.push(RED);
      } else if (row === 0 || row === size - 1 || col === 0 || col === size - 1) {
        rowColors.push(HATCH_COLOR);
      } else {
        rowColors.push(RED);  // Interior: all RED
      }
    }
    colors.push(rowColors);
  }
  
  const grid: ColorGrid = { width: size, height: size, colors };
  
  const pathlengthConstraints: PathlengthConstraint[] = [
    {
      id: "maze",
      root: { row: middleRow, col: entranceCol },
      minDistances: {
        [`${middleRow},${exitCol}`]: minDistance,
      },
    },
  ];
  
  const colorRoots: ColorRoots = {
    [String(RED)]: { row: middleRow, col: entranceCol },
  };
  
  return {
    grid,
    pathlengthConstraints,
    colorRoots,
    rootCell: { row: middleRow, col: entranceCol },
    targetCell: { row: middleRow, col: exitCol },
  };
}

/**
 * Run the OLD encoding using solveGridColoring (MiniSat)
 */
function runOldEncoding(
  grid: ColorGrid,
  pathlengthConstraints: PathlengthConstraint[],
  gridType: GridType = "square"
): { time: number; sat: boolean } {
  const solver = new MiniSatSolver();
  const builder = new MiniSatFormulaBuilder(solver);
  
  const start = performance.now();
  const solution = solveGridColoring(grid, 6, {
    solver,
    builder,
    gridType,
    pathlengthConstraints,
  });
  const end = performance.now();
  
  return {
    time: end - start,
    sat: solution !== null,
  };
}

/**
 * Run the NEW encoding using solveForestGridColoring (MiniSat)
 */
function runNewEncoding(
  grid: ColorGrid,
  colorRoots: ColorRoots,
  pathlengthConstraints: PathlengthConstraint[],
  gridType: GridType = "square"
): { time: number; sat: boolean } {
  const start = performance.now();
  const solution = solveForestGridColoring(grid, {
    gridType,
    pathlengthConstraints,
    colorRoots,
  });
  const end = performance.now();
  
  return {
    time: end - start,
    sat: solution !== null,
  };
}

/**
 * Run benchmark
 */
function runBenchmark(): void {
  const SIZE = 12;
  const MIN_DISTANCE = 70;  // User requested: minDistance = 70
  
  console.log("=".repeat(60));
  console.log("BENCHMARK: Tree vs No-Tree SAT Encoding");
  console.log("=".repeat(60));
  console.log(`Grid size: ${SIZE}x${SIZE}`);
  console.log(`Min distance: ${MIN_DISTANCE}`);
  console.log("");
  
  const { grid, pathlengthConstraints, colorRoots, rootCell, targetCell } = createMazeSetup(SIZE, MIN_DISTANCE);
  
  console.log(`Root cell: (${rootCell.row}, ${rootCell.col})`);
  console.log(`Target cell: (${targetCell.row}, ${targetCell.col})`);
  console.log("");
  
  // Test OLD encoding
  console.log("-".repeat(60));
  console.log("OLD ENCODING (solveGridColoring with MiniSat):");
  console.log("-".repeat(60));
  
  try {
    const oldResult = runOldEncoding(grid, pathlengthConstraints);
    console.log(`  Result: ${oldResult.sat ? 'SAT' : 'UNSAT'}`);
    console.log(`  Time: ${oldResult.time.toFixed(0)}ms`);
  } catch (e) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : e}`);
  }
  console.log("");
  
  // Test NEW encoding  
  console.log("-".repeat(60));
  console.log("NEW ENCODING (solveForestGridColoring with MiniSat):");
  console.log("-".repeat(60));
  
  try {
    const newResult = runNewEncoding(grid, colorRoots, pathlengthConstraints);
    console.log(`  Result: ${newResult.sat ? 'SAT' : 'UNSAT'}`);
    console.log(`  Time: ${newResult.time.toFixed(0)}ms`);
  } catch (e) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : e}`);
  }
}

// Run the benchmark
runBenchmark();
