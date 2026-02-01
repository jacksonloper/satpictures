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
 * 4. Builds SAT constraints (coverage + non-overlap)
 * 5. Solves and returns the solution
 */

import type { SATSolver } from "../../solvers/types";
import type { GridDefinition, Coord } from "./types";
import { normalizeCoords, generateAllTransforms, getBoundingBox, isInGrid } from "./types";

/** A single placement of a tile at a position with a specific transform */
export interface UnifiedPlacement {
  /** Unique identifier for the placement */
  id: number;
  /** Transform index (0 to 2*numRotations-1) */
  transformIndex: number;
  /** Coordinates this placement covers (absolute, after transform and translation) */
  cells: Coord[];
}

/** Result of tiling attempt */
export interface UnifiedTilingResult {
  satisfiable: boolean;
  /** Placements that are used in the solution (if SAT) */
  placements?: UnifiedPlacement[];
  /** Stats about the SAT problem */
  stats: {
    numVariables: number;
    numClauses: number;
    numPlacements: number;
  };
  /** Count of placements used for each tile type (when multiple tiles) */
  tileTypeCounts?: number[];
}

/**
 * Convert boolean[][] grid to array of coordinates of filled cells,
 * normalized according to the grid definition.
 */
export function gridToCoords(grid: GridDefinition, cells: boolean[][]): Coord[] {
  const coords: Coord[] = [];
  
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        // cells[row][col] corresponds to cells[r][q], so row=r, col=q
        coords.push({ q: col, r: row });
      }
    }
  }
  
  return normalizeCoords(grid, coords);
}

/**
 * Generate all valid placements for tiling a grid.
 * 
 * A placement is valid if it covers at least one cell in the inner grid.
 * Placements can extend outside the inner grid (into a larger bounding area).
 */
export function generateAllPlacements(
  grid: GridDefinition,
  tileCoords: Coord[],
  tilingWidth: number,
  tilingHeight: number
): UnifiedPlacement[] {
  if (tileCoords.length === 0) return [];
  
  // Get all unique transforms using the grid definition
  const allTransforms = generateAllTransforms(grid, tileCoords);
  
  // Find the maximum bounding box across all transforms
  let maxTransformWidth = 0;
  let maxTransformHeight = 0;
  for (const t of allTransforms) {
    const bb = getBoundingBox(t.coords);
    maxTransformWidth = Math.max(maxTransformWidth, bb.width);
    maxTransformHeight = Math.max(maxTransformHeight, bb.height);
  }
  
  const placements: UnifiedPlacement[] = [];
  let placementId = 0;
  
  // For grids with parity constraints (like triangles), we need to be careful
  // about which translations preserve valid positions.
  // 
  // For square and hex grids, we can translate by any amount.
  // For triangle grids, translations must preserve (q + r) % 2 parity.
  
  for (const { coords: transformCoords, transformIndex } of allTransforms) {
    // Try all translations that might cover the inner grid
    // We use a range that ensures all valid placements are found
    
    for (let offsetR = -maxTransformHeight + 1; offsetR < tilingHeight; offsetR++) {
      for (let offsetQ = -maxTransformWidth + 1; offsetQ < tilingWidth + maxTransformWidth; offsetQ++) {
        // For grids with parity (numCellTypes > 1), check if this translation is valid
        if (grid.numCellTypes > 1) {
          // For triangle grids, translation must preserve parity
          // (offsetQ + offsetR) must be even
          if ((offsetQ + offsetR) % 2 !== 0) {
            continue;
          }
        }
        
        // Translate the coordinates
        const translatedCells = transformCoords.map(c => ({
          q: c.q + offsetQ,
          r: c.r + offsetR,
        }));
        
        // Check if this placement covers at least one cell in the inner grid
        let coversInnerGrid = false;
        for (const cell of translatedCells) {
          if (isInGrid(cell, tilingWidth, tilingHeight)) {
            coversInnerGrid = true;
            break;
          }
        }
        
        if (coversInnerGrid) {
          placements.push({
            id: placementId++,
            transformIndex,
            cells: translatedCells,
          });
        }
      }
    }
  }
  
  return placements;
}

/**
 * Solve the tiling problem using a SAT solver.
 * 
 * Variables: One boolean variable per placement (is this placement used?)
 * 
 * Constraints:
 * 1. Coverage: Each cell in the inner grid must be covered by at least one placement.
 * 2. Non-overlap: Each cell (including outer cells) can be covered by at most one placement.
 */
export function solveUnifiedTiling(
  grid: GridDefinition,
  tilesInput: boolean[][] | boolean[][][],
  tilingWidth: number,
  tilingHeight: number,
  solver: SATSolver,
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void
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
  
  // Convert each tile grid to normalized coordinates
  const allTileCoords: Coord[][] = tiles.map(cells => gridToCoords(grid, cells));
  
  // Filter out empty tiles
  const nonEmptyTileCoords = allTileCoords.filter(coords => coords.length > 0);
  
  if (nonEmptyTileCoords.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Generate all valid placements for each tile type
  let allPlacements: UnifiedPlacement[] = [];
  const placementsByTileType: number[][] = [];
  let placementId = 0;
  let maxWidth = 0, maxHeight = 0;
  
  for (const tileCoords of nonEmptyTileCoords) {
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
      usedPlacements.push(p);
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
