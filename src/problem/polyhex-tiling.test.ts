/**
 * Simple test for polyhex tiling - detecting overlaps with hook-shaped tile
 * 
 * Run with: npx tsx src/problem/polyhex-tiling.test.ts
 */

import { 
  hexGridToAxialCoords, 
  generateAllHexPlacements, 
  findHexPlacementOverlaps,
  solvePolyhexTiling,
  axialToOffset
} from "./polyhex-tiling.js";
import { MiniSatSolver } from "../solvers/minisat-solver.js";

/**
 * Create a hook-shaped polyhex in offset coordinates (odd-r).
 * Path: Start -> E -> E -> SE -> SW (5 cells total)
 */
function createHookShapedGrid(): boolean[][] {
  // Path: (0,0) -> E(0,1) -> E(0,2) -> SE(1,2) -> SW(2,2)
  const grid: boolean[][] = [
    [true, true, true],   // row 0: cells at col 0, 1, 2
    [false, false, true], // row 1: cell at col 2
    [false, false, true], // row 2: cell at col 2
  ];
  
  return grid;
}

/**
 * Check for overlaps in OFFSET coordinates (what the renderer sees)
 */
function findOverlapsInOffsetCoords(placements: ReturnType<typeof generateAllHexPlacements>): string[] {
  const seen = new Map<string, { placementId: number; placementIndex: number }>();
  const overlaps: string[] = [];
  
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    for (const cell of p.cells) {
      // Convert to offset coordinates
      const offset = axialToOffset(cell.q, cell.r);
      const key = `${offset.row},${offset.col}`;
      const existing = seen.get(key);
      
      if (existing) {
        overlaps.push(
          `Offset (row=${offset.row}, col=${offset.col}) covered by placement ${existing.placementIndex} (id=${existing.placementId}) ` +
          `and placement ${i} (id=${p.id})`
        );
      } else {
        seen.set(key, { placementId: p.id, placementIndex: i });
      }
    }
  }
  
  return overlaps;
}

/**
 * Test: Run SAT solver and check for overlaps in solution (both axial and offset coords)
 */
function testSATSolution(tilingWidth: number, tilingHeight: number) {
  console.log(`\n=== Testing ${tilingWidth}x${tilingHeight} grid ===`);
  
  const grid = createHookShapedGrid();
  const solver = new MiniSatSolver();
  const result = solvePolyhexTiling(grid, tilingWidth, tilingHeight, solver);
  
  console.log(`  Satisfiable: ${result.satisfiable}`);
  console.log(`  Stats: ${result.stats.numPlacements} placements, ${result.stats.numVariables} vars, ${result.stats.numClauses} clauses`);
  
  if (result.satisfiable && result.placements) {
    console.log(`  Solution uses ${result.placements.length} tiles`);
    
    // Check for overlaps in axial coordinates
    const axialOverlaps = findHexPlacementOverlaps(result.placements);
    
    // Check for overlaps in offset coordinates (what renderer sees)
    const offsetOverlaps = findOverlapsInOffsetCoords(result.placements);
    
    let hasError = false;
    
    if (axialOverlaps.length > 0) {
      console.log("\n❌ OVERLAPS IN AXIAL COORDS!");
      for (const overlap of axialOverlaps) {
        console.log(`  - ${overlap}`);
      }
      hasError = true;
    }
    
    if (offsetOverlaps.length > 0) {
      console.log("\n❌ OVERLAPS IN OFFSET COORDS (what renderer sees)!");
      for (const overlap of offsetOverlaps) {
        console.log(`  - ${overlap}`);
      }
      hasError = true;
    }
    
    if (hasError) {
      console.log("\nPlacement details:");
      for (const p of result.placements) {
        const offsetCells = p.cells.map(c => {
          const off = axialToOffset(c.q, c.r);
          return `(${off.row},${off.col})`;
        });
        console.log(`  Placement ${p.id}: transform=${p.transformIndex}, axial=${p.cells.map(c => `(${c.q},${c.r})`).join(',')}, offset=${offsetCells.join(',')}`);
      }
      return false;
    } else {
      console.log("  ✅ No overlaps");
      return true;
    }
  }
  return true;
}

/**
 * Additional test: Check that all placements generated have correct cells
 */
function testPlacementCellsConsistency() {
  console.log("\n=== Testing Placement Cells Consistency ===\n");
  
  const grid = createHookShapedGrid();
  const axialCoords = hexGridToAxialCoords(grid);
  
  console.log("Original tile (axial coords):");
  console.log("  ", axialCoords.map(c => `(${c.q},${c.r})`).join(", "));
  
  const placements = generateAllHexPlacements(axialCoords, 4, 4);
  console.log(`\nGenerated ${placements.length} placements for 4x4 grid`);
  
  // Group by transformIndex
  const byTransform = new Map<number, typeof placements>();
  for (const p of placements) {
    if (!byTransform.has(p.transformIndex)) {
      byTransform.set(p.transformIndex, []);
    }
    byTransform.get(p.transformIndex)!.push(p);
  }
  
  console.log("\nPlacements per transform:");
  for (const [idx, group] of [...byTransform.entries()].sort((a, b) => a[0] - b[0])) {
    // Get a representative cell set (normalized)
    if (group.length > 0) {
      const firstP = group[0];
      const normalizedCells = firstP.cells.map(c => ({
        q: c.q - firstP.offset.q,
        r: c.r - firstP.offset.r
      }));
      console.log(`  Transform ${idx}: ${group.length} placements, shape: ${normalizedCells.map(c => `(${c.q},${c.r})`).join(',')}`);
    }
  }
  
  // Verify that all placements with same transformIndex have same normalized shape
  let allConsistent = true;
  for (const [idx, group] of byTransform) {
    if (group.length > 1) {
      const reference = group[0];
      const refNormalized = reference.cells.map(c => ({
        q: c.q - reference.offset.q,
        r: c.r - reference.offset.r
      }));
      const refSet = new Set(refNormalized.map(c => `${c.q},${c.r}`));
      
      for (let i = 1; i < group.length; i++) {
        const p = group[i];
        const normalized = p.cells.map(c => ({
          q: c.q - p.offset.q,
          r: c.r - p.offset.r
        }));
        const pSet = new Set(normalized.map(c => `${c.q},${c.r}`));
        
        // Check if sets are equal
        if (refSet.size !== pSet.size || ![...refSet].every(k => pSet.has(k))) {
          console.log(`\n❌ Inconsistent shape for transform ${idx}!`);
          console.log(`  Reference (id=${reference.id}): ${[...refSet].join(', ')}`);
          console.log(`  Placement (id=${p.id}): ${[...pSet].join(', ')}`);
          allConsistent = false;
        }
      }
    }
  }
  
  if (allConsistent) {
    console.log("\n✅ All placements have consistent shapes within their transform index");
  }
}

// Run tests
console.log("=== Hook-shaped Polyhex Tiling Tests ===");

const grid = createHookShapedGrid();
console.log("\nHook shape (offset coords):");
for (let row = 0; row < grid.length; row++) {
  const rowStr = grid[row].map((v, col) => v ? 'X' : '.').join(' ');
  console.log(`  Row ${row}: ${rowStr}`);
}

const axialCoords = hexGridToAxialCoords(grid);
console.log("\nAxial coordinates (normalized):", axialCoords.map(c => `(${c.q},${c.r})`).join(", "));
console.log(`Total cells: ${axialCoords.length}`);

// Test various grid sizes
let allPassed = true;
for (const size of [3, 4, 5, 6, 8, 10]) {
  if (!testSATSolution(size, size)) {
    allPassed = false;
  }
}

// Test placement consistency
testPlacementCellsConsistency();

console.log("\n=== Summary ===");
console.log(allPassed ? "✅ All tests passed!" : "❌ Some tests failed!");


