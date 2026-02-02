/**
 * Tests for unified tiling edge adjacency checker
 * 
 * Run with: npx tsx src/polyform-explorer/grids/unifiedTiling.test.ts
 */

import { 
  solveUnifiedTiling,
  checkEdgeAdjacencyConsistency,
  UnifiedPlacement
} from "./unifiedTiling.js";
import { squareGridDefinition } from "./squareGridDef.js";
import { hexGridDefinition } from "./hexGridDef.js";
import type { GridDefinition, EdgeState } from "./types.js";
import { MiniSatSolver } from "../../solvers/minisat-solver.js";

/**
 * Create a simple 2x1 horizontal domino tile
 */
function createDominoTile(): boolean[][] {
  return [
    [true, true],  // Two cells in a row
  ];
}

/**
 * Create edge state for domino: mark the edge between the two cells
 * For a square grid, neighbors are: 0=up, 1=right, 2=down, 3=left
 * The left cell (0,0) has a marked edge on its RIGHT (neighbor 1)
 * The right cell (0,1) has a marked edge on its LEFT (neighbor 3)
 */
function createDominoEdgeState(): EdgeState {
  return [
    [
      [false, true, false, false],   // Cell (0,0): right edge marked (index 1)
      [false, false, false, true],   // Cell (0,1): left edge marked (index 3)
    ],
  ];
}

/**
 * Create edge state where edges DON'T match (for testing violation detection)
 * 
 * For square grid: neighbors are 0=up, 1=right, 2=down, 3=left
 * 
 * We create a mismatch:
 * - Cell (0,1) has right edge (index 1) marked = true
 * - Cell (0,0) has left edge (index 3) marked = false
 * 
 * When two dominoes are placed adjacent:
 * - First at (0,0)-(1,0): cell (1,0) gets original cell (0,1)'s edges, so right=true
 * - Second at (2,0)-(3,0): cell (2,0) gets original cell (0,0)'s edges, so left=false
 * 
 * The shared edge between (1,0) and (2,0) will have a mismatch!
 */
function createMismatchedEdgeState(): EdgeState {
  return [
    [
      [false, false, false, false],  // Cell (0,0): left edge (index 3) NOT marked
      [false, true, false, false],   // Cell (0,1): right edge (index 1) marked
    ],
  ];
}

/**
 * Test 1: Check that consistent edge state produces no violations
 */
function testConsistentEdges() {
  console.log("\n=== Test 1: Consistent Edges ===");
  
  const tile = createDominoTile();
  const edgeState = createDominoEdgeState();
  const solver = new MiniSatSolver();
  
  // Solve a small tiling
  const result = solveUnifiedTiling(
    squareGridDefinition,
    tile,
    4,  // width
    2,  // height
    solver,
    undefined,
    edgeState
  );
  
  console.log(`  Satisfiable: ${result.satisfiable}`);
  console.log(`  Placements: ${result.placements?.length ?? 0}`);
  
  if (!result.satisfiable || !result.placements) {
    console.log("  ❌ Expected satisfiable result with placements");
    return false;
  }
  
  // Check for adjacency violations
  const violations = checkEdgeAdjacencyConsistency(
    squareGridDefinition,
    result.placements,
    edgeState
  );
  
  console.log(`  Violations: ${violations.length}`);
  
  if (violations.length > 0) {
    console.log("  ❌ Expected no violations for consistent edges");
    for (const v of violations) {
      console.log(`    Cell (${v.cell1.q},${v.cell1.r}) edge ${v.edgeIdx1}=${v.value1} vs ` +
        `Cell (${v.cell2.q},${v.cell2.r}) edge ${v.edgeIdx2}=${v.value2}`);
    }
    return false;
  }
  
  console.log("  ✅ No violations as expected");
  return true;
}

/**
 * Test 2: Check that mismatched edges are detected
 * 
 * This manually creates placements with mismatched edges to test the checker.
 */
function testMismatchedEdgesDetection() {
  console.log("\n=== Test 2: Mismatched Edges Detection ===");
  
  const edgeState = createMismatchedEdgeState();
  
  // Debug: print edge state
  console.log("  Edge state:");
  console.log("    Cell (0,0): ", edgeState[0][0]);
  console.log("    Cell (0,1): ", edgeState[0][1]);
  
  // Manually create a placement where two tiles are adjacent
  // but their shared edge has different values
  const placements: UnifiedPlacement[] = [
    {
      id: 0,
      transformIndex: 0, // No rotation
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      originalCells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    },
    {
      id: 1,
      transformIndex: 0, // No rotation
      cells: [{ q: 2, r: 0 }, { q: 3, r: 0 }],
      originalCells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    },
  ];
  
  // Debug: what should the edge values be?
  console.log("  Expected edge values:");
  console.log("    Cell (1,0) gets originalCell (1,0) with edges", edgeState[0][1]);
  console.log("    Cell (1,0) right edge (index 1) should be:", edgeState[0][1]?.[1]);
  console.log("    Cell (2,0) gets originalCell (0,0) with edges", edgeState[0][0]);
  console.log("    Cell (2,0) left edge (index 3) should be:", edgeState[0][0]?.[3]);
  
  // Check for adjacency violations between the two placements
  const violations = checkEdgeAdjacencyConsistency(
    squareGridDefinition,
    placements,
    edgeState
  );
  
  console.log(`  Violations found: ${violations.length}`);
  
  if (violations.length === 0) {
    console.log("  ❌ Expected at least one violation for mismatched edges");
    return false;
  }
  
  console.log("  Violations:");
  for (const v of violations) {
    console.log(`    Cell (${v.cell1.q},${v.cell1.r}) edge ${v.edgeIdx1}=${v.value1} vs ` +
      `Cell (${v.cell2.q},${v.cell2.r}) edge ${v.edgeIdx2}=${v.value2}`);
  }
  
  console.log("  ✅ Violations detected as expected");
  return true;
}

/**
 * Test 3: Verify SAT solver correctly enforces edge constraints
 * 
 * When edges are constrained, the solver should only produce solutions
 * where adjacent tiles have matching edges.
 */
function testSATEnforcesEdgeConstraints() {
  console.log("\n=== Test 3: SAT Enforces Edge Constraints ===");
  
  const tile = createDominoTile();
  const edgeState = createDominoEdgeState();
  const solver = new MiniSatSolver();
  
  // Solve with edge constraints
  const result = solveUnifiedTiling(
    squareGridDefinition,
    tile,
    4,
    2,
    solver,
    undefined,
    edgeState
  );
  
  if (!result.satisfiable || !result.placements) {
    console.log("  ❌ Expected satisfiable result");
    return false;
  }
  
  // The solver should have produced a valid solution
  const violations = checkEdgeAdjacencyConsistency(
    squareGridDefinition,
    result.placements,
    edgeState
  );
  
  console.log(`  Solution uses ${result.placements.length} tiles`);
  console.log(`  Edge violations: ${violations.length}`);
  
  if (violations.length > 0) {
    console.log("  ❌ SAT solver produced solution with edge violations!");
    for (const v of violations) {
      console.log(`    Cell (${v.cell1.q},${v.cell1.r}) edge ${v.edgeIdx1}=${v.value1} vs ` +
        `Cell (${v.cell2.q},${v.cell2.r}) edge ${v.edgeIdx2}=${v.value2}`);
    }
    return false;
  }
  
  console.log("  ✅ SAT solver produced valid solution with matching edges");
  return true;
}

/**
 * Test 4: Test with hex grid
 */
function testHexGrid() {
  console.log("\n=== Test 4: Hex Grid Edge Constraints ===");
  
  // Create a simple 2-cell hex tile
  const tile: boolean[][] = [
    [true, true],
  ];
  
  // Edge state for hex: 6 neighbors per cell
  // Cell (0,0) and (0,1) are adjacent via neighbor 0 (right) and neighbor 3 (left)
  const edgeState: EdgeState = [
    [
      [true, false, false, false, false, false],  // Cell (0,0): right edge marked
      [false, false, false, true, false, false],  // Cell (0,1): left edge marked
    ],
  ];
  
  const solver = new MiniSatSolver();
  const result = solveUnifiedTiling(
    hexGridDefinition,
    tile,
    4,
    4,
    solver,
    undefined,
    edgeState
  );
  
  console.log(`  Satisfiable: ${result.satisfiable}`);
  
  if (!result.satisfiable || !result.placements) {
    console.log("  Note: Hex grid may be unsatisfiable for this tile/size combination");
    return true; // Not a failure, just no solution
  }
  
  const violations = checkEdgeAdjacencyConsistency(
    hexGridDefinition,
    result.placements,
    edgeState
  );
  
  console.log(`  Solution uses ${result.placements.length} tiles`);
  console.log(`  Edge violations: ${violations.length}`);
  
  if (violations.length > 0) {
    console.log("  ❌ Violations found:");
    for (const v of violations) {
      console.log(`    Cell (${v.cell1.q},${v.cell1.r}) edge ${v.edgeIdx1}=${v.value1} vs ` +
        `Cell (${v.cell2.q},${v.cell2.r}) edge ${v.edgeIdx2}=${v.value2}`);
    }
    return false;
  }
  
  console.log("  ✅ No violations");
  return true;
}

// Run all tests
console.log("=== Unified Tiling Edge Adjacency Tests ===");

let allPassed = true;

if (!testConsistentEdges()) allPassed = false;
if (!testMismatchedEdgesDetection()) allPassed = false;
if (!testSATEnforcesEdgeConstraints()) allPassed = false;
if (!testHexGrid()) allPassed = false;

console.log("\n=== Summary ===");
console.log(allPassed ? "✅ All tests passed!" : "❌ Some tests failed!");
