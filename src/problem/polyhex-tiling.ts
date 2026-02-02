/**
 * Polyhex Tiling SAT Solver
 * 
 * Uses CaDiCaL to attempt to tile a hex grid with rotations/translations/flips
 * of a given polyhex tile.
 * 
 * For polyhex (hexagonal grid), there are 12 possible transforms:
 * - 6 rotations (0°, 60°, 120°, 180°, 240°, 300°)
 * - Each rotation can be flipped (giving 6 more)
 * 
 * Coordinate system:
 * - Storage: odd-r offset coordinates (row, col) where odd rows are shifted right
 * - Transformations: done in axial/cube coordinates for correctness
 * - Tiling grid: rectangular bounding box that looks "square-like" to humans
 */

import type { SATSolver } from "../solvers/types";

/** A coordinate in the hex tiling grid (offset coords) */
export interface HexCoord {
  row: number;
  col: number;
}

/** Axial coordinate for hex (q, r) */
interface AxialCoord {
  q: number;
  r: number;
}

/** Cube coordinate for hex (x, y, z) where x + y + z = 0 */
interface CubeCoord {
  x: number;
  y: number;
  z: number;
}

/** A single placement of a hex tile at a position with a specific transform */
export interface HexPlacement {
  /** Unique identifier for the placement */
  id: number;
  /** Translation offset in axial coordinates */
  offset: AxialCoord;
  /** Transform index (0-11 for polyhex) */
  transformIndex: number;
  /** Coordinates this placement covers (absolute, in axial coords after transform and translation) */
  cells: AxialCoord[];
}

/** Edge color value: true = "filled", false = "empty" */
export type EdgeColor = boolean;

/** 
 * Edge coloring info for the solution.
 * Each edge is identified by a canonical key: "q1,r1,edgeIdx1" where cell (q1,r1) < cell (q2,r2)
 * The color is a boolean: true means "filled" (one style), false means "empty" (other style)
 */
export interface EdgeColorInfo {
  /** Map from canonical edge key to its color */
  edgeColors: Map<string, EdgeColor>;
}

/** Result of hex tiling attempt */
export interface HexTilingResult {
  satisfiable: boolean;
  /** Placements that are used in the solution (if SAT) */
  placements?: HexPlacement[];
  /** Stats about the SAT problem */
  stats: {
    numVariables: number;
    numClauses: number;
    numPlacements: number;
  };
  /** Count of placements used for each tile type (when multiple tiles) */
  tileTypeCounts?: number[];
  /** Edge coloring information for the solution */
  edgeColorInfo?: EdgeColorInfo;
}

// ============================================================================
// Coordinate Conversions (matching PolyformExplorer.tsx)
// ============================================================================

/**
 * Convert odd-r offset coordinates to axial coordinates.
 * Odd-r layout: odd rows are shifted right by half a hex.
 * 
 * Formula: q = col - floor(row / 2), r = row
 */
function offsetToAxial(row: number, col: number): AxialCoord {
  const q = col - Math.floor(row / 2);
  const r = row;
  return { q, r };
}

/**
 * Convert axial coordinates to odd-r offset coordinates.
 * 
 * Formula: col = q + floor(r / 2), row = r
 */
function axialToOffset(q: number, r: number): HexCoord {
  const row = r;
  const col = q + Math.floor(r / 2);
  return { row, col };
}

/**
 * Convert axial to cube coordinates.
 * x = q, z = r, y = -x - z
 */
function axialToCube(q: number, r: number): CubeCoord {
  const x = q;
  const z = r;
  const y = -x - z;
  return { x, y, z };
}

/**
 * Convert cube to axial coordinates.
 * q = x, r = z
 */
function cubeToAxial(x: number, _y: number, z: number): AxialCoord {
  return { q: x, r: z };
}

// ============================================================================
// Hex Transformations (matching PolyformExplorer.tsx UI behavior)
// ============================================================================

/**
 * Rotate axial coordinates 60° clockwise.
 * In cube coords: (x, y, z) -> (-z, -x, -y)
 * Matches rotatePolyhex() in PolyformExplorer.tsx
 */
function rotateAxial60CW(coord: AxialCoord): AxialCoord {
  const cube = axialToCube(coord.q, coord.r);
  // Rotate 60° CW in cube: (x, y, z) -> (-z, -x, -y)
  const rotatedCube: CubeCoord = {
    x: -cube.z,
    y: -cube.x,
    z: -cube.y,
  };
  return cubeToAxial(rotatedCube.x, rotatedCube.y, rotatedCube.z);
}

/**
 * Flip horizontally in axial coordinates.
 * Mirror across vertical screen line (x -> -x in screen coords).
 * In axial: (q, r) -> (-q - r, r)
 * Matches transformPolyhex(cells, "flipH") in PolyformExplorer.tsx
 */
function flipAxialH(coord: AxialCoord): AxialCoord {
  return { q: -coord.q - coord.r, r: coord.r };
}

/**
 * Flip vertically in axial coordinates.
 * Mirror across horizontal screen line (y -> -y in screen coords).
 * In axial: (q, r) -> (q + r, -r)
 * Matches transformPolyhex(cells, "flipV") in PolyformExplorer.tsx
 * 
 * Note: Not used in transform generation (flipH + rotations covers all cases)
 * but kept for completeness and potential future use.
 */
function _flipAxialV(coord: AxialCoord): AxialCoord {
  return { q: coord.q + coord.r, r: -coord.r };
}
// Suppress unused variable warning
void _flipAxialV;

/**
 * Normalize a set of axial coordinates to have minimum q and r at 0.
 */
function normalizeAxialCoords(coords: AxialCoord[]): AxialCoord[] {
  if (coords.length === 0) return [];
  
  let minQ = Infinity, minR = Infinity;
  for (const c of coords) {
    minQ = Math.min(minQ, c.q);
    minR = Math.min(minR, c.r);
  }
  
  return coords.map(c => ({
    q: c.q - minQ,
    r: c.r - minR,
  }));
}

/**
 * Apply rotation N times (0-5 for 0°, 60°, 120°, 180°, 240°, 300°).
 */
function rotateAxialN(coords: AxialCoord[], n: number): AxialCoord[] {
  let result = [...coords];
  for (let i = 0; i < n; i++) {
    result = result.map(rotateAxial60CW);
  }
  return normalizeAxialCoords(result);
}

/**
 * Generate all 12 transforms of a polyhex tile.
 * 6 rotations × 2 (original + flipped).
 * 
 * The transforms match the UI behavior:
 * - Transforms 0-5: rotations (0°, 60°, 120°, 180°, 240°, 300°)
 * - Transforms 6-11: flipped + rotations
 */
function generateAllHexTransforms(baseCoords: AxialCoord[]): AxialCoord[][] {
  const transforms: AxialCoord[][] = [];
  
  // 6 rotations of original
  for (let rot = 0; rot < 6; rot++) {
    transforms.push(rotateAxialN(baseCoords, rot));
  }
  
  // Flip horizontally, then 6 rotations
  const flipped = normalizeAxialCoords(baseCoords.map(flipAxialH));
  for (let rot = 0; rot < 6; rot++) {
    transforms.push(rotateAxialN(flipped, rot));
  }
  
  return transforms;
}

/**
 * Check if two axial coordinate sets are equal (order-independent).
 */
function axialSetsEqual(a: AxialCoord[], b: AxialCoord[]): boolean {
  if (a.length !== b.length) return false;
  
  const setA = new Set(a.map(c => `${c.q},${c.r}`));
  const setB = new Set(b.map(c => `${c.q},${c.r}`));
  
  if (setA.size !== setB.size) return false;
  for (const key of setA) {
    if (!setB.has(key)) return false;
  }
  return true;
}

/** A transform with its canonical index preserved */
interface TransformWithCanonical {
  coords: AxialCoord[];
  /** Original index in the 0-11 transform list (matching UI semantics) */
  canonicalIndex: number;
}

/**
 * Remove duplicate transforms (for symmetric tiles) while preserving canonical indices.
 * 
 * This ensures that transformIndex remains 0-11 (matching UI rotation/flip semantics)
 * even after deduplication. The first occurrence of each unique transform keeps its
 * original index.
 */
function deduplicateHexTransformsWithCanonical(transforms: AxialCoord[][]): TransformWithCanonical[] {
  const unique: TransformWithCanonical[] = [];
  
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    const existing = unique.find(u => axialSetsEqual(u.coords, transform));
    if (!existing) {
      unique.push({ coords: transform, canonicalIndex: i });
    }
  }
  
  return unique;
}

/**
 * Get bounding box of axial coordinates.
 */
function getAxialBoundingBox(coords: AxialCoord[]): { 
  minQ: number; maxQ: number; minR: number; maxR: number;
  width: number; height: number;
} {
  if (coords.length === 0) {
    return { minQ: 0, maxQ: 0, minR: 0, maxR: 0, width: 0, height: 0 };
  }
  
  let minQ = Infinity, maxQ = -Infinity;
  let minR = Infinity, maxR = -Infinity;
  
  for (const c of coords) {
    minQ = Math.min(minQ, c.q);
    maxQ = Math.max(maxQ, c.q);
    minR = Math.min(minR, c.r);
    maxR = Math.max(maxR, c.r);
  }
  
  return {
    minQ, maxQ, minR, maxR,
    width: maxQ - minQ + 1,
    height: maxR - minR + 1,
  };
}

// ============================================================================
// Grid Conversion
// ============================================================================

/**
 * Convert boolean[][] grid (odd-r offset) to array of axial coordinates,
 * normalized to start at (0, 0).
 */
export function hexGridToAxialCoords(cells: boolean[][]): AxialCoord[] {
  const coords: AxialCoord[] = [];
  
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        coords.push(offsetToAxial(row, col));
      }
    }
  }
  
  return normalizeAxialCoords(coords);
}

// ============================================================================
// Edge Coloring Utilities
// ============================================================================

/**
 * Axial neighbor directions for a hex cell.
 * Index 0-5 corresponds to edges 0-5 of the cell.
 * 
 * Edge i connects the cell to its neighbor in direction i.
 * The edge is shared between the cell and its neighbor, so we need
 * a canonical representation to avoid duplicates.
 * 
 * Directions (in axial coords):
 *   0: (+1, -1) - Upper-right (NE)
 *   1: (+1,  0) - Right (E)
 *   2: ( 0, +1) - Lower-right (SE)
 *   3: (-1, +1) - Lower-left (SW)
 *   4: (-1,  0) - Left (W)
 *   5: ( 0, -1) - Upper-left (NW)
 */
const HEX_NEIGHBOR_DIRECTIONS: AxialCoord[] = [
  { q: +1, r: -1 }, // 0: NE
  { q: +1, r:  0 }, // 1: E
  { q:  0, r: +1 }, // 2: SE
  { q: -1, r: +1 }, // 3: SW
  { q: -1, r:  0 }, // 4: W
  { q:  0, r: -1 }, // 5: NW
];

/**
 * Get the neighbor cell in a given direction.
 */
function getHexNeighbor(cell: AxialCoord, edgeIndex: number): AxialCoord {
  const dir = HEX_NEIGHBOR_DIRECTIONS[edgeIndex];
  return { q: cell.q + dir.q, r: cell.r + dir.r };
}

/**
 * Get the opposite edge index (the edge from neighbor's perspective).
 * Edge i is opposite to edge (i + 3) % 6.
 */
function getOppositeEdgeIndex(edgeIndex: number): number {
  return (edgeIndex + 3) % 6;
}

/**
 * Create a canonical edge key.
 * An edge is shared between two cells. We create a canonical representation
 * by always using the "smaller" cell (lexicographically by q,r) as the primary cell.
 * 
 * Returns: { canonicalKey: string, isInverted: boolean }
 * - canonicalKey: "q,r,edgeIdx" where (q,r) is the primary cell
 * - isInverted: true if we had to swap cells to get canonical form
 */
function getCanonicalEdgeKey(cell: AxialCoord, edgeIndex: number): { canonicalKey: string; isInverted: boolean } {
  const neighbor = getHexNeighbor(cell, edgeIndex);
  const neighborEdge = getOppositeEdgeIndex(edgeIndex);
  
  // Compare cells lexicographically
  const cellFirst = cell.q < neighbor.q || (cell.q === neighbor.q && cell.r <= neighbor.r);
  
  if (cellFirst) {
    return { canonicalKey: `${cell.q},${cell.r},${edgeIndex}`, isInverted: false };
  } else {
    return { canonicalKey: `${neighbor.q},${neighbor.r},${neighborEdge}`, isInverted: true };
  }
}

/**
 * Determine the "color" of an edge for a tile design.
 * 
 * The tile design encodes colors using half-circles on each edge.
 * For a cell in a tile, each edge has a specific color based on whether
 * the adjacent cell is also in the same tile (internal edge) or not (external edge).
 * 
 * Design rule: 
 * - Internal edges (between cells of the same tile) are "filled" (true)
 * - External edges (at tile boundary) are "empty" (false)
 * 
 * This creates a visual pattern where tiles have filled half-circles on internal
 * edges and empty half-circles on external edges.
 */
function getTileEdgeColor(tileCells: AxialCoord[], cell: AxialCoord, edgeIndex: number): EdgeColor {
  const neighbor = getHexNeighbor(cell, edgeIndex);
  const neighborInTile = tileCells.some(c => c.q === neighbor.q && c.r === neighbor.r);
  
  // Internal edges are "filled" (true), external edges are "empty" (false)
  return neighborInTile;
}

// ============================================================================
// Hex Tiling Grid Definition
// ============================================================================

/**
 * Generate all axial coordinates in a "rectangular" hex grid.
 * 
 * The grid looks square-like to humans when rendered:
 * - Height rows (r = 0 to height-1)
 * - For each row, q ranges to create a visually rectangular shape
 * 
 * In odd-r offset terms, this is simply row 0..height-1, col 0..width-1.
 * We convert those to axial coordinates for the tiling.
 */
function generateHexTilingGrid(tilingWidth: number, tilingHeight: number): AxialCoord[] {
  const grid: AxialCoord[] = [];
  
  for (let row = 0; row < tilingHeight; row++) {
    for (let col = 0; col < tilingWidth; col++) {
      grid.push(offsetToAxial(row, col));
    }
  }
  
  return grid;
}

/**
 * Check if an axial coordinate is within the tiling grid bounds.
 * The grid is defined as offset coords (0..height-1, 0..width-1).
 */
function isInHexTilingGrid(coord: AxialCoord, tilingWidth: number, tilingHeight: number): boolean {
  const offset = axialToOffset(coord.q, coord.r);
  return offset.row >= 0 && offset.row < tilingHeight &&
         offset.col >= 0 && offset.col < tilingWidth;
}

// ============================================================================
// Placement Generation
// ============================================================================

/**
 * Generate all valid placements for tiling a hex grid.
 * 
 * A placement is valid if it covers at least one cell in the inner grid.
 * Placements can extend outside the inner grid (into a larger bounding area).
 */
export function generateAllHexPlacements(
  tileAxialCoords: AxialCoord[],
  tilingWidth: number,
  tilingHeight: number
): HexPlacement[] {
  if (tileAxialCoords.length === 0) return [];
  
  // Get all 12 transforms (may include duplicates for symmetric tiles)
  const allTransforms = generateAllHexTransforms(tileAxialCoords);
  // Deduplicate for efficiency while preserving canonical 0-11 indices
  const transforms = deduplicateHexTransformsWithCanonical(allTransforms);
  
  // Find the maximum bounding box across all transforms in axial coords
  let maxTransformQ = 0;
  let maxTransformR = 0;
  for (const t of transforms) {
    const bb = getAxialBoundingBox(t.coords);
    maxTransformQ = Math.max(maxTransformQ, bb.width);
    maxTransformR = Math.max(maxTransformR, bb.height);
  }
  
  // Get the axial coordinate bounds of the tiling grid
  const tilingGrid = generateHexTilingGrid(tilingWidth, tilingHeight);
  const tilingBB = getAxialBoundingBox(tilingGrid);
  
  // We need to consider translations such that a tile can cover any point in the grid
  // Translation range in axial coords:
  // q: from (tilingBB.minQ - maxTransformQ + 1) to tilingBB.maxQ
  // r: from (tilingBB.minR - maxTransformR + 1) to tilingBB.maxR
  
  const placements: HexPlacement[] = [];
  let placementId = 0;
  
  for (const { coords: transformCoords, canonicalIndex } of transforms) {
    // Try all translations
    for (let offsetR = tilingBB.minR - maxTransformR + 1; offsetR <= tilingBB.maxR; offsetR++) {
      for (let offsetQ = tilingBB.minQ - maxTransformQ + 1; offsetQ <= tilingBB.maxQ; offsetQ++) {
        // Translate the coordinates
        const translatedCells = transformCoords.map(c => ({
          q: c.q + offsetQ,
          r: c.r + offsetR,
        }));
        
        // Check if this placement covers at least one cell in the inner grid
        let coversInnerGrid = false;
        for (const cell of translatedCells) {
          if (isInHexTilingGrid(cell, tilingWidth, tilingHeight)) {
            coversInnerGrid = true;
            break;
          }
        }
        
        if (coversInnerGrid) {
          placements.push({
            id: placementId++,
            offset: { q: offsetQ, r: offsetR },
            transformIndex: canonicalIndex,  // Use original 0-11 index, not deduplicated index
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
 * Solve the hex tiling problem using a SAT solver.
 * 
 * Variables: One boolean variable per placement (is this placement used?)
 * 
 * Constraints:
 * 1. Coverage: Each cell in the inner grid must be covered by exactly one placement.
 * 2. Non-overlap: Each cell (including outer cells) can be covered by at most one placement.
 */
export function solvePolyhexTiling(
  tilesInput: boolean[][] | boolean[][][],
  tilingWidth: number,
  tilingHeight: number,
  solver: SATSolver,
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void
): HexTilingResult {
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
  
  // Convert each tile grid to normalized axial coordinates
  const allTileCoords: AxialCoord[][] = tiles.map(cells => hexGridToAxialCoords(cells));
  
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
  let allPlacements: HexPlacement[] = [];
  const placementsByTileType: number[][] = []; // placementsByTileType[tileIndex] = [placementId, ...]
  let placementId = 0;
  let maxQ = 0, maxR = 0; // Track max bounding box across all tiles
  
  for (const tileAxialCoords of nonEmptyTileCoords) {
    // Get transforms for this tile
    const allTransforms = generateAllHexTransforms(tileAxialCoords);
    
    // Track max bounding box
    for (const t of allTransforms) {
      const bb = getAxialBoundingBox(t);
      maxQ = Math.max(maxQ, bb.width);
      maxR = Math.max(maxR, bb.height);
    }
    
    // Generate placements for this tile
    const tilePlacements = generateAllHexPlacements(tileAxialCoords, tilingWidth, tilingHeight);
    
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
  
  // Build index: for each axial coordinate, which placements cover it?
  const tilingGrid = generateHexTilingGrid(tilingWidth, tilingHeight);
  const tilingBB = getAxialBoundingBox(tilingGrid);
  
  // Outer grid bounds (with buffer for overhangs)
  const outerMinQ = tilingBB.minQ - maxQ;
  const outerMaxQ = tilingBB.maxQ + maxQ;
  const outerMinR = tilingBB.minR - maxR;
  const outerMaxR = tilingBB.maxR + maxR;
  
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
  // Use a set to track which cells need coverage
  const innerGridSet = new Set(tilingGrid.map(c => `${c.q},${c.r}`));
  
  for (const cellKey of innerGridSet) {
    const coveringPlacements = cellToPlacements.get(cellKey) || [];
    
    if (coveringPlacements.length === 0) {
      // No placement can cover this cell - UNSAT
      solver.addClause([]);
    } else {
      // At least one of these placements must be active
      const literals = coveringPlacements.map(pid => placementVars.get(pid)!);
      solver.addClause(literals);
    }
  }
  
  // CONSTRAINT 2: Non-overlap - each cell can be covered by at most one placement
  for (let r = outerMinR; r <= outerMaxR; r++) {
    for (let q = outerMinQ; q <= outerMaxQ; q++) {
      const key = `${q},${r}`;
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
  
  // ========================================================================
  // EDGE COLORING VARIABLES AND CONSTRAINTS
  // ========================================================================
  
  // Collect all edges that will be affected by the placements
  // Each edge is identified by its canonical key
  const allEdgeKeys = new Set<string>();
  
  // For each placement, compute what edges it affects and what colors it requires
  // placementEdgeColors[placementId] = Map<canonicalEdgeKey, requiredColor>
  const placementEdgeColors: Map<number, Map<string, EdgeColor>> = new Map();
  
  for (const p of allPlacements) {
    const edgeColorMap = new Map<string, EdgeColor>();
    
    for (const cell of p.cells) {
      // For each edge of this cell
      for (let edgeIdx = 0; edgeIdx < 6; edgeIdx++) {
        const { canonicalKey } = getCanonicalEdgeKey(cell, edgeIdx);
        const color = getTileEdgeColor(p.cells, cell, edgeIdx);
        
        allEdgeKeys.add(canonicalKey);
        edgeColorMap.set(canonicalKey, color);
      }
    }
    
    placementEdgeColors.set(p.id, edgeColorMap);
  }
  
  // Create SAT variables for each edge (one variable per unique edge)
  // Edge variable is true = "filled", false = "empty"
  const edgeVars: Map<string, number> = new Map();
  for (const edgeKey of allEdgeKeys) {
    const varNum = solver.newVariable();
    edgeVars.set(edgeKey, varNum);
  }
  
  // CONSTRAINT 3: Placement implies edge colors
  // If placement P is active, then for each edge E affected by P:
  //   P => (E == requiredColor)
  // Which is: NOT P OR (E == requiredColor)
  // If requiredColor is true: NOT P OR E  (i.e., [-P, E])
  // If requiredColor is false: NOT P OR NOT E  (i.e., [-P, -E])
  
  for (const p of allPlacements) {
    const placementVar = placementVars.get(p.id)!;
    const edgeColorMap = placementEdgeColors.get(p.id)!;
    
    for (const [edgeKey, requiredColor] of edgeColorMap) {
      const edgeVar = edgeVars.get(edgeKey)!;
      
      if (requiredColor) {
        // Placement implies edge is filled: NOT placement OR edge
        solver.addClause([-placementVar, edgeVar]);
      } else {
        // Placement implies edge is empty: NOT placement OR NOT edge
        solver.addClause([-placementVar, -edgeVar]);
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
  const usedPlacements: HexPlacement[] = [];
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
  
  // Extract edge colors from the solution
  // Note: SAT solvers should assign all edge variables. If a variable is unassigned
  // (undefined), we treat it as false (EMPTY), as this shouldn't happen in practice.
  const edgeColors = new Map<string, EdgeColor>();
  for (const [edgeKey, edgeVar] of edgeVars) {
    const colorValue = result.assignment.get(edgeVar);
    // Explicitly handle undefined: treat as false (external/empty)
    edgeColors.set(edgeKey, colorValue === true);
  }
  
  return {
    satisfiable: true,
    placements: usedPlacements,
    stats: { numVariables: numVars, numClauses: numClauses, numPlacements: allPlacements.length },
    tileTypeCounts,
    edgeColorInfo: { edgeColors },
  };
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate that placements don't overlap in axial space.
 * 
 * This helps distinguish between SAT model issues and rendering issues.
 * Returns an array of overlap descriptions (empty array means no overlaps).
 */
export function findHexPlacementOverlaps(placements: HexPlacement[]): string[] {
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

// ============================================================================
// Export utilities for rendering
// ============================================================================

export { axialToOffset, offsetToAxial, getCanonicalEdgeKey, getHexNeighbor, getOppositeEdgeIndex };
export type { AxialCoord };
