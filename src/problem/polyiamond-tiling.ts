/**
 * Polyiamond Tiling SAT Solver
 * 
 * Uses CaDiCaL to attempt to tile a triangle grid with rotations/translations/flips
 * of a given polyiamond tile.
 * 
 * For polyiamond (triangle grid), there are 12 possible transforms:
 * - 6 rotations (0°, 60°, 120°, 180°, 240°, 300°)
 * - Each rotation can be flipped (giving 6 more)
 * 
 * Coordinate system:
 * - Storage: (row, col) where triangles tessellate with alternating orientation
 * - Triangle orientation: (row + col) % 2 === 0 means UP-pointing, otherwise DOWN-pointing
 * - Transformations: done via lattice-vertex coordinates for correctness (handles parity!)
 * 
 * PARITY IS CRITICAL:
 * The triangle at (row, col) is up-pointing if (row + col) is even, down-pointing if odd.
 * When we transform triangles, we must preserve this parity relationship.
 * We use a vertex-based transform approach (matching polyformTransforms.ts) that correctly
 * handles the parity by treating each triangle as 3 lattice vertices.
 */

import type { SATSolver } from "../solvers/types";

/** A coordinate in the triangle tiling grid (storage coords) */
export interface TriCoord {
  row: number;
  col: number;
}

/** Integer vertex coordinates (half-edge coords) for lattice-vertex transforms */
interface Vertex {
  X: number;
  Y: number;
}

/** Lattice UV coordinates for geometric transforms */
interface UV {
  u: number;
  v: number;
}

/** A single placement of a triangle tile at a position with a specific transform */
export interface TriPlacement {
  /** Unique identifier for the placement */
  id: number;
  /** Transform index (0-11 for polyiamond: 0-5 rotations, 6-11 flipped+rotations) */
  transformIndex: number;
  /** Coordinates this placement covers (absolute, after transform and translation) */
  cells: TriCoord[];
}

/** Result of triangle tiling attempt */
export interface TriTilingResult {
  satisfiable: boolean;
  /** Placements that are used in the solution (if SAT) */
  placements?: TriPlacement[];
  /** Stats about the SAT problem */
  stats: {
    numVariables: number;
    numClauses: number;
    numPlacements: number;
  };
  /** Count of placements used for each tile type (when multiple tiles) */
  tileTypeCounts?: number[];
}

// ============================================================================
// Vertex-Based Transformation System (matches polyformTransforms.ts)
// ============================================================================

/**
 * Convert vertex coords to lattice UV coords.
 * Triangle vertices always satisfy (X - Y) is ODD.
 * We use the "odd sublattice" mapping: u = (X - Y - 1)/2 (integer), v = Y (integer).
 */
function vertexToUV(p: Vertex): UV {
  return { u: (p.X - p.Y - 1) / 2, v: p.Y };
}

/**
 * Convert lattice UV coords back to vertex coords.
 * Inverse of vertexToUV: X = 2u + v + 1, Y = v
 */
function uvToVertex(p: UV): Vertex {
  return { X: 2 * p.u + p.v + 1, Y: p.v };
}

/**
 * Apply rotation 60° CW in UV coords.
 * rot60 CW: (u,v) -> (u+v, -u)
 */
function rotateUV60CW(p: UV): UV {
  return { u: p.u + p.v, v: -p.u };
}

/**
 * Apply horizontal flip in UV coords (mirror across vertical screen line).
 * flipH: x -> -x => (u,v) -> (-u - v, v)
 */
function flipUVH(p: UV): UV {
  return { u: -p.u - p.v, v: p.v };
}

/**
 * Convert (row, col) cell to 3 vertices in half-edge coords.
 * Uses same geometry as TriangleGrid.tsx renderer.
 */
function cellToVertices(row: number, col: number): Vertex[] {
  const isUp = (row + col) % 2 === 0;
  
  if (isUp) {
    // Up triangle vertices: apex at (col+1, row), base at row+1
    return [
      { X: col + 1, Y: row },
      { X: col, Y: row + 1 },
      { X: col + 2, Y: row + 1 },
    ];
  } else {
    // Down triangle vertices: apex at (col+1, row+1), base at row
    return [
      { X: col, Y: row },
      { X: col + 2, Y: row },
      { X: col + 1, Y: row + 1 },
    ];
  }
}

/**
 * Convert 3 vertices back to (row, col) cell.
 * Returns null if vertices don't form a valid triangle.
 */
function verticesToCell(verts: Vertex[]): TriCoord | null {
  if (verts.length !== 3) return null;
  
  const Ys = verts.map(p => p.Y);
  const minY = Math.min(...Ys);
  const maxY = Math.max(...Ys);
  
  // Each elementary triangle spans exactly 1 in Y
  if (maxY - minY !== 1) return null;
  
  const low = verts.filter(p => p.Y === minY);
  const high = verts.filter(p => p.Y === maxY);
  
  if (low.length === 1 && high.length === 2) {
    // Up triangle: base at maxY, col = minX among base vertices, row = minY
    const col = Math.min(high[0].X, high[1].X);
    const row = minY;
    return { row, col };
  } else if (low.length === 2 && high.length === 1) {
    // Down triangle: base at minY, col = minX among base vertices, row = minY
    const col = Math.min(low[0].X, low[1].X);
    const row = minY;
    return { row, col };
  }
  
  return null;
}

/**
 * Apply a transform to a single triangle (as vertices in UV coords).
 * transformType 0-5: rotations only (0°, 60°, 120°, 180°, 240°, 300°)
 * transformType 6-11: flip + rotations
 */
function transformVertices(verts: Vertex[], transformIndex: number): Vertex[] {
  // Convert to UV
  let uvCoords = verts.map(vertexToUV);
  
  // Determine if we need to flip first (transforms 6-11)
  const shouldFlip = transformIndex >= 6;
  const rotations = transformIndex % 6;
  
  // Apply flip if needed
  if (shouldFlip) {
    uvCoords = uvCoords.map(flipUVH);
  }
  
  // Apply rotations
  for (let i = 0; i < rotations; i++) {
    uvCoords = uvCoords.map(rotateUV60CW);
  }
  
  // Convert back to vertices
  return uvCoords.map(uvToVertex);
}

/**
 * Transform and normalize a set of triangles.
 * Returns normalized coordinates starting near (0, 0).
 */
function transformTriangles(cells: TriCoord[], transformIndex: number): TriCoord[] {
  if (cells.length === 0) return [];
  
  // Convert each cell to vertices, transform, convert back
  const transformedCells: TriCoord[] = [];
  
  for (const cell of cells) {
    const verts = cellToVertices(cell.row, cell.col);
    const transformedVerts = transformVertices(verts, transformIndex);
    const resultCell = verticesToCell(transformedVerts);
    
    if (resultCell) {
      transformedCells.push(resultCell);
    }
  }
  
  if (transformedCells.length === 0) return [];
  
  // Normalize to positive coords
  let minRow = Infinity, minCol = Infinity;
  for (const c of transformedCells) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  // Base offsets to bring mins to 0
  const offRow = -minRow;
  let offCol = -minCol;
  
  // IMPORTANT: preserve (row+col)%2 orientation.
  // If offRow+offCol is odd, shift by 1 in col to maintain triangle parity.
  if (((offRow + offCol) & 1) !== 0) {
    offCol += 1;
  }
  
  return transformedCells.map(c => ({
    row: c.row + offRow,
    col: c.col + offCol,
  }));
}

/**
 * Generate all 12 transforms of a polyiamond tile.
 * 6 rotations × 2 (original + flipped).
 */
function generateAllTriTransforms(baseCells: TriCoord[]): TriCoord[][] {
  const transforms: TriCoord[][] = [];
  
  for (let transformIndex = 0; transformIndex < 12; transformIndex++) {
    transforms.push(transformTriangles(baseCells, transformIndex));
  }
  
  return transforms;
}

/**
 * Check if two coordinate sets are equal (order-independent).
 */
function coordSetsEqual(a: TriCoord[], b: TriCoord[]): boolean {
  if (a.length !== b.length) return false;
  
  const setA = new Set(a.map(c => `${c.row},${c.col}`));
  const setB = new Set(b.map(c => `${c.row},${c.col}`));
  
  if (setA.size !== setB.size) return false;
  for (const key of setA) {
    if (!setB.has(key)) return false;
  }
  return true;
}

/** A transform with its canonical index preserved */
interface TransformWithCanonical {
  coords: TriCoord[];
  /** Original index in the 0-11 transform list (matching UI semantics) */
  canonicalIndex: number;
}

/**
 * Remove duplicate transforms (for symmetric tiles) while preserving canonical indices.
 */
function deduplicateTriTransformsWithCanonical(transforms: TriCoord[][]): TransformWithCanonical[] {
  const unique: TransformWithCanonical[] = [];
  
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    const existing = unique.find(u => coordSetsEqual(u.coords, transform));
    if (!existing) {
      unique.push({ coords: transform, canonicalIndex: i });
    }
  }
  
  return unique;
}

/**
 * Get bounding box of triangle coordinates.
 */
function getTriBoundingBox(coords: TriCoord[]): { 
  minRow: number; maxRow: number; minCol: number; maxCol: number;
  width: number; height: number;
} {
  if (coords.length === 0) {
    return { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0, width: 0, height: 0 };
  }
  
  let minRow = Infinity, maxRow = -Infinity;
  let minCol = Infinity, maxCol = -Infinity;
  
  for (const c of coords) {
    minRow = Math.min(minRow, c.row);
    maxRow = Math.max(maxRow, c.row);
    minCol = Math.min(minCol, c.col);
    maxCol = Math.max(maxCol, c.col);
  }
  
  return {
    minRow, maxRow, minCol, maxCol,
    width: maxCol - minCol + 1,
    height: maxRow - minRow + 1,
  };
}

// ============================================================================
// Grid Conversion
// ============================================================================

/**
 * Convert boolean[][] grid to array of triangle coordinates,
 * normalized to start near (0, 0).
 */
export function triGridToCoords(cells: boolean[][]): TriCoord[] {
  const coords: TriCoord[] = [];
  
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        coords.push({ row, col });
      }
    }
  }
  
  if (coords.length === 0) return [];
  
  // Normalize to top-left
  let minRow = Infinity, minCol = Infinity;
  for (const c of coords) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  // Preserve parity when normalizing
  const offRow = -minRow;
  let offCol = -minCol;
  if (((offRow + offCol) & 1) !== 0) {
    offCol += 1;
  }
  
  return coords.map(c => ({
    row: c.row + offRow,
    col: c.col + offCol,
  }));
}

// ============================================================================
// Placement Generation
// ============================================================================

/**
 * Generate all valid placements for tiling a triangle grid.
 * 
 * A placement is valid if it covers at least one cell in the inner grid.
 * Placements can extend outside the inner grid (into a larger bounding area).
 */
export function generateAllTriPlacements(
  tileCoords: TriCoord[],
  tilingWidth: number,
  tilingHeight: number
): TriPlacement[] {
  if (tileCoords.length === 0) return [];
  
  // Get all 12 transforms (may include duplicates for symmetric tiles)
  const allTransforms = generateAllTriTransforms(tileCoords);
  // Deduplicate for efficiency while preserving canonical 0-11 indices
  const transforms = deduplicateTriTransformsWithCanonical(allTransforms);
  
  // Find the maximum bounding box across all transforms
  let maxTransformWidth = 0;
  let maxTransformHeight = 0;
  for (const t of transforms) {
    const bb = getTriBoundingBox(t.coords);
    maxTransformWidth = Math.max(maxTransformWidth, bb.width);
    maxTransformHeight = Math.max(maxTransformHeight, bb.height);
  }
  
  const placements: TriPlacement[] = [];
  let placementId = 0;
  
  for (const { coords: transformCoords, canonicalIndex } of transforms) {
    // Try all translations that might cover the inner grid
    // We need to consider translations from negative values to cover all positions
    for (let offsetRow = -maxTransformHeight + 1; offsetRow < tilingHeight; offsetRow++) {
      // For columns, we need to handle parity carefully
      // Try offsets in increments that preserve valid triangle positions
      for (let offsetCol = -maxTransformWidth + 1; offsetCol < tilingWidth + maxTransformWidth; offsetCol++) {
        // Check if this offset maintains proper parity for all cells
        // When translating, all cells must land on valid triangle positions
        
        // Translate the coordinates
        const translatedCells: TriCoord[] = [];

        for (const c of transformCoords) {
          const newRow = c.row + offsetRow;
          const newCol = c.col + offsetCol;
          
          // For each original cell, check if the translated position has same parity behavior
          // Original cell at (c.row, c.col) is up if (c.row + c.col) % 2 === 0
          // Translated cell at (newRow, newCol) should have same orientation
          // This is automatically true since (c.row + c.col) % 2 === (newRow + newCol) % 2
          // when offsetRow + offsetCol is even
          
          translatedCells.push({ row: newRow, col: newCol });
        }
        
        // The translation is valid only if it preserves parity
        // (offsetRow + offsetCol) must be even for triangle orientations to match
        if ((offsetRow + offsetCol) % 2 !== 0) {
          continue;
        }
        
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
            transformIndex: canonicalIndex,
            cells: translatedCells,
          });
        }
      }
    }
  }
  
  return placements;
}

// ============================================================================
// SAT Solver
// ============================================================================

/**
 * Solve the triangle tiling problem using a SAT solver.
 * 
 * Variables: One boolean variable per placement (is this placement used?)
 * 
 * Constraints:
 * 1. Coverage: Each cell in the inner grid must be covered by exactly one placement.
 * 2. Non-overlap: Each cell (including outer cells) can be covered by at most one placement.
 */
export function solvePolyiamondTiling(
  tilesInput: boolean[][] | boolean[][][],
  tilingWidth: number,
  tilingHeight: number,
  solver: SATSolver,
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void
): TriTilingResult {
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
  const allTileCoords: TriCoord[][] = tiles.map(cells => triGridToCoords(cells));
  
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
  let allPlacements: TriPlacement[] = [];
  const placementsByTileType: number[][] = []; // placementsByTileType[tileIndex] = [placementId, ...]
  let placementId = 0;
  let maxWidth = 0, maxHeight = 0; // Track max bounding box across all tiles
  
  for (const tileCoords of nonEmptyTileCoords) {
    // Get transforms for this tile
    const allTransforms = generateAllTriTransforms(tileCoords);
    
    // Track max bounding box
    for (const t of allTransforms) {
      const bb = getTriBoundingBox(t);
      maxWidth = Math.max(maxWidth, bb.width);
      maxHeight = Math.max(maxHeight, bb.height);
    }
    
    // Generate placements for this tile
    const tilePlacements = generateAllTriPlacements(tileCoords, tilingWidth, tilingHeight);
    
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
  // Outer grid bounds (with buffer for overhangs)
  const outerMinRow = -maxHeight;
  const outerMaxRow = tilingHeight + maxHeight;
  const outerMinCol = -maxWidth;
  const outerMaxCol = tilingWidth + maxWidth;
  
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
  for (let row = 0; row < tilingHeight; row++) {
    for (let col = 0; col < tilingWidth; col++) {
      const key = `${row},${col}`;
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
  const usedPlacements: TriPlacement[] = [];
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

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate that placements don't overlap.
 * 
 * Returns an array of overlap descriptions (empty array means no overlaps).
 */
export function findTriPlacementOverlaps(placements: TriPlacement[]): string[] {
  const seen = new Map<string, { placementId: number; placementIndex: number }>();
  const overlaps: string[] = [];
  
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    for (const cell of p.cells) {
      const key = `${cell.row},${cell.col}`;
      const existing = seen.get(key);
      
      if (existing) {
        overlaps.push(
          `Cell (row=${cell.row}, col=${cell.col}) covered by placement ${existing.placementIndex} (id=${existing.placementId}) ` +
          `and placement ${i} (id=${p.id})`
        );
      } else {
        seen.set(key, { placementId: p.id, placementIndex: i });
      }
    }
  }
  
  return overlaps;
}
