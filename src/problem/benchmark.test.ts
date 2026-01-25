/**
 * Benchmark Test: Tree vs No-Tree SAT Encoding
 *
 * Compares the performance of:
 * - Old encoding (solveGridColoring): Connected component via spanning tree + bounded reachability
 * - New encoding (solveForestGridColoring): Tree-based with unary distance variables
 *
 * Test setup: 12x12 grid, maze-style with hatch border and min distance 70
 * 
 * KEY DIFFERENCE:
 * - Old encoding only enforces min distance IF target is reachable (can have 0 edges!)
 * - New encoding enforces tree connectivity, so all same-color cells MUST be connected
 */

import { solveGridColoring } from "./grid-coloring";
import { solveForestGridColoring } from "./forest-grid-solver";
import { HATCH_COLOR } from "./graph-types";
import type { ColorGrid, PathlengthConstraint, ColorRoots } from "./graph-types";

// Color constants
const RED = 0;

/**
 * Create a maze-style grid setup:
 * - Hatch border around the edges
 * - Single red cell as root at inner corner (1,1)
 * - Target cell also set to red (forces connectivity in old encoding)
 * - All other inner cells blank (solver decides)
 */
function createMazeSetup(size: number, minDistance: number): {
  grid: ColorGrid;
  pathlengthConstraints: PathlengthConstraint[];
  colorRoots: ColorRoots;
  rootCell: { row: number; col: number };
  targetCell: { row: number; col: number };
} {
  const colors: (number | null)[][] = [];
  
  for (let row = 0; row < size; row++) {
    const rowColors: (number | null)[] = [];
    for (let col = 0; col < size; col++) {
      // Border cells are hatch
      if (row === 0 || row === size - 1 || col === 0 || col === size - 1) {
        rowColors.push(HATCH_COLOR);
      } else {
        rowColors.push(null); // Blank - solver decides
      }
    }
    colors.push(rowColors);
  }
  
  // Set root cell to red at inner corner (1,1)
  const rootRow = 1;
  const rootCol = 1;
  colors[rootRow][rootCol] = RED;
  
  // Target cell for min distance at opposite inner corner
  // ALSO SET TO RED - this forces connectivity in old encoding
  const targetRow = size - 2;
  const targetCol = size - 2;
  colors[targetRow][targetCol] = RED;
  
  const grid: ColorGrid = { width: size, height: size, colors };
  
  // Pathlength constraint: target cell must be at least minDistance from root
  const pathlengthConstraints: PathlengthConstraint[] = [
    {
      id: "maze",
      root: { row: rootRow, col: rootCol },
      minDistances: {
        [`${targetRow},${targetCol}`]: minDistance,
      },
    },
  ];
  
  // Color roots for forest encoding
  const colorRoots: ColorRoots = {
    [String(RED)]: { row: rootRow, col: rootCol },
  };
  
  return {
    grid,
    pathlengthConstraints,
    colorRoots,
    rootCell: { row: rootRow, col: rootCol },
    targetCell: { row: targetRow, col: targetCol },
  };
}

/**
 * Run benchmark comparing tree vs no-tree encoding
 */
function runBenchmark(): void {
  const SIZE = 12;
  
  console.log("=".repeat(60));
  console.log("BENCHMARK: Tree vs No-Tree SAT Encoding");
  console.log("=".repeat(60));
  console.log(`Grid size: ${SIZE}x${SIZE}`);
  console.log(`Inner grid (excluding hatch border): ${SIZE-2}x${SIZE-2} = ${(SIZE-2)*(SIZE-2)} cells`);
  console.log("");
  console.log("NOTE: Both root and target cells are set to RED color,");
  console.log("which forces the old encoding to connect them via spanning tree.");
  console.log("");
  
  // Test 1: Small distance (both should handle)
  console.log("=".repeat(60));
  console.log("TEST 1: Min distance = 20");
  console.log("=".repeat(60));
  runSingleBenchmark(SIZE, 20);
  
  // Test 2: Medium distance
  console.log("\n");
  console.log("=".repeat(60));
  console.log("TEST 2: Min distance = 40");
  console.log("=".repeat(60));
  runSingleBenchmark(SIZE, 40);
  
  // Test 3: Large distance (old encoding may struggle)
  console.log("\n");
  console.log("=".repeat(60));
  console.log("TEST 3: Min distance = 70");
  console.log("=".repeat(60));
  runSingleBenchmark(SIZE, 70);
}

function runSingleBenchmark(size: number, minDistance: number): void {
  const { grid, pathlengthConstraints, colorRoots, rootCell, targetCell } = createMazeSetup(size, minDistance);
  
  console.log(`Root cell: (${rootCell.row}, ${rootCell.col})`);
  console.log(`Target cell: (${targetCell.row}, ${targetCell.col})`);
  console.log("");
  
  // ============================================
  // Benchmark OLD encoding (no-tree)
  // ============================================
  console.log("-".repeat(60));
  console.log("OLD ENCODING (Connected Component + Bounded Reachability)");
  console.log("-".repeat(60));
  
  const startOld = performance.now();
  let resultOld = null;
  let oldError: Error | null = null;
  
  try {
    resultOld = solveGridColoring(grid, 6, {
      gridType: "square",
      pathlengthConstraints,
    });
  } catch (e) {
    oldError = e as Error;
  }
  
  const endOld = performance.now();
  const timeOld = endOld - startOld;
  
  if (oldError) {
    console.log(`Status: ERROR - ${oldError.message}`);
  } else if (resultOld) {
    console.log(`Status: SATISFIABLE`);
    console.log(`Time: ${timeOld.toFixed(2)}ms`);
    console.log(`Kept edges: ${resultOld.keptEdges.length}`);
    console.log(`Wall edges: ${resultOld.wallEdges.length}`);
    
    // Verify distance from root to target via BFS
    if (resultOld.distanceLevels) {
      const mazeDistances = resultOld.distanceLevels["maze"];
      if (mazeDistances) {
        const targetDist = mazeDistances[targetCell.row][targetCell.col];
        console.log(`Distance from root to target: ${targetDist >= 0 ? targetDist : "unreachable"}`);
      }
    }
  } else {
    console.log(`Status: UNSATISFIABLE`);
    console.log(`Time: ${timeOld.toFixed(2)}ms`);
  }
  
  console.log("");
  
  // ============================================
  // Benchmark NEW encoding (tree)
  // ============================================
  console.log("-".repeat(60));
  console.log("NEW ENCODING (Tree with Unary Distance Variables)");
  console.log("-".repeat(60));
  
  const startNew = performance.now();
  let resultNew = null;
  let newError: Error | null = null;
  
  try {
    resultNew = solveForestGridColoring(grid, {
      gridType: "square",
      pathlengthConstraints,
      colorRoots,
    });
  } catch (e) {
    newError = e as Error;
  }
  
  const endNew = performance.now();
  const timeNew = endNew - startNew;
  
  if (newError) {
    console.log(`Status: ERROR - ${newError.message}`);
  } else if (resultNew) {
    console.log(`Status: SATISFIABLE`);
    console.log(`Time: ${timeNew.toFixed(2)}ms`);
    console.log(`Kept edges: ${resultNew.keptEdges.length}`);
    console.log(`Wall edges: ${resultNew.wallEdges.length}`);
    
    // Verify distance from root to target via BFS
    if (resultNew.distanceLevels) {
      const mazeDistances = resultNew.distanceLevels["maze"];
      if (mazeDistances) {
        const targetDist = mazeDistances[targetCell.row][targetCell.col];
        console.log(`Distance from root to target: ${targetDist >= 0 ? targetDist : "unreachable"}`);
      }
    }
  } else {
    console.log(`Status: UNSATISFIABLE`);
    console.log(`Time: ${timeNew.toFixed(2)}ms`);
  }
  
  console.log("");
  
  // ============================================
  // Summary
  // ============================================
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  
  if (oldError || newError) {
    console.log("One or both encodings failed with an error.");
  } else if (resultOld && resultNew) {
    const speedup = timeOld / timeNew;
    console.log(`Old encoding time: ${timeOld.toFixed(2)}ms`);
    console.log(`New encoding time: ${timeNew.toFixed(2)}ms`);
    if (speedup > 1) {
      console.log(`New encoding is ${speedup.toFixed(2)}x FASTER`);
    } else {
      console.log(`Old encoding is ${(1/speedup).toFixed(2)}x FASTER`);
    }
  } else if (!resultOld && !resultNew) {
    console.log("Both encodings returned UNSATISFIABLE");
    console.log(`Old encoding time: ${timeOld.toFixed(2)}ms`);
    console.log(`New encoding time: ${timeNew.toFixed(2)}ms`);
  } else {
    console.log("Results differ:");
    console.log(`Old encoding: ${resultOld ? "SAT" : "UNSAT"} (${timeOld.toFixed(2)}ms)`);
    console.log(`New encoding: ${resultNew ? "SAT" : "UNSAT"} (${timeNew.toFixed(2)}ms)`);
  }
  
  console.log("");
}

// Run the benchmark
runBenchmark();
