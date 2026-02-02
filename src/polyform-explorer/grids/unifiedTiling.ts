/**
 * Unified Polyform Tiling SAT Solver
 * 
 * Uses the grid definitions to solve tiling problems for any grid type
 * (square, hex, triangle) without special casing.
 * 
 * The solver:
 * 1. Converts boolean[][] grid to normalized coordinates
 * 2. Generates all transforms using the grid's rotate/flip operations
 * 3. Generates all valid placements (transforms + translations)
 * 4. Builds SAT constraints (coverage + non-overlap + edge constraints)
 * 5. Solves and returns the solution
 */

import type { SATSolver } from "../../solvers/types";
import type { GridDefinition, Coord, EdgeState } from "./types";
import { generateAllTransforms, getBoundingBox, getForwardEdgePermutation } from "./types";

// Re-export types from separate file
export type { UnifiedPlacement, UnifiedTilingResult, EdgeAdjacencyViolation, EdgeInfo } from "./unifiedTilingTypes";

// Re-export utils
export { getCanonicalEdgeKey, gridToCoords, normalizeEdgeState, generateAllPlacements } from "./unifiedTilingUtils";

// Import types and utils for use in this file
import type { UnifiedPlacement, UnifiedTilingResult, EdgeAdjacencyViolation, EdgeInfo } from "./unifiedTilingTypes";
import { getCanonicalEdgeKey, gridToCoords, normalizeEdgeState, generateAllPlacements } from "./unifiedTilingUtils";

/**
 * Solve the tiling problem using a SAT solver.
 * 
 * Variables: 
 * - One boolean variable per placement (is this placement used?)
 * - One boolean variable per edge (shared between two cells, deduplicated by canonical key)
 * 
 * Constraints:
 * 1. Coverage: Each cell in the inner grid must be covered by at least one placement.
 * 2. Non-overlap: Each cell (including outer cells) can be covered by at most one placement.
 * 3. Edge implications: If a placement is active and has a marked edge, the edge variable must be true.
 *    This is: placement => edge, which is equivalent to: NOT(placement) OR edge
 */
export function solveUnifiedTiling(
  grid: GridDefinition,
  tilesInput: boolean[][] | boolean[][][],
  tilingWidth: number,
  tilingHeight: number,
  solver: SATSolver,
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void,
  edgeStateInput?: EdgeState | EdgeState[]
): UnifiedTilingResult {
  // Validate inputs
  if (tilingWidth < 1 || tilingHeight < 1 || !Number.isInteger(tilingWidth) || !Number.isInteger(tilingHeight)) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Normalize input: support both single tile (boolean[][]) and multiple tiles (boolean[][][])
  let tiles: boolean[][][];
  if (tilesInput.length === 0) {
    tiles = [];
  } else if (Array.isArray(tilesInput[0]?.[0])) {
    // It's a 3D array (boolean[][][]) - multiple tiles
    tiles = tilesInput as boolean[][][];
  } else {
    // It's a 2D array (boolean[][]) - single tile
    tiles = [tilesInput as boolean[][]];
  }
  
  // Normalize edge state input: support single tile or multiple tiles
  let edgeStates: EdgeState[] | undefined;
  if (edgeStateInput) {
    if (tiles.length === 1 && !Array.isArray(edgeStateInput[0]?.[0]?.[0])) {
      // Single tile - edgeStateInput is EdgeState (not EdgeState[])
      edgeStates = [edgeStateInput as EdgeState];
    } else {
      edgeStates = edgeStateInput as EdgeState[];
    }
  }
  
  // Convert each tile grid to normalized coordinates
  const allTileCoords: Coord[][] = tiles.map(cells => gridToCoords(grid, cells));
  
  // Normalize edge states to match normalized tile coordinates
  const normalizedEdgeStates: EdgeState[] | undefined = edgeStates 
    ? tiles.map((cells, i) => normalizeEdgeState(grid, cells, edgeStates![i]))
    : undefined;
  
  // Filter out empty tiles (and corresponding edge states)
  const nonEmptyIndices = allTileCoords
    .map((coords, i) => ({ coords, index: i }))
    .filter(({ coords }) => coords.length > 0)
    .map(({ index }) => index);
  
  const nonEmptyTileCoords = nonEmptyIndices.map(i => allTileCoords[i]);
  const nonEmptyEdgeStates = normalizedEdgeStates ? nonEmptyIndices.map(i => normalizedEdgeStates[i]) : undefined;
  
  if (nonEmptyTileCoords.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Generate all valid placements for each tile type
  let allPlacements: UnifiedPlacement[] = [];
  const placementsByTileType: number[][] = [];
  const placementTileTypeIndex: Map<number, number> = new Map();  // placementId -> tileTypeIndex
  let placementId = 0;
  let maxWidth = 0, maxHeight = 0;
  
  for (let tileTypeIdx = 0; tileTypeIdx < nonEmptyTileCoords.length; tileTypeIdx++) {
    const tileCoords = nonEmptyTileCoords[tileTypeIdx];
    
    // Get transforms for this tile to find max bounding box
    const allTransforms = generateAllTransforms(grid, tileCoords);
    
    for (const t of allTransforms) {
      const bb = getBoundingBox(t.coords);
      maxWidth = Math.max(maxWidth, bb.width);
      maxHeight = Math.max(maxHeight, bb.height);
    }
    
    // Generate placements for this tile
    const tilePlacements = generateAllPlacements(grid, tileCoords, tilingWidth, tilingHeight);
    
    // Track placement IDs for this tile type
    const tileTypePlacementIds: number[] = [];
    
    // Renumber IDs to be continuous across all tiles
    for (const p of tilePlacements) {
      p.id = placementId++;
      tileTypePlacementIds.push(p.id);
      placementTileTypeIndex.set(p.id, tileTypeIdx);
    }
    
    placementsByTileType.push(tileTypePlacementIds);
    allPlacements = allPlacements.concat(tilePlacements);
  }
  
  if (allPlacements.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Create SAT variables for each placement
  const placementVars: Map<number, number> = new Map();
  for (const p of allPlacements) {
    const varNum = solver.newVariable();
    placementVars.set(p.id, varNum);
  }
  
  // Build index: for each coordinate, which placements cover it?
  const outerMinRow = -maxHeight;
  const outerMaxRow = tilingHeight + maxHeight;
  const outerMinCol = -maxWidth;
  const outerMaxCol = tilingWidth + maxWidth;
  
  const cellToPlacements: Map<string, number[]> = new Map();
  
  for (const p of allPlacements) {
    for (const cell of p.cells) {
      const key = `${cell.q},${cell.r}`;
      if (!cellToPlacements.has(key)) {
        cellToPlacements.set(key, []);
      }
      cellToPlacements.get(key)!.push(p.id);
    }
  }
  
  // CONSTRAINT 1: Coverage - each cell in inner grid must be covered
  for (let r = 0; r < tilingHeight; r++) {
    for (let q = 0; q < tilingWidth; q++) {
      const key = `${q},${r}`;
      const coveringPlacements = cellToPlacements.get(key) || [];
      
      if (coveringPlacements.length === 0) {
        // No placement can cover this cell - UNSAT
        solver.addClause([]);
      } else {
        // At least one of these placements must be active
        const literals = coveringPlacements.map(pid => placementVars.get(pid)!);
        solver.addClause(literals);
      }
    }
  }
  
  // CONSTRAINT 2: Non-overlap - each cell can be covered by at most one placement
  for (let row = outerMinRow; row <= outerMaxRow; row++) {
    for (let col = outerMinCol; col <= outerMaxCol; col++) {
      const key = `${row},${col}`;
      const coveringPlacements = cellToPlacements.get(key) || [];
      
      // Pairwise: at most one
      for (let i = 0; i < coveringPlacements.length; i++) {
        for (let j = i + 1; j < coveringPlacements.length; j++) {
          const var1 = placementVars.get(coveringPlacements[i])!;
          const var2 = placementVars.get(coveringPlacements[j])!;
          solver.addClause([-var1, -var2]);
        }
      }
    }
  }
  
  // CONSTRAINT 3: Edge implications
  // If we have edge state, create edge variables and add implication clauses
  if (nonEmptyEdgeStates) {
    // Map from canonical edge key to SAT variable
    const edgeVars: Map<string, number> = new Map();
    
    // Get or create the SAT variable for an edge
    const getEdgeVar = (q: number, r: number, edgeIdx: number): number => {
      const key = getCanonicalEdgeKey(grid, q, r, edgeIdx);
      if (!edgeVars.has(key)) {
        edgeVars.set(key, solver.newVariable());
      }
      return edgeVars.get(key)!;
    };
    
    // For each placement, if it has marked edges, add implication clauses
    for (const p of allPlacements) {
      const tileTypeIdx = placementTileTypeIndex.get(p.id)!;
      const tileEdgeState = nonEmptyEdgeStates[tileTypeIdx];
      
      if (!tileEdgeState || !p.originalCells) continue;
      
      // Get the forward edge permutation for this transform
      // forwardPerm[originalEdgeIdx] = visualEdgeIdx
      const forwardPerm = getForwardEdgePermutation(grid, p.transformIndex);
      
      // For each cell in the placement
      for (let cellIdx = 0; cellIdx < p.cells.length; cellIdx++) {
        const placedCell = p.cells[cellIdx];
        const originalCell = p.originalCells[cellIdx];
        
        // Get the original cell's edges
        const originalEdges = tileEdgeState[originalCell.r]?.[originalCell.q];
        if (!originalEdges) continue;
        
        // For EVERY edge, add an implication: placement implies the edge value
        // If edge is marked: placement => edge (NOT(placement) OR edge)
        // If edge is not marked: placement => NOT edge (NOT(placement) OR NOT edge)
        for (let origEdgeIdx = 0; origEdgeIdx < originalEdges.length; origEdgeIdx++) {
          const isMarked = originalEdges[origEdgeIdx];
          
          // After the transform, the edge becomes a different edge index
          // forwardPerm[origEdgeIdx] gives the visual edge index after transformation
          const visualEdgeIdx = forwardPerm[origEdgeIdx];
          
          // Get the edge variable for this placed cell's edge
          const edgeVar = getEdgeVar(placedCell.q, placedCell.r, visualEdgeIdx);
          
          // Add implication clause
          const placementVar = placementVars.get(p.id)!;
          if (isMarked) {
            // placement => edge: NOT(placement) OR edge
            solver.addClause([-placementVar, edgeVar]);
          } else {
            // placement => NOT edge: NOT(placement) OR NOT edge
            solver.addClause([-placementVar, -edgeVar]);
          }
        }
      }
    }
  }
  
  const numVars = solver.getVariableCount();
  const numClauses = solver.getClauseCount();
  
  // Report stats before solving
  if (onStatsReady) {
    onStatsReady({ numVars, numClauses });
  }
  
  // Solve
  const result = solver.solve();
  
  if (!result.satisfiable) {
    return {
      satisfiable: false,
      stats: { numVariables: numVars, numClauses: numClauses, numPlacements: allPlacements.length },
    };
  }
  
  // Extract solution: which placements are used?
  const usedPlacements: UnifiedPlacement[] = [];
  const usedPlacementIds = new Set<number>();
  for (const p of allPlacements) {
    const varNum = placementVars.get(p.id)!;
    if (result.assignment.get(varNum)) {
      // Include tileTypeIndex in the placement for multi-tile edge lookup
      usedPlacements.push({
        ...p,
        tileTypeIndex: placementTileTypeIndex.get(p.id) ?? 0,
      });
      usedPlacementIds.add(p.id);
    }
  }
  
  // Count how many placements of each tile type were used
  const tileTypeCounts = placementsByTileType.map(tileTypePlacements => 
    tileTypePlacements.filter(pid => usedPlacementIds.has(pid)).length
  );
  
  return {
    satisfiable: true,
    placements: usedPlacements,
    stats: { numVariables: numVars, numClauses: numClauses, numPlacements: allPlacements.length },
    tileTypeCounts,
  };
}

/**
 * Validate that placements don't overlap.
 * Returns an array of overlap descriptions (empty array means no overlaps).
 */
export function findPlacementOverlaps(placements: UnifiedPlacement[]): string[] {
  const seen = new Map<string, { placementId: number; placementIndex: number }>();
  const overlaps: string[] = [];
  
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    for (const cell of p.cells) {
      const key = `${cell.q},${cell.r}`;
      const existing = seen.get(key);
      
      if (existing) {
        overlaps.push(
          `Cell (q=${cell.q}, r=${cell.r}) covered by placement ${existing.placementIndex} (id=${existing.placementId}) ` +
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
 * Check that edge markings agree at adjacencies in a tiling solution.
 *
 * When two cells are adjacent, the shared edge should have the same value
 * from both cells' perspectives. This function returns a list of all violations.
 *
 * @param grid Grid definition
 * @param placements The placements in the solution
 * @param edgeStates Array of edge states (one per tile type), indexed by tileTypeIndex
 * @returns Array of violations (empty if all edges agree)
 */
export function checkEdgeAdjacencyConsistency(
  grid: GridDefinition,
  placements: UnifiedPlacement[],
  edgeStates: EdgeState[]
): EdgeAdjacencyViolation[] {
  const violations: EdgeAdjacencyViolation[] = [];

  // Build map from cell coordinates to placement and transformed edge values
  type CellEdgeInfo = {
    placementIdx: number;
    edges: boolean[]; // Transformed edge values for this cell
  };
  const cellEdges = new Map<string, CellEdgeInfo>();

  for (let pIdx = 0; pIdx < placements.length; pIdx++) {
    const p = placements[pIdx];
    if (!p.originalCells) continue;

    // Get the correct edge state for this tile type
    const tileTypeIdx = p.tileTypeIndex ?? 0;
    const edgeState = edgeStates[tileTypeIdx];
    if (!edgeState) continue;

    // Get the forward permutation for this transform
    const forwardPerm = getForwardEdgePermutation(grid, p.transformIndex);

    for (let cellIdx = 0; cellIdx < p.cells.length; cellIdx++) {
      const placedCell = p.cells[cellIdx];
      const originalCell = p.originalCells[cellIdx];

      // Get original edge values
      const originalEdges = edgeState[originalCell.r]?.[originalCell.q];
      if (!originalEdges) continue;
      
      // Transform edge values using forward permutation
      const numEdges = grid.neighbors[grid.getCellType(placedCell)].length;
      const transformedEdges: boolean[] = new Array(numEdges).fill(false);
      
      for (let origIdx = 0; origIdx < originalEdges.length; origIdx++) {
        const visualIdx = forwardPerm[origIdx];
        transformedEdges[visualIdx] = originalEdges[origIdx];
      }
      
      const key = `${placedCell.q},${placedCell.r}`;
      cellEdges.set(key, { placementIdx: pIdx, edges: transformedEdges });
    }
  }
  
  // Check adjacencies: for each cell, check each neighbor
  for (const [key, info] of cellEdges) {
    const [qStr, rStr] = key.split(',');
    const q1 = parseInt(qStr, 10);
    const r1 = parseInt(rStr, 10);
    const cell1: Coord = { q: q1, r: r1 };
    
    const cellType = grid.getCellType(cell1);
    const neighbors = grid.neighbors[cellType];
    
    for (let edgeIdx1 = 0; edgeIdx1 < neighbors.length; edgeIdx1++) {
      const neighbor = neighbors[edgeIdx1];
      const q2 = q1 + neighbor.dq;
      const r2 = r1 + neighbor.dr;
      const neighborKey = `${q2},${r2}`;
      const cell2: Coord = { q: q2, r: r2 };
      
      const neighborInfo = cellEdges.get(neighborKey);
      if (!neighborInfo) continue; // No placement at neighbor
      
      // Find the edge index from neighbor's perspective that points back to cell1
      const neighborCellType = grid.getCellType(cell2);
      const neighborNeighbors = grid.neighbors[neighborCellType];
      let edgeIdx2 = -1;
      for (let i = 0; i < neighborNeighbors.length; i++) {
        if (q2 + neighborNeighbors[i].dq === q1 && r2 + neighborNeighbors[i].dr === r1) {
          edgeIdx2 = i;
          break;
        }
      }
      
      if (edgeIdx2 === -1) continue; // Shouldn't happen for valid grids
      
      // Check if edge values agree
      const value1 = info.edges[edgeIdx1] ?? false;
      const value2 = neighborInfo.edges[edgeIdx2] ?? false;
      
      if (value1 !== value2) {
        // Only report once per edge pair (use canonical ordering)
        if (r1 < r2 || (r1 === r2 && q1 < q2)) {
          violations.push({
            cell1,
            edgeIdx1,
            value1,
            cell2,
            edgeIdx2,
            value2,
            placementIdx1: info.placementIdx,
            placementIdx2: neighborInfo.placementIdx,
          });
        }
      }
    }
  }
  
  return violations;
}

/**
 * Get all edges (shared boundaries) in a tiling solution.
 *
 * This returns ALL edges, not just violations, so you can inspect any edge
 * in the solution to see its filledness from both sides.
 *
 * @param grid Grid definition
 * @param placements The placements in the solution
 * @param edgeStates Array of edge states (one per tile type), indexed by tileTypeIndex
 * @returns Array of all shared edges
 */
export function getAllEdges(
  grid: GridDefinition,
  placements: UnifiedPlacement[],
  edgeStates: EdgeState[]
): EdgeInfo[] {
  const edges: EdgeInfo[] = [];

  // Build map from cell coordinates to placement and transformed edge values
  type CellEdgeInfo = {
    placementIdx: number;
    edges: boolean[]; // Transformed edge values for this cell
  };
  const cellEdges = new Map<string, CellEdgeInfo>();

  for (let pIdx = 0; pIdx < placements.length; pIdx++) {
    const p = placements[pIdx];
    if (!p.originalCells) continue;

    // Get the correct edge state for this tile type
    const tileTypeIdx = p.tileTypeIndex ?? 0;
    const edgeState = edgeStates[tileTypeIdx];
    if (!edgeState) continue;

    // Get the forward permutation for this transform
    const forwardPerm = getForwardEdgePermutation(grid, p.transformIndex);

    for (let cellIdx = 0; cellIdx < p.cells.length; cellIdx++) {
      const placedCell = p.cells[cellIdx];
      const originalCell = p.originalCells[cellIdx];

      // Get original edge values
      const originalEdges = edgeState[originalCell.r]?.[originalCell.q];
      if (!originalEdges) continue;
      
      // Transform edge values using forward permutation
      const numEdges = grid.neighbors[grid.getCellType(placedCell)].length;
      const transformedEdges: boolean[] = new Array(numEdges).fill(false);
      
      for (let origIdx = 0; origIdx < originalEdges.length; origIdx++) {
        const visualIdx = forwardPerm[origIdx];
        transformedEdges[visualIdx] = originalEdges[origIdx];
      }
      
      const key = `${placedCell.q},${placedCell.r}`;
      cellEdges.set(key, { placementIdx: pIdx, edges: transformedEdges });
    }
  }
  
  // Collect all edges: for each cell, check each neighbor
  for (const [key, info] of cellEdges) {
    const [qStr, rStr] = key.split(',');
    const q1 = parseInt(qStr, 10);
    const r1 = parseInt(rStr, 10);
    const cell1: Coord = { q: q1, r: r1 };
    
    const cellType = grid.getCellType(cell1);
    const neighbors = grid.neighbors[cellType];
    
    for (let edgeIdx1 = 0; edgeIdx1 < neighbors.length; edgeIdx1++) {
      const neighbor = neighbors[edgeIdx1];
      const q2 = q1 + neighbor.dq;
      const r2 = r1 + neighbor.dr;
      const neighborKey = `${q2},${r2}`;
      const cell2: Coord = { q: q2, r: r2 };
      
      const neighborInfo = cellEdges.get(neighborKey);
      if (!neighborInfo) continue; // No placement at neighbor
      
      // Find the edge index from neighbor's perspective that points back to cell1
      const neighborCellType = grid.getCellType(cell2);
      const neighborNeighbors = grid.neighbors[neighborCellType];
      let edgeIdx2 = -1;
      for (let i = 0; i < neighborNeighbors.length; i++) {
        if (q2 + neighborNeighbors[i].dq === q1 && r2 + neighborNeighbors[i].dr === r1) {
          edgeIdx2 = i;
          break;
        }
      }
      
      if (edgeIdx2 === -1) continue; // Shouldn't happen for valid grids
      
      // Get edge values
      const value1 = info.edges[edgeIdx1] ?? false;
      const value2 = neighborInfo.edges[edgeIdx2] ?? false;
      
      // Only report once per edge pair (use canonical ordering)
      if (r1 < r2 || (r1 === r2 && q1 < q2)) {
        edges.push({
          cell1,
          edgeIdx1,
          value1,
          cell2,
          edgeIdx2,
          value2,
          isConsistent: value1 === value2,
          placementIdx1: info.placementIdx,
          placementIdx2: neighborInfo.placementIdx,
        });
      }
    }
  }
  
  return edges;
}
