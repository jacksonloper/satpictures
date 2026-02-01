/**
 * Test for polyomino road transformations
 * 
 * Test case: A 3-cell vertical tile with one EXTERNAL road on the middle cell
 * - Tile cells: (0,0), (1,0), (2,0)
 * - Road: from (1,0) to exterior (1,-1) - the left edge of the middle cell
 * - Tiling grid: 2x1
 * - Expected: Two tiles covering the grid, with exactly one road between them
 *   (when the tiles are placed such that the road edges align)
 * 
 * Run with: npx tsx src/problem/polyomino-roads.test.ts
 */

import { 
  solvePolyominoTiling,
  generateAllPlacementsWithRoads,
  gridToCoords,
  type Placement,
  type Edge
} from "./polyomino-tiling.js";
import { MiniSatSolver } from "../solvers/minisat-solver.js";

/**
 * Create a 3-cell vertical tile: cells at (0,0), (1,0), (2,0)
 */
function createVertical3Tile(): boolean[][] {
  return [
    [true],   // row 0, col 0
    [true],   // row 1, col 0
    [true],   // row 2, col 0
  ];
}

/**
 * Road key for edge between (r1,c1) and (r2,c2)
 * Uses canonical ordering
 */
function makeEdgeKey(r1: number, c1: number, r2: number, c2: number): string {
  if (r1 < r2 || (r1 === r2 && c1 < c2)) {
    return `${r1},${c1}-${r2},${c2}`;
  }
  return `${r2},${c2}-${r1},${c1}`;
}

/**
 * Test the specific scenario:
 * - 3-cell vertical tile with one EXTERNAL road on the middle cell's left edge
 * - 2x1 tiling grid
 * - Should result in 2 tiles with 1 road between them (when placed correctly)
 */
function testVerticalTileWithExternalRoad() {
  console.log("=== Test: Vertical 3-tile with EXTERNAL road, 2x1 grid ===\n");
  
  const tile = createVertical3Tile();
  const tileCoords = gridToCoords(tile);
  
  console.log("Tile cells (normalized):", tileCoords.map(c => `(${c.row},${c.col})`).join(", "));
  
  // Road from (1,0) to exterior (1,-1) - the LEFT edge of the middle cell
  // This is an EXTERNAL road - it goes to a virtual neighbor outside the tile
  const roadKey = makeEdgeKey(1, -1, 1, 0);
  const roadKeys = [roadKey];
  
  console.log("Road:", roadKey, "(external edge on left of middle cell)");
  console.log("Tiling grid: 2 columns x 1 row\n");
  
  // First, let's see all possible placements WITH ROADS directly
  console.log("--- Calling generateAllPlacementsWithRoads directly ---");
  console.log("  tileCoords:", tileCoords);
  console.log("  roadKeys:", roadKeys);
  
  const placements = generateAllPlacementsWithRoads(tileCoords, 2, 1, roadKeys);
  
  console.log(`\nTotal placements generated: ${placements.length}\n`);
  
  // Count placements with roads
  const placementsWithRoads = placements.filter(p => p.roads && p.roads.length > 0);
  console.log(`Placements WITH roads: ${placementsWithRoads.length}`);
  console.log(`Placements WITHOUT roads: ${placements.length - placementsWithRoads.length}\n`);
  
  // Show all placements with their roads
  console.log("All placements:");
  for (const p of placements) {
    const cellsStr = p.cells.map(c => `(${c.row},${c.col})`).join(", ");
    const roadsStr = p.roads ? p.roads.map(e => 
      `(${e.cell1.row},${e.cell1.col})-(${e.cell2.row},${e.cell2.col})`
    ).join(", ") : "none";
    
    // Check which cells are in the grid [0,1) x [0,2)
    const cellsInGrid = p.cells.filter(c => c.row >= 0 && c.row < 1 && c.col >= 0 && c.col < 2);
    
    console.log(`  Placement ${p.id}: transform=${p.transformIndex}, offset=(${p.offset.row},${p.offset.col})`);
    console.log(`    Cells: ${cellsStr}`);
    console.log(`    Cells in grid: ${cellsInGrid.map(c => `(${c.row},${c.col})`).join(", ") || "none"}`);
    console.log(`    Roads: ${roadsStr}`);
  }
  
  // Now solve
  console.log("\n--- Solving ---\n");
  
  const solver = new MiniSatSolver();
  const result = solvePolyominoTiling(tile, 2, 1, solver, undefined, [roadKeys]);
  
  console.log(`Satisfiable: ${result.satisfiable}`);
  console.log(`Stats: ${result.stats.numPlacements} placements, ${result.stats.numVariables} vars, ${result.stats.numClauses} clauses`);
  
  if (result.satisfiable && result.placements) {
    console.log(`\nSolution uses ${result.placements.length} tile placements:`);
    
    // Collect all roads from the solution
    const allRoads: Edge[] = [];
    
    for (const p of result.placements) {
      const cellsStr = p.cells.map(c => `(${c.row},${c.col})`).join(", ");
      const cellsInGrid = p.cells.filter(c => c.row >= 0 && c.row < 1 && c.col >= 0 && c.col < 2);
      const roadsStr = p.roads ? p.roads.map(e => 
        `(${e.cell1.row},${e.cell1.col})-(${e.cell2.row},${e.cell2.col})`
      ).join(", ") : "none";
      
      console.log(`  Placement ${p.id}: transform=${p.transformIndex}, offset=(${p.offset.row},${p.offset.col})`);
      console.log(`    Cells: ${cellsStr}`);
      console.log(`    Cells in grid: ${cellsInGrid.map(c => `(${c.row},${c.col})`).join(", ")}`);
      console.log(`    Roads: ${roadsStr}`);
      
      if (p.roads) {
        allRoads.push(...p.roads);
      }
    }
    
    // Check for roads that connect cells in different placements
    console.log("\n--- Checking roads between placements ---\n");
    
    // Build a map of which placement owns which cell
    const cellOwner = new Map<string, Placement>();
    for (const p of result.placements) {
      for (const c of p.cells) {
        cellOwner.set(`${c.row},${c.col}`, p);
      }
    }
    
    // Check roads - find roads where the two endpoints are owned by different placements
    const roadsBetweenPlacements: Array<{edge: Edge, owner1: number, owner2: number}> = [];
    
    for (const p of result.placements) {
      if (!p.roads) continue;
      
      for (const road of p.roads) {
        const key1 = `${road.cell1.row},${road.cell1.col}`;
        const key2 = `${road.cell2.row},${road.cell2.col}`;
        
        const owner1 = cellOwner.get(key1);
        const owner2 = cellOwner.get(key2);
        
        // For external roads, one endpoint might not be owned by any placement
        // but could be claimed by another placement
        console.log(`  Road ${key1}-${key2}: owner1=${owner1?.id ?? 'none'}, owner2=${owner2?.id ?? 'none'}`);
        
        if (owner1 && owner2 && owner1.id !== owner2.id) {
          // This road connects two different placements!
          roadsBetweenPlacements.push({
            edge: road,
            owner1: owner1.id,
            owner2: owner2.id
          });
        }
      }
    }
    
    console.log(`\nRoads connecting different placements: ${roadsBetweenPlacements.length}`);
    for (const r of roadsBetweenPlacements) {
      console.log(`  (${r.edge.cell1.row},${r.edge.cell1.col})-(${r.edge.cell2.row},${r.edge.cell2.col}) connects placement ${r.owner1} and ${r.owner2}`);
    }
    
    console.log("\n=== EXPECTED vs ACTUAL ===\n");
    console.log(`Expected: 2 placements with 1 road connecting them`);
    console.log(`Actual: ${result.placements.length} placements with ${roadsBetweenPlacements.length} connecting roads`);
    
    if (result.placements.length === 2 && roadsBetweenPlacements.length === 1) {
      console.log("\n✅ TEST PASSED!");
      return true;
    } else {
      console.log("\n❌ TEST FAILED!");
      return false;
    }
  }
  
  return false;
}

// Run the test
console.log("=== Polyomino Road Transformation Test ===\n");
testVerticalTileWithExternalRoad();
