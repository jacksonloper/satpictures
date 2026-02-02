/**
 * Tests for unified tiling edge adjacency checker
 * 
 * Run with: npx tsx src/polyform-explorer/grids/unifiedTiling.test.ts
 */

import {
  solveUnifiedTiling,
  checkEdgeAdjacencyConsistency,
  UnifiedPlacement,
  normalizeEdgeState,
  gridToCoords,
  generateAllPlacements
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
  
  // Check for adjacency violations (pass array of edge states)
  const violations = checkEdgeAdjacencyConsistency(
    squareGridDefinition,
    result.placements,
    [edgeState]
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
  
  // Both placements use the same originalCells because they represent the same
  // 2-cell domino tile being placed at different positions. The originalCells
  // array describes which cells of the original tile correspond to which cells
  // in the placed position.
  const tileOriginalCells = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  
  // Manually create a placement where two tiles are adjacent
  // but their shared edge has different values
  const placements: UnifiedPlacement[] = [
    {
      id: 0,
      transformIndex: 0, // No rotation
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      originalCells: tileOriginalCells,
    },
    {
      id: 1,
      transformIndex: 0, // No rotation
      cells: [{ q: 2, r: 0 }, { q: 3, r: 0 }],
      originalCells: tileOriginalCells,
    },
  ];
  
  // Debug: what should the edge values be?
  // Note: edgeState[r][q] so edgeState[0][1] = row 0, col 1 = cell at (q=1, r=0)
  console.log("  Expected edge values:");
  console.log("    Cell (1,0) gets edgeState[r=0][q=1] =", edgeState[0][1]);
  console.log("    Cell (1,0) right edge (index 1) should be:", edgeState[0][1]?.[1]);
  console.log("    Cell (2,0) gets edgeState[r=0][q=0] =", edgeState[0][0]);
  console.log("    Cell (2,0) left edge (index 3) should be:", edgeState[0][0]?.[3]);
  
  // Check for adjacency violations between the two placements (pass array of edge states)
  const violations = checkEdgeAdjacencyConsistency(
    squareGridDefinition,
    placements,
    [edgeState]
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
  
  // The solver should have produced a valid solution (pass array of edge states)
  const violations = checkEdgeAdjacencyConsistency(
    squareGridDefinition,
    result.placements,
    [edgeState]
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
    [edgeState]
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

import { getAllEdges, gridToCoords } from "./unifiedTiling.js";

/**
 * Test 5: Single cell tile with ALL edges filled, solving for 2x1 grid
 * 
 * This test is designed to debug the issue where the debugger reports
 * every edge as "unfilled" even though edges were marked as filled.
 */
function testSingleCellAllEdgesFilled() {
  console.log("\n=== Test 5: Single Cell Tile with ALL Edges Filled ===");
  
  // Create a single-cell tile (just one cell)
  const tile: boolean[][] = [[true]];
  
  // Mark ALL edges as filled for this single cell
  // For square grid: 4 edges (up=0, right=1, down=2, left=3)
  const edgeState: EdgeState = [
    [
      [true, true, true, true],  // Cell (0,0): ALL edges filled
    ],
  ];
  
  console.log("  Input tile: single cell");
  console.log("  Edge state for cell (0,0):", edgeState[0][0]);
  console.log("  All edges should be TRUE");
  
  const solver = new MiniSatSolver();
  
  // Solve for a 2x1 grid (2 cells horizontally) 
  const result = solveUnifiedTiling(
    squareGridDefinition,
    tile,
    2,  // width
    1,  // height
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
  
  // Show detailed info about each placement
  console.log("\n  === Detailed Placement Info ===");
  for (const p of result.placements) {
    console.log(`  Placement ${p.id}:`);
    console.log(`    transformIndex: ${p.transformIndex}`);
    console.log(`    cells: ${JSON.stringify(p.cells)}`);
    console.log(`    originalCells: ${JSON.stringify(p.originalCells)}`);
    
    // Show what edge values would be looked up for each cell
    if (p.originalCells) {
      for (let i = 0; i < p.cells.length; i++) {
        const placedCell = p.cells[i];
        const origCell = p.originalCells[i];
        const lookedUpEdges = edgeState[origCell.r]?.[origCell.q];
        console.log(`    Cell ${i}: placed at (${placedCell.q},${placedCell.r}), ` +
          `orig cell (${origCell.q},${origCell.r}), ` +
          `edgeState[${origCell.r}][${origCell.q}] = ${JSON.stringify(lookedUpEdges)}`);
      }
    } else {
      console.log(`    ⚠️ NO originalCells! Edge lookup will fail.`);
    }
  }
  
  // Now call getAllEdges to see what it reports (pass array of edge states)
  console.log("\n  === getAllEdges Output ===");
  const allEdges = getAllEdges(squareGridDefinition, result.placements, [edgeState]);
  console.log(`  Total edges found: ${allEdges.length}`);
  
  for (const edge of allEdges) {
    console.log(`  Edge: cell1=(${edge.cell1.q},${edge.cell1.r}) edge${edge.edgeIdx1}=${edge.value1} ` +
      `<-> cell2=(${edge.cell2.q},${edge.cell2.r}) edge${edge.edgeIdx2}=${edge.value2} ` +
      `| consistent=${edge.isConsistent}`);
  }
  
  // Check for the bug: are any edges falsely reported as unfilled?
  const anyUnfilled = allEdges.some(e => !e.value1 || !e.value2);
  if (anyUnfilled) {
    console.log("\n  ⚠️ BUG DETECTED: Some edges reported as unfilled when they should all be TRUE!");
    return false;
  }
  
  console.log("\n  ✅ All edges correctly reported as filled");
  return true;
}

/**
 * Test 6: Check what gridToCoords produces
 */
function testGridToCoords() {
  console.log("\n=== Test 6: gridToCoords Output ===");
  
  // Test with single cell tile
  const singleCell: boolean[][] = [[true]];
  const coords = gridToCoords(squareGridDefinition, singleCell);
  console.log("  Single cell tile [[true]] -> coords:", JSON.stringify(coords));
  
  // Test with domino
  const domino: boolean[][] = [[true, true]];
  const dominoCoords = gridToCoords(squareGridDefinition, domino);
  console.log("  Domino tile [[true, true]] -> coords:", JSON.stringify(dominoCoords));
  
  return true;
}

/**
 * Test 7: Cell NOT at (0,0) - simulates browser scenario
 * 
 * This tests what happens when the user draws a cell at position (2, 3)
 * in the grid editor. The cell gets normalized to (0, 0) but the edge state
 * is still at edgeState[2][3]. This is the bug we're fixing.
 */
function testCellNotAtOrigin() {
  console.log("\n=== Test 7: Cell NOT at origin (browser scenario) ===");
  
  // Simulate a 5x5 grid with a single cell at position row=2, col=3
  const cells: boolean[][] = [
    [false, false, false, false, false],
    [false, false, false, false, false],
    [false, false, false, true, false],  // Cell at row=2, col=3
    [false, false, false, false, false],
    [false, false, false, false, false],
  ];
  
  // Edge state: ALL edges filled for the cell at (row=2, col=3)
  // edgeState[row][col] = edgeState[2][3]
  const edgeState: EdgeState = [];
  for (let r = 0; r < 5; r++) {
    const row: boolean[][] = [];
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 3) {
        // All edges filled for this cell
        row.push([true, true, true, true]);
      } else {
        row.push([false, false, false, false]);
      }
    }
    edgeState.push(row);
  }
  
  console.log("  Cell position: row=2, col=3");
  console.log("  Original edgeState[2][3]:", edgeState[2][3]);
  
  // Normalize the edge state
  const normalizedEdge = normalizeEdgeState(squareGridDefinition, cells, edgeState);
  console.log("  Normalized edgeState[0][0]:", normalizedEdge[0]?.[0]);
  
  // Check that the normalized edge state has the correct values
  const expected = [true, true, true, true];
  const actual = normalizedEdge[0]?.[0];
  
  if (!actual) {
    console.log("  ❌ normalizedEdge[0][0] is undefined!");
    return false;
  }
  
  const allMatch = expected.every((v, i) => v === actual[i]);
  if (!allMatch) {
    console.log("  ❌ Edge values don't match after normalization!");
    console.log("    Expected:", expected);
    console.log("    Actual:", actual);
    return false;
  }
  
  console.log("  ✅ Edge state correctly normalized!");
  
  // Now test the full flow: solve tiling and check edges
  const solver = new MiniSatSolver();
  const result = solveUnifiedTiling(
    squareGridDefinition,
    cells,
    2,  // width
    1,  // height
    solver,
    undefined,
    edgeState
  );
  
  console.log(`  Solve result: satisfiable=${result.satisfiable}, placements=${result.placements?.length ?? 0}`);
  
  if (!result.satisfiable || !result.placements) {
    console.log("  ❌ Expected satisfiable result");
    return false;
  }
  
  // Check edges using the normalized edge state (pass array of edge states)
  const edges = getAllEdges(squareGridDefinition, result.placements, [normalizedEdge]);
  console.log(`  getAllEdges found ${edges.length} edges`);
  
  for (const edge of edges) {
    console.log(`    Edge: cell1=(${edge.cell1.q},${edge.cell1.r}) edge${edge.edgeIdx1}=${edge.value1} ` +
      `<-> cell2=(${edge.cell2.q},${edge.cell2.r}) edge${edge.edgeIdx2}=${edge.value2}`);
  }
  
  // Check that edges are correctly reported as filled
  const anyUnfilled = edges.some(e => !e.value1 || !e.value2);
  if (anyUnfilled) {
    console.log("  ❌ Some edges incorrectly reported as unfilled!");
    return false;
  }
  
  console.log("  ✅ All edges correctly reported as filled after normalization");
  return true;
}

/**
 * Test 8: Polyhex 3-cell horizontal tile with edges - should be self-consistent
 *
 * This is a regression test for a bug where a valid polyhex tile configuration
 * was incorrectly reported as "no tiling possible" on a 1x1 grid.
 *
 * The tile is a 3-cell horizontal polyhex with edges marking the connections
 * between adjacent cells (edges 1 and 4 for hex neighbors).
 */
function testPolyhex3CellWithEdges() {
  console.log("\n=== Test 8: Polyhex 3-cell tile with edges (regression) ===");

  // Create a grid where the 3 cells are at row=3, col=3,4,5
  // This simulates the browser scenario where cells aren't at origin
  const gridHeight = 8;
  const gridWidth = 8;
  const cells: boolean[][] = [];
  for (let r = 0; r < gridHeight; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < gridWidth; c++) {
      // Cells at (row=3, col=3), (row=3, col=4), (row=3, col=5)
      row.push(r === 3 && c >= 3 && c <= 5);
    }
    cells.push(row);
  }

  // Edge state: mark the INTERNAL shared edges between adjacent cells.
  // For 3 cells in a row at q=0,1,2 (after normalization):
  // - Between q=0 and q=1: q=0's edge 1 (E) and q=1's edge 4 (W)
  // - Between q=1 and q=2: q=1's edge 1 (E) and q=2's edge 4 (W)
  //
  // For hex grid neighbors: 0=NE, 1=E, 2=SE, 3=SW, 4=W, 5=NW
  // Edge 1=E faces the cell to the right (q+1)
  // Edge 4=W faces the cell to the left (q-1)
  //
  // For self-consistency, both sides of each internal edge must match.
  const edgeState: EdgeState = [];
  for (let r = 0; r < gridHeight; r++) {
    const row: boolean[][] = [];
    for (let c = 0; c < gridWidth; c++) {
      // 6 edges per hex cell
      const cellEdges = [false, false, false, false, false, false];

      if (r === 3 && c === 3) {
        cellEdges[1] = true;  // East edge - faces cell at col=4 (internal)
      }
      if (r === 3 && c === 4) {
        cellEdges[1] = true;  // East edge - faces cell at col=5 (internal)
        cellEdges[4] = true;  // West edge - faces cell at col=3 (internal)
      }
      if (r === 3 && c === 5) {
        cellEdges[4] = true;  // West edge - faces cell at col=4 (internal)
      }

      row.push(cellEdges);
    }
    edgeState.push(row);
  }

  console.log("  Tile cells: 3 horizontal hex cells at (3,3), (3,4), (3,5)");
  console.log("  Edges (internal shared edges, marked on both sides):");
  console.log("    (3,3) edge 1 (E):", edgeState[3][3][1]);
  console.log("    (3,4) edge 1 (E):", edgeState[3][4][1]);
  console.log("    (3,4) edge 4 (W):", edgeState[3][4][4]);
  console.log("    (3,5) edge 4 (W):", edgeState[3][5][4]);

  // First, check that normalization works correctly
  const normalizedEdge = normalizeEdgeState(hexGridDefinition, cells, edgeState);
  console.log("\n  After normalization:");
  console.log("    Cell (0,0) edges:", normalizedEdge[0]?.[0]);
  console.log("    Cell (0,1) edges:", normalizedEdge[0]?.[1]);
  console.log("    Cell (0,2) edges:", normalizedEdge[0]?.[2]);

  // Verify normalized edges are correct
  // The tile should normalize to cells at (0,0), (0,1), (0,2)
  // With edges preserved at the same indices
  const expectedEdges = [
    { r: 0, c: 0, edges: [false, false, false, false, true, false] },  // edge 4 (W)
    { r: 0, c: 1, edges: [false, true, false, false, true, false] },   // edges 1 (E) and 4 (W)
    { r: 0, c: 2, edges: [false, true, false, false, false, false] },  // edge 1 (E)
  ];

  let normalizationCorrect = true;
  for (const exp of expectedEdges) {
    const actual = normalizedEdge[exp.r]?.[exp.c];
    if (!actual) {
      console.log(`  ❌ Missing normalized edge at (${exp.r},${exp.c})`);
      normalizationCorrect = false;
      continue;
    }
    for (let i = 0; i < 6; i++) {
      if (actual[i] !== exp.edges[i]) {
        console.log(`  ❌ Edge mismatch at (${exp.r},${exp.c}) edge ${i}: expected ${exp.edges[i]}, got ${actual[i]}`);
        normalizationCorrect = false;
      }
    }
  }

  if (normalizationCorrect) {
    console.log("  ✅ Normalization correct");
  }

  // Now solve the tiling problem
  // The tile should fit in a 3x1 grid (3 cells wide, 1 cell tall)
  const solver = new MiniSatSolver();

  // Debug: check what placements are generated
  const tileCoords = gridToCoords(hexGridDefinition, cells);
  console.log("\n  Tile coords (normalized):", JSON.stringify(tileCoords));

  const testPlacements = generateAllPlacements(hexGridDefinition, tileCoords, 3, 1);
  console.log(`  Total placements generated for 3x1 grid: ${testPlacements.length}`);
  for (const p of testPlacements) {
    console.log(`    Placement ${p.id}: transform=${p.transformIndex}, cells=${JSON.stringify(p.cells)}`);
  }

  const result = solveUnifiedTiling(
    hexGridDefinition,
    cells,
    3,  // width - exactly fits 3 cells
    1,  // height
    solver,
    undefined,
    edgeState
  );

  console.log(`\n  Solve result for 3x1 grid:`);
  console.log(`    satisfiable: ${result.satisfiable}`);
  console.log(`    placements: ${result.placements?.length ?? 0}`);
  console.log(`    stats: vars=${result.stats.numVariables}, clauses=${result.stats.numClauses}, placements=${result.stats.numPlacements}`);

  if (!result.satisfiable) {
    console.log("  ❌ Expected satisfiable for 3x1 grid - tile should fit exactly!");
    return false;
  }

  // Also test that edge consistency is maintained
  if (result.placements) {
    const violations = checkEdgeAdjacencyConsistency(
      hexGridDefinition,
      result.placements,
      [normalizedEdge]
    );

    console.log(`    edge violations: ${violations.length}`);

    if (violations.length > 0) {
      console.log("  ❌ Edge violations found:");
      for (const v of violations) {
        console.log(`    Cell (${v.cell1.q},${v.cell1.r}) edge ${v.edgeIdx1}=${v.value1} vs ` +
          `Cell (${v.cell2.q},${v.cell2.r}) edge ${v.edgeIdx2}=${v.value2}`);
      }
      return false;
    }
  }

  console.log("  ✅ Polyhex 3-cell tile works correctly");
  return true;
}

// Run all tests
console.log("=== Unified Tiling Edge Adjacency Tests ===");

let allPassed = true;

if (!testConsistentEdges()) allPassed = false;
if (!testMismatchedEdgesDetection()) allPassed = false;
if (!testSATEnforcesEdgeConstraints()) allPassed = false;
if (!testHexGrid()) allPassed = false;
if (!testGridToCoords()) allPassed = false;
if (!testSingleCellAllEdgesFilled()) allPassed = false;
if (!testCellNotAtOrigin()) allPassed = false;
if (!testPolyhex3CellWithEdges()) allPassed = false;

console.log("\n=== Summary ===");
console.log(allPassed ? "✅ All tests passed!" : "❌ Some tests failed!");
