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

/** Represents an edge between two adjacent cells (sorted canonical form) */
export interface Edge {
  cell1: Coord;
  cell2: Coord;
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
  /** Road edges in this placement (absolute, after transform and translation) */
  roads?: Edge[];
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
  /** Count of placements used for each tile type (when multiple tiles) */
  tileTypeCounts?: number[];
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
 * Parse a road edge key string like "row1,col1-row2,col2" into coordinates.
 */
function parseEdgeKey(key: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const parts = key.split('-');
  if (parts.length !== 2) return null;
  const [p1, p2] = parts;
  const [r1, c1] = p1.split(',').map(Number);
  const [r2, c2] = p2.split(',').map(Number);
  if ([r1, c1, r2, c2].some(isNaN)) return null;
  return { r1, c1, r2, c2 };
}

/**
 * Apply a transform to road edges.
 * transformIndex: 0-7 (same as for cells)
 * - 0: identity
 * - 1: rotate 90° CW
 * - 2: rotate 180°
 * - 3: rotate 270°
 * - 4: flip H
 * - 5: flip H + rotate 90°
 * - 6: flip H + rotate 180°
 * - 7: flip H + rotate 270°
 */
function transformRoads(
  roadKeys: string[],
  transformIndex: number,
  originalBounds: { height: number; width: number }
): Edge[] {
  const edges: Edge[] = [];
  
  for (const key of roadKeys) {
    const parsed = parseEdgeKey(key);
    if (!parsed) continue;
    
    let { r1, c1, r2, c2 } = parsed;
    const h = originalBounds.height;
    const w = originalBounds.width;
    
    // Apply transform
    const doFlip = transformIndex >= 4;
    const rotations = transformIndex % 4;
    
    // Flip horizontally first (if needed)
    if (doFlip) {
      c1 = w - 1 - c1;
      c2 = w - 1 - c2;
    }
    
    // Apply rotations (each rotation: (r, c) -> (c, h-1-r) for 90° CW)
    // After each 90° rotation, height and width swap. The current height used
    // for the transform depends on how many rotations have been applied and
    // whether a flip was done first. For even rotation counts, use original h/w;
    // for odd counts, the dimensions have swapped.
    for (let i = 0; i < rotations; i++) {
      const currentH = (i % 2 === 0) 
        ? (doFlip ? w : h) 
        : (doFlip ? h : w);
      const nr1 = c1, nc1 = currentH - 1 - r1;
      const nr2 = c2, nc2 = currentH - 1 - r2;
      r1 = nr1; c1 = nc1;
      r2 = nr2; c2 = nc2;
    }
    
    // Normalize to get proper bounds after transform
    // Since cells also get normalized, we need to track the offset
    // This is handled in generateAllPlacementsWithRoads
    
    edges.push({
      cell1: { row: r1, col: c1 },
      cell2: { row: r2, col: c2 }
    });
  }
  
  return edges;
}

/**
 * Generate all 8 transforms of roads (matching cell transforms).
 */
function generateAllRoadTransforms(
  roadKeys: string[],
  coords: Coord[]
): Edge[][] {
  if (roadKeys.length === 0) {
    return Array(8).fill([]);
  }
  
  // Get bounds of the original coords
  const bb = getBoundingBox(coords);
  
  const transforms: Edge[][] = [];
  for (let i = 0; i < 8; i++) {
    transforms.push(transformRoads(roadKeys, i, bb));
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
 * Generate all valid placements with road edges for tiling a (W,H) grid.
 * 
 * A placement is valid if it covers at least one cell in the inner (W,H) grid.
 * Placements can extend outside the inner grid (into a larger bounding area).
 */
export function generateAllPlacementsWithRoads(
  tileCoords: Coord[],
  tilingWidth: number,
  tilingHeight: number,
  roadKeys: string[]
): Placement[] {
  if (tileCoords.length === 0) return [];
  
  // Get all 8 transforms for both cells and roads
  const allTransforms = generateAllTransforms(tileCoords);
  const allRoadTransforms = generateAllRoadTransforms(roadKeys, tileCoords);
  
  // For deduplication, we need to track which transforms are unique
  // We'll use indices to map back to original road transforms
  const uniqueIndices: number[] = [];
  const seenSets: Set<string>[] = [];
  
  for (let i = 0; i < allTransforms.length; i++) {
    const transform = allTransforms[i];
    const transformSet = new Set(transform.map(c => `${c.row},${c.col}`));
    let isDuplicate = false;
    
    for (const existing of seenSets) {
      if (transformSet.size === existing.size && [...transformSet].every(k => existing.has(k))) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      uniqueIndices.push(i);
      seenSets.push(transformSet);
    }
  }
  
  // Build the unique transforms with corresponding road transforms
  const transforms = uniqueIndices.map(i => allTransforms[i]);
  const roadTransforms = uniqueIndices.map(i => allRoadTransforms[i]);
  
  // Find the maximum bounding box across all transforms
  let maxTransformWidth = 0;
  let maxTransformHeight = 0;
  for (const t of transforms) {
    const bb = getBoundingBox(t);
    maxTransformWidth = Math.max(maxTransformWidth, bb.width);
    maxTransformHeight = Math.max(maxTransformHeight, bb.height);
  }
  
  // A = maxTransformWidth, B = maxTransformHeight
  const A = maxTransformWidth;
  const B = maxTransformHeight;
  
  const placements: Placement[] = [];
  let placementId = 0;
  
  for (let transformIndex = 0; transformIndex < transforms.length; transformIndex++) {
    const transformCoords = transforms[transformIndex];
    const transformRoads = roadTransforms[transformIndex];
    
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
          // Translate road edges too
          const translatedRoads: Edge[] = transformRoads.map(edge => ({
            cell1: { row: edge.cell1.row + offsetRow, col: edge.cell1.col + offsetCol },
            cell2: { row: edge.cell2.row + offsetRow, col: edge.cell2.col + offsetCol },
          }));
          
          placements.push({
            id: placementId++,
            offset: { row: offsetRow, col: offsetCol },
            transformIndex,
            cells: translatedCells,
            roads: translatedRoads.length > 0 ? translatedRoads : undefined,
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
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void,
  tileRoads?: string[][]
): TilingResult {
  // Validate inputs
  if (tilingWidth < 1 || tilingHeight < 1 || !Number.isInteger(tilingWidth) || !Number.isInteger(tilingHeight)) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Normalize input: support both single tile (boolean[][]) and multiple tiles (boolean[][][])
  // Check if the input is a 3D array (multiple tiles) or 2D array (single tile)
  // Handle edge cases: empty array, single tile with data, multiple tiles
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
  const allTileCoords: Coord[][] = tiles.map(cells => gridToCoords(cells));
  
  // Track original indices for tiles (to map roads correctly)
  const originalTileIndices: number[] = [];
  for (let i = 0; i < allTileCoords.length; i++) {
    if (allTileCoords[i].length > 0) {
      originalTileIndices.push(i);
    }
  }
  
  // Filter out empty tiles
  const nonEmptyTileCoords = allTileCoords.filter(coords => coords.length > 0);
  
  if (nonEmptyTileCoords.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Generate all valid placements for each tile type
  // Track which placements belong to each tile type (for counting in solution)
  let allPlacements: Placement[] = [];
  const placementsByTileType: number[][] = []; // placementsByTileType[tileIndex] = [placementId, ...]
  let placementId = 0;
  let maxA = 0, maxB = 0; // Track max bounding box across all tiles
  
  for (let tileIdx = 0; tileIdx < nonEmptyTileCoords.length; tileIdx++) {
    const tileCoords = nonEmptyTileCoords[tileIdx];
    const originalIdx = originalTileIndices[tileIdx];
    
    // Get roads for this tile (if provided)
    const roadKeys = tileRoads?.[originalIdx] ?? [];
    
    // Get transforms for this tile
    const allTransforms = generateAllTransforms(tileCoords);
    
    // Track max bounding box
    for (const t of allTransforms) {
      const bb = getBoundingBox(t);
      maxA = Math.max(maxA, bb.width);
      maxB = Math.max(maxB, bb.height);
    }
    
    // Generate placements for this tile, with continuous ID sequence
    const tilePlacements = roadKeys.length > 0
      ? generateAllPlacementsWithRoads(tileCoords, tilingWidth, tilingHeight, roadKeys)
      : generateAllPlacements(tileCoords, tilingWidth, tilingHeight);
    
    // Track placement IDs for this tile type (for counting in solution)
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
