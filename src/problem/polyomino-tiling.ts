/**
 * Polyomino Tiling SAT Solver
 * 
 * Uses CaDiCaL to attempt to tile a (W,H) grid with rotations/translations/flips
 * of a given polyomino tile.
 * 
 * For polyominos (square grid), there are 8 possible transforms:
 * - 4 rotations (0°, 90°, 180°, 270°)
 * - Each rotation can be flipped horizontally (giving 4 more)
 */

import type { SATSolver } from "../solvers/types";

/** A coordinate in the tiling grid */
export interface Coord {
  row: number;
  col: number;
}

/** A single placement of a tile at a position with a specific transform */
export interface Placement {
  /** Unique identifier for the placement */
  id: number;
  /** Translation offset (top-left corner of bounding box) */
  offset: Coord;
  /** Transform index (0-7 for polyomino) */
  transformIndex: number;
  /** Coordinates this placement covers (absolute, after transform and translation) */
  cells: Coord[];
}

/** Result of tiling attempt */
export interface TilingResult {
  satisfiable: boolean;
  /** Placements that are used in the solution (if SAT) */
  placements?: Placement[];
  /** Stats about the SAT problem */
  stats: {
    numVariables: number;
    numClauses: number;
    numPlacements: number;
  };
}

/**
 * Rotate a polyomino 90° clockwise.
 * Input: array of filled coordinates.
 * Output: new array of coordinates after rotation, normalized to top-left.
 */
function rotateCoords90(coords: Coord[]): Coord[] {
  if (coords.length === 0) return [];
  
  // Rotate: (row, col) -> (col, -row)
  // Then normalize to positive coordinates
  const rotated = coords.map(({ row, col }) => ({
    row: col,
    col: -row,
  }));
  
  // Normalize to start at (0,0)
  let minRow = Infinity, minCol = Infinity;
  for (const c of rotated) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  return rotated.map(c => ({
    row: c.row - minRow,
    col: c.col - minCol,
  }));
}

/**
 * Flip a polyomino horizontally.
 * Input: array of filled coordinates.
 * Output: new array of coordinates after flip, normalized to top-left.
 */
function flipCoordsH(coords: Coord[]): Coord[] {
  if (coords.length === 0) return [];
  
  // Flip horizontally: (row, col) -> (row, -col)
  const flipped = coords.map(({ row, col }) => ({
    row,
    col: -col,
  }));
  
  // Normalize to start at (0,0)
  let minRow = Infinity, minCol = Infinity;
  for (const c of flipped) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  return flipped.map(c => ({
    row: c.row - minRow,
    col: c.col - minCol,
  }));
}

/**
 * Generate all 8 transforms of a polyomino tile.
 * Returns array of 8 coordinate sets (some may be duplicates for symmetric tiles).
 */
function generateAllTransforms(baseCells: Coord[]): Coord[][] {
  const transforms: Coord[][] = [];
  let current = baseCells;
  
  // 4 rotations
  for (let i = 0; i < 4; i++) {
    transforms.push(current);
    current = rotateCoords90(current);
  }
  
  // Flip and 4 more rotations
  current = flipCoordsH(baseCells);
  for (let i = 0; i < 4; i++) {
    transforms.push(current);
    current = rotateCoords90(current);
  }
  
  return transforms;
}

/**
 * Convert boolean[][] grid to array of coordinates of filled cells,
 * normalized to (0,0) at top-left of bounding box.
 */
export function gridToCoords(cells: boolean[][]): Coord[] {
  const coords: Coord[] = [];
  
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        coords.push({ row, col });
      }
    }
  }
  
  // Normalize to top-left
  if (coords.length === 0) return [];
  
  let minRow = Infinity, minCol = Infinity;
  for (const c of coords) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  return coords.map(c => ({
    row: c.row - minRow,
    col: c.col - minCol,
  }));
}

/**
 * Get bounding box dimensions of a set of coordinates.
 */
function getBoundingBox(coords: Coord[]): { width: number; height: number } {
  if (coords.length === 0) return { width: 0, height: 0 };
  
  let maxRow = -Infinity, maxCol = -Infinity;
  for (const c of coords) {
    maxRow = Math.max(maxRow, c.row);
    maxCol = Math.max(maxCol, c.col);
  }
  
  return { width: maxCol + 1, height: maxRow + 1 };
}

/**
 * Check if two coordinate sets are equal (considering order-independence).
 */
function coordSetsEqual(a: Coord[], b: Coord[]): boolean {
  if (a.length !== b.length) return false;
  
  const setA = new Set(a.map(c => `${c.row},${c.col}`));
  const setB = new Set(b.map(c => `${c.row},${c.col}`));
  
  if (setA.size !== setB.size) return false;
  for (const key of setA) {
    if (!setB.has(key)) return false;
  }
  return true;
}

/**
 * Remove duplicate transforms (for symmetric tiles).
 */
function deduplicateTransforms(transforms: Coord[][]): Coord[][] {
  const unique: Coord[][] = [];
  
  for (const transform of transforms) {
    let isDuplicate = false;
    for (const existing of unique) {
      if (coordSetsEqual(transform, existing)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      unique.push(transform);
    }
  }
  
  return unique;
}

/**
 * Generate all valid placements for tiling a (W,H) grid.
 * 
 * A placement is valid if it covers at least one cell in the inner (W,H) grid.
 * Placements can extend outside the inner grid (into a larger bounding area).
 */
export function generateAllPlacements(
  tileCoords: Coord[],
  tilingWidth: number,
  tilingHeight: number
): Placement[] {
  if (tileCoords.length === 0) return [];
  
  // Get all 8 transforms (may include duplicates for symmetric tiles)
  const allTransforms = generateAllTransforms(tileCoords);
  // Deduplicate for efficiency
  const transforms = deduplicateTransforms(allTransforms);
  
  // Find the maximum bounding box across all transforms
  let maxTransformWidth = 0;
  let maxTransformHeight = 0;
  for (const t of transforms) {
    const bb = getBoundingBox(t);
    maxTransformWidth = Math.max(maxTransformWidth, bb.width);
    maxTransformHeight = Math.max(maxTransformHeight, bb.height);
  }
  
  // A = maxTransformWidth, B = maxTransformHeight
  // We need to consider translations from (-A+1, -B+1) to (W-1, H-1)
  // so that a tile can cover any point in the inner grid
  const A = maxTransformWidth;
  const B = maxTransformHeight;
  
  const placements: Placement[] = [];
  let placementId = 0;
  
  for (let transformIndex = 0; transformIndex < transforms.length; transformIndex++) {
    const transformCoords = transforms[transformIndex];
    
    // Try all translations
    for (let offsetRow = -B + 1; offsetRow < tilingHeight; offsetRow++) {
      for (let offsetCol = -A + 1; offsetCol < tilingWidth; offsetCol++) {
        // Translate the coordinates
        const translatedCells = transformCoords.map(c => ({
          row: c.row + offsetRow,
          col: c.col + offsetCol,
        }));
        
        // Check if this placement covers at least one cell in the inner grid
        let coversInnerGrid = false;
        for (const cell of translatedCells) {
          if (cell.row >= 0 && cell.row < tilingHeight &&
              cell.col >= 0 && cell.col < tilingWidth) {
            coversInnerGrid = true;
            break;
          }
        }
        
        if (coversInnerGrid) {
          placements.push({
            id: placementId++,
            offset: { row: offsetRow, col: offsetCol },
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
 * 1. Coverage: Each cell in the inner (W,H) grid must be covered by at least one placement.
 * 2. Non-overlap: Each cell (including outer cells) can be covered by at most one placement.
 */
export function solvePolyominoTiling(
  tilesInput: boolean[][] | boolean[][][],
  tilingWidth: number,
  tilingHeight: number,
  solver: SATSolver,
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void
): TilingResult {
  // Validate inputs
  if (tilingWidth < 1 || tilingHeight < 1 || !Number.isInteger(tilingWidth) || !Number.isInteger(tilingHeight)) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Normalize input: support both single tile (boolean[][]) and multiple tiles (boolean[][][])
  const tiles: boolean[][][] = Array.isArray(tilesInput[0]?.[0]) 
    ? (tilesInput as boolean[][][])
    : [tilesInput as boolean[][]];
  
  // Convert each tile grid to normalized coordinates
  const allTileCoords: Coord[][] = tiles.map(cells => gridToCoords(cells));
  
  // Filter out empty tiles
  const nonEmptyTileCoords = allTileCoords.filter(coords => coords.length > 0);
  
  if (nonEmptyTileCoords.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Generate all valid placements for each tile type
  let allPlacements: Placement[] = [];
  let placementId = 0;
  let maxA = 0, maxB = 0; // Track max bounding box across all tiles
  
  for (const tileCoords of nonEmptyTileCoords) {
    // Get transforms for this tile
    const allTransforms = generateAllTransforms(tileCoords);
    
    // Track max bounding box
    for (const t of allTransforms) {
      const bb = getBoundingBox(t);
      maxA = Math.max(maxA, bb.width);
      maxB = Math.max(maxB, bb.height);
    }
    
    // Generate placements for this tile, with continuous ID sequence
    const tilePlacements = generateAllPlacements(tileCoords, tilingWidth, tilingHeight);
    
    // Renumber IDs to be continuous across all tiles
    for (const p of tilePlacements) {
      p.id = placementId++;
    }
    
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
  // Outer grid is (W + 2A) x (H + 2B), offset by (-A, -B)
  const outerMinRow = -maxB;
  const outerMaxRow = tilingHeight + maxB - 1;
  const outerMinCol = -maxA;
  const outerMaxCol = tilingWidth + maxA - 1;
  
  const cellToPlacements: Map<string, number[]> = new Map();
  
  for (const p of allPlacements) {
    for (const cell of p.cells) {
      const key = `${cell.row},${cell.col}`;
      if (!cellToPlacements.has(key)) {
        cellToPlacements.set(key, []);
      }
      cellToPlacements.get(key)!.push(p.id);
    }
  }
  
  // CONSTRAINT 1: Coverage - each cell in inner grid must be covered
  // For each inner cell, at least one placement must cover it
  for (let row = 0; row < tilingHeight; row++) {
    for (let col = 0; col < tilingWidth; col++) {
      const key = `${row},${col}`;
      const coveringPlacements = cellToPlacements.get(key) || [];
      
      if (coveringPlacements.length === 0) {
        // No placement can cover this cell - UNSAT
        // Add empty clause to force UNSAT
        solver.addClause([]);
      } else {
        // At least one of these placements must be active
        const literals = coveringPlacements.map(pid => placementVars.get(pid)!);
        solver.addClause(literals);
      }
    }
  }
  
  // CONSTRAINT 2: Non-overlap - each cell can be covered by at most one placement
  // For each cell in the outer grid, for all pairs of placements covering it,
  // add clause: NOT p1 OR NOT p2
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
  const usedPlacements: Placement[] = [];
  for (const p of allPlacements) {
    const varNum = placementVars.get(p.id)!;
    if (result.assignment.get(varNum)) {
      usedPlacements.push(p);
    }
  }
  
  return {
    satisfiable: true,
    placements: usedPlacements,
    stats: { numVariables: numVars, numClauses: numClauses, numPlacements: allPlacements.length },
  };
}
