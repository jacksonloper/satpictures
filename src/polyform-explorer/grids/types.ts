/**
 * Unified Grid Definition Types
 * 
 * A grid definition encapsulates all the geometric properties needed for polyform
 * tiling and display operations. This abstraction allows the SAT solver and
 * display code to work generically with any grid type.
 */

/** A 2D coordinate in the grid using axial coordinates */
export interface Coord {
  q: number;
  r: number;
}

/**
 * Neighbor information for a given cell type.
 * Each entry describes how to reach a neighboring cell using axial coordinate offsets.
 */
export interface NeighborInfo {
  /** q offset to reach this neighbor */
  dq: number;
  /** r offset to reach this neighbor */
  dr: number;
}

/**
 * Transform result containing the transformed coordinate and a permutation
 * describing how local neighbor indices map after the transform.
 */
export interface TransformResult {
  /** The transformed coordinate */
  coord: Coord;
  /** 
   * Permutation array: neighborPerm[i] gives the new neighbor index
   * that corresponds to what was neighbor i before the transform.
   */
  neighborPerm: number[];
}

/**
 * Vertex position for rendering (in normalized units).
 * The vertices list for a cell type has one vertex per neighbor,
 * where the edge from vertex[i] to vertex[(i+1) % numNeighbors]
 * is adjacent to neighbor i.
 */
export interface Vertex {
  x: number;
  y: number;
}

/**
 * Complete definition of a grid geometry.
 * 
 * This interface captures all the information needed to:
 * - Generate valid placements for tiling
 * - Transform (rotate/flip) polyforms
 * - Render polyforms and tilings
 */
export interface GridDefinition {
  /** Human-readable name for this grid type */
  name: string;
  
  /** 
   * Number of distinct cell types in the grid.
   * For square and hex grids, this is 1 (all cells are the same type).
   * For triangle grids, this is 2 (up-pointing and down-pointing triangles).
   */
  numCellTypes: number;
  
  /**
   * Returns the type of a cell at the given coordinate.
   * Type is an integer from 0 to numCellTypes-1.
   */
  getCellType: (coord: Coord) => number;
  
  /**
   * Neighbor offsets for each cell type.
   * neighbors[cellType] is an array of NeighborInfo describing all neighbors.
   */
  neighbors: NeighborInfo[][];
  
  /**
   * Number of rotations before returning to identity.
   * For square: 4 (90° rotations)
   * For hex: 6 (60° rotations)
   * For triangle: 6 (60° rotations)
   */
  numRotations: number;
  
  /**
   * Apply a single rotation step (clockwise) to a coordinate.
   * Returns the rotated coordinate and a permutation of neighbor indices.
   * The permutation describes how neighbors map: if neighborPerm[i] = j,
   * then what was neighbor i before is now neighbor j after the rotation.
   */
  rotate: (coord: Coord) => TransformResult;
  
  /**
   * Apply a horizontal flip to a coordinate.
   * Returns the flipped coordinate and a permutation of neighbor indices.
   */
  flip: (coord: Coord) => TransformResult;
  
  /**
   * Two translation vectors that preserve parity and tessellation.
   * For square: typically (+1,0) and (0,+1).
   * For hex: appropriate vectors in axial coordinates.
   * For triangle: vectors that maintain triangle orientation parity.
   */
  translateVectors: [Coord, Coord];
  
  /**
   * Vertices for each cell type, used for rendering.
   * vertices[cellType] is an array of Vertex positions.
   * The edge from vertex[i] to vertex[(i+1) % n] faces neighbor i.
   */
  vertices: Vertex[][];
  
  /**
   * Get the screen position (center) for rendering a cell.
   * Returns {x, y} coordinates in abstract units.
   */
  getCellCenter: (coord: Coord, cellSize: number) => { x: number; y: number };
  
  /**
   * Get the screen vertices for rendering a cell.
   * Returns array of {x, y} coordinates in pixel units.
   */
  getCellVertices: (coord: Coord, cellSize: number) => Array<{ x: number; y: number }>;
}

/**
 * Apply a transform N times to a coordinate set.
 * Returns the transformed coordinates normalized to start near (0,0).
 */
export function applyTransformN(
  grid: GridDefinition,
  coords: Coord[],
  transform: (coord: Coord) => TransformResult,
  n: number
): Coord[] {
  if (coords.length === 0 || n === 0) return coords;
  
  let result = [...coords];
  for (let i = 0; i < n; i++) {
    result = result.map(c => transform(c).coord);
  }
  
  return normalizeCoords(grid, result);
}

/**
 * Normalize a set of coordinates to have minimum q and r at 0,
 * while preserving cell type parity for grids that require it.
 */
export function normalizeCoords(grid: GridDefinition, coords: Coord[]): Coord[] {
  if (coords.length === 0) return [];
  
  // Find minimum values
  let minQ = Infinity, minR = Infinity;
  for (const c of coords) {
    minQ = Math.min(minQ, c.q);
    minR = Math.min(minR, c.r);
  }
  
  // Base offsets
  const offQ = -minQ;
  let offR = -minR;
  
  // For triangle grids, we need to preserve (q+r) % 2 parity
  if (grid.numCellTypes === 2) {
    // Check if the offset changes parity
    if ((offQ + offR) % 2 !== 0) {
      offR += 1;
    }
  }
  
  return coords.map(c => ({
    q: c.q + offQ,
    r: c.r + offR,
  }));
}

/**
 * Generate all transforms of a set of coordinates (rotations and flips).
 * 
 * Returns ALL `numRotations * 2` transforms without deduplication based on shape.
 * This is necessary because when edges are involved, different rotations are 
 * distinct even if they produce the same coordinate shape (e.g., a single cell
 * rotated still has different edge orientations).
 * 
 * Returns array of { coords, transformIndex, originalIndices } where:
 * - transformIndex corresponds to: 0..numRotations-1 for rotations, 
 *   numRotations..(2*numRotations-1) for flip+rotations.
 * - originalIndices[i] gives the index in baseCoords that maps to coords[i]
 * 
 * @returns Array of exactly `grid.numRotations * 2` transform entries
 */
export function generateAllTransforms(
  grid: GridDefinition,
  baseCoords: Coord[]
): Array<{ coords: Coord[]; transformIndex: number; originalIndices: number[] }> {
  const transforms: Array<{ coords: Coord[]; transformIndex: number; originalIndices: number[] }> = [];
  
  // Helper to normalize coords and track how indices map
  const normalizeWithIndices = (coords: Coord[], indices: number[]): {
    normalized: Coord[];
    normalizedIndices: number[];
  } => {
    if (coords.length === 0) return { normalized: [], normalizedIndices: [] };
    
    // Find minimum values
    let minQ = Infinity, minR = Infinity;
    for (const c of coords) {
      minQ = Math.min(minQ, c.q);
      minR = Math.min(minR, c.r);
    }
    
    const offQ = -minQ;
    let offR = -minR;
    
    // For triangle grids, preserve (q+r) % 2 parity
    if (grid.numCellTypes === 2) {
      if ((offQ + offR) % 2 !== 0) {
        offR += 1;
      }
    }
    
    return {
      normalized: coords.map(c => ({ q: c.q + offQ, r: c.r + offR })),
      normalizedIndices: indices,
    };
  };
  
  // Generate all rotations (no deduplication - each transform is unique due to edge orientations)
  let current = baseCoords;
  let currentIndices = baseCoords.map((_, i) => i);
  for (let rot = 0; rot < grid.numRotations; rot++) {
    const { normalized, normalizedIndices } = normalizeWithIndices(current, currentIndices);
    transforms.push({ coords: normalized, transformIndex: rot, originalIndices: normalizedIndices });
    // Rotate for next iteration
    current = current.map(c => grid.rotate(c).coord);
  }
  
  // Flip and generate all rotations
  current = baseCoords.map(c => grid.flip(c).coord);
  currentIndices = baseCoords.map((_, i) => i);
  for (let rot = 0; rot < grid.numRotations; rot++) {
    const { normalized, normalizedIndices } = normalizeWithIndices(current, currentIndices);
    transforms.push({ coords: normalized, transformIndex: grid.numRotations + rot, originalIndices: normalizedIndices });
    // Rotate for next iteration
    current = current.map(c => grid.rotate(c).coord);
  }
  
  return transforms;
}

/**
 * Get bounding box of a set of coordinates.
 */
export function getBoundingBox(coords: Coord[]): {
  minQ: number;
  maxQ: number;
  minR: number;
  maxR: number;
  width: number;
  height: number;
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
    minQ,
    maxQ,
    minR,
    maxR,
    width: maxQ - minQ + 1,
    height: maxR - minR + 1,
  };
}

/**
 * Check if a coordinate is within a given rectangular grid.
 */
export function isInGrid(coord: Coord, width: number, height: number): boolean {
  return coord.r >= 0 && coord.r < height && 
         coord.q >= 0 && coord.q < width;
}

/**
 * Compute normalized grid dimensions from transformed coordinate bounds.
 * 
 * This accounts for parity offset in triangle grids where (q + r) % 2 must be preserved.
 * 
 * @param minQ Minimum q coordinate after transformation
 * @param maxQ Maximum q coordinate after transformation
 * @param minR Minimum r coordinate after transformation
 * @param maxR Maximum r coordinate after transformation
 * @param grid Grid definition (for parity check)
 * @returns { width, height, offQ, offR } where off* are normalization offsets
 */
export function computeNormalizedGridDimensions(
  minQ: number,
  maxQ: number,
  minR: number,
  maxR: number,
  grid: GridDefinition
): { width: number; height: number; offQ: number; offR: number } {
  const offR = -minR;
  let offQ = -minQ;
  
  // For triangle grids, preserve (q + r) % 2 parity
  if (grid.numCellTypes === 2 && (offQ + offR) % 2 !== 0) {
    offQ += 1;
  }
  
  // Width calculation: maxQ + offQ + 1 = maxQ - minQ + 1 + (extra if parity needed)
  const width = maxQ + offQ + 1;
  const height = maxR - minR + 1;
  
  return { width, height, offQ, offR };
}

// ============================================================================
// Edge State Types and Utilities
// ============================================================================

/**
 * Edge state for a single cell.
 * edges[i] is true if edge i (facing neighbor i) is marked/colored.
 */
export type CellEdges = boolean[];

/**
 * Edge state for all cells in a grid.
 * edgeState[row][col] is the CellEdges for that cell.
 * Each cell has an array of booleans, one per edge (matching neighbor count).
 */
export type EdgeState = CellEdges[][];

/**
 * Create an empty edge state grid.
 * @param grid The grid definition (to determine edges per cell type)
 * @param width Grid width
 * @param height Grid height
 * @returns EdgeState with all edges set to false
 */
export function createEmptyEdgeState(
  grid: GridDefinition,
  width: number,
  height: number
): EdgeState {
  const result: EdgeState = [];
  for (let r = 0; r < height; r++) {
    const rowEdges: CellEdges[] = [];
    for (let q = 0; q < width; q++) {
      const cellType = grid.getCellType({ q, r });
      const numEdges = grid.neighbors[cellType].length;
      rowEdges.push(new Array(numEdges).fill(false));
    }
    result.push(rowEdges);
  }
  return result;
}

/**
 * Toggle an edge on a cell.
 * @param edgeState Current edge state
 * @param q Cell q coordinate
 * @param r Cell r coordinate
 * @param edgeIndex Edge index to toggle
 * @returns New edge state with the edge toggled
 */
export function toggleEdge(
  edgeState: EdgeState,
  q: number,
  r: number,
  edgeIndex: number
): EdgeState {
  return edgeState.map((rowEdges, rIndex) =>
    rowEdges.map((cellEdges, qIndex) => {
      if (rIndex === r && qIndex === q) {
        return cellEdges.map((val, i) => i === edgeIndex ? !val : val);
      }
      return cellEdges;
    })
  );
}

/**
 * Apply a transform (rotate or flip) to edge state.
 * The neighborPerm from the transform tells us how edges map.
 * 
 * @param grid Grid definition
 * @param edgeState Current edge state
 * @param transform The transform function (grid.rotate or grid.flip)
 * @returns New edge state after the transform
 */
export function transformEdgeState(
  grid: GridDefinition,
  edgeState: EdgeState,
  transform: (coord: Coord) => TransformResult
): EdgeState {
  if (edgeState.length === 0 || edgeState[0].length === 0) return edgeState;
  
  const height = edgeState.length;
  const width = edgeState[0].length;
  
  // Transform only cells that have at least one edge marked
  // (this avoids grid expansion from empty positions)
  const transformedCells: Array<{
    newCoord: Coord;
    newEdges: boolean[];
  }> = [];
  
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const coord = { q, r };
      const oldEdges = edgeState[r][q];
      
      // Skip cells with no edges marked
      if (!oldEdges.some(e => e)) continue;
      
      const result = transform(coord);
      
      // Apply the neighbor permutation to edges
      // neighborPerm[i] tells us where old edge i goes in the new orientation
      const newEdges = new Array(oldEdges.length).fill(false);
      for (let i = 0; i < oldEdges.length; i++) {
        const newIndex = result.neighborPerm[i];
        newEdges[newIndex] = oldEdges[i];
      }
      
      transformedCells.push({
        newCoord: result.coord,
        newEdges,
      });
    }
  }
  
  // If no cells have edges, return empty edge state of same dimensions
  if (transformedCells.length === 0) {
    return createEmptyEdgeState(grid, width, height);
  }
  
  // Find bounds of transformed coordinates (only cells with edges)
  let minQ = Infinity, minR = Infinity;
  let maxQ = -Infinity, maxR = -Infinity;
  for (const { newCoord } of transformedCells) {
    minQ = Math.min(minQ, newCoord.q);
    maxQ = Math.max(maxQ, newCoord.q);
    minR = Math.min(minR, newCoord.r);
    maxR = Math.max(maxR, newCoord.r);
  }
  
  // Compute normalized dimensions
  const { width: newWidth, height: newHeight, offQ, offR } = computeNormalizedGridDimensions(
    minQ, maxQ, minR, maxR, grid
  );
  
  const newEdgeState: EdgeState = [];
  for (let rIndex = 0; rIndex < newHeight; rIndex++) {
    const rowEdges: CellEdges[] = [];
    for (let qIndex = 0; qIndex < newWidth; qIndex++) {
      const cellType = grid.getCellType({ q: qIndex, r: rIndex });
      const numEdges = grid.neighbors[cellType].length;
      rowEdges.push(new Array(numEdges).fill(false));
    }
    newEdgeState.push(rowEdges);
  }
  
  // Place transformed edges into new grid
  for (const { newCoord, newEdges } of transformedCells) {
    const rPos = newCoord.r + offR;
    const qPos = newCoord.q + offQ;
    if (rPos >= 0 && rPos < newHeight && qPos >= 0 && qPos < newWidth) {
      newEdgeState[rPos][qPos] = newEdges;
    }
  }
  
  return newEdgeState;
}

/**
 * Rotate edge state by one rotation step.
 */
export function rotateEdgeState(
  grid: GridDefinition,
  edgeState: EdgeState
): EdgeState {
  return transformEdgeState(grid, edgeState, grid.rotate);
}

/**
 * Flip edge state horizontally.
 */
export function flipEdgeState(
  grid: GridDefinition,
  edgeState: EdgeState
): EdgeState {
  return transformEdgeState(grid, edgeState, grid.flip);
}

/**
 * Compose two permutations: result[i] = b[a[i]]
 * (Apply a first, then b)
 */
function composePermutations(a: number[], b: number[]): number[] {
  return a.map(ai => b[ai]);
}

/**
 * Compute the inverse of a permutation.
 * If perm[i] = j, then inverse[j] = i.
 * Assumes perm is a valid permutation (bijective mapping).
 */
function invertPermutation(perm: number[]): number[] {
  const inverse = new Array<number>(perm.length);
  for (let i = 0; i < perm.length; i++) {
    inverse[perm[i]] = i;
  }
  return inverse;
}

/**
 * Get the forward edge permutation for a given transform index.
 * 
 * Transform indices are canonically ordered:
 * - 0 to numRotations-1: rotate 0, 1, 2, ... times
 * - numRotations to 2*numRotations-1: flip, then rotate 0, 1, 2, ... times
 * 
 * The forward permutation maps: originalEdgeIdx -> visualEdgeIdx
 * This tells us where an original edge ends up after the transform.
 * 
 * @param grid The grid definition (provides rotate/flip functions and numRotations)
 * @param transformIndex The transform index (0 to 2*numRotations-1)
 * @returns The forward permutation array (original → visual)
 */
export function getForwardEdgePermutation(
  grid: GridDefinition,
  transformIndex: number
): number[] {
  const numRotations = grid.numRotations;
  const numEdges = grid.neighbors[0].length;
  
  // Start with identity permutation
  let forwardPerm = Array.from({ length: numEdges }, (_, i) => i);
  
  // Determine if this is a flipped transform
  const isFlipped = transformIndex >= numRotations;
  const rotationCount = isFlipped ? transformIndex - numRotations : transformIndex;
  
  // If flipped, apply flip first
  // Note: We use origin {q: 0, r: 0} but only care about the neighborPerm
  if (isFlipped) {
    const flipResult = grid.flip({ q: 0, r: 0 });
    forwardPerm = composePermutations(forwardPerm, flipResult.neighborPerm);
  }
  
  // Apply rotations
  for (let rot = 0; rot < rotationCount; rot++) {
    const rotateResult = grid.rotate({ q: 0, r: 0 });
    forwardPerm = composePermutations(forwardPerm, rotateResult.neighborPerm);
  }
  
  return forwardPerm;
}

/**
 * Get the inverse edge permutation for a given transform index.
 * 
 * Transform indices are canonically ordered:
 * - 0 to numRotations-1: rotate 0, 1, 2, ... times
 * - numRotations to 2*numRotations-1: flip, then rotate 0, 1, 2, ... times
 * 
 * The "inverse" permutation maps: visualEdgeIdx -> originalEdgeIdx
 * This tells us which original edge corresponds to a visual edge after the transform.
 * 
 * @param grid The grid definition (provides rotate/flip functions and numRotations)
 * @param transformIndex The transform index (0 to 2*numRotations-1)
 * @returns The inverse permutation array
 */
export function getInverseEdgePermutation(
  grid: GridDefinition,
  transformIndex: number
): number[] {
  const numRotations = grid.numRotations;
  const numEdges = grid.neighbors[0].length;
  
  // Start with identity permutation
  let forwardPerm = Array.from({ length: numEdges }, (_, i) => i);
  
  // Determine if this is a flipped transform
  const isFlipped = transformIndex >= numRotations;
  const rotationCount = isFlipped ? transformIndex - numRotations : transformIndex;
  
  // If flipped, apply flip first
  // Note: We use origin {q: 0, r: 0} but only care about the neighborPerm
  if (isFlipped) {
    const flipResult = grid.flip({ q: 0, r: 0 });
    forwardPerm = composePermutations(forwardPerm, flipResult.neighborPerm);
  }
  
  // Apply rotations
  for (let rot = 0; rot < rotationCount; rot++) {
    const rotateResult = grid.rotate({ q: 0, r: 0 });
    forwardPerm = composePermutations(forwardPerm, rotateResult.neighborPerm);
  }
  
  // Return the inverse of the forward permutation
  return invertPermutation(forwardPerm);
}

// ============================================================================
// Generic Cell Grid Transformations (for boolean[][] grids)
// ============================================================================

/**
 * Transform a boolean cell grid using a grid coordinate transform.
 * This is the unified way to rotate/flip cells that matches edge state transformation.
 * 
 * IMPORTANT: The grid maintains its shape (all positions are transformed together)
 * to ensure cells and edges stay aligned. This is different from only transforming
 * filled cells, which would lose the rectangular grid structure.
 * 
 * @param grid Grid definition (provides transform and parity info)
 * @param cells Boolean grid where cells[r][q] = true means cell is filled
 * @param transform The transform function (grid.rotate or grid.flip)
 * @returns Transformed and normalized boolean grid
 */
export function transformCells(
  grid: GridDefinition,
  cells: boolean[][],
  transform: (coord: Coord) => TransformResult
): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  if (height === 0 || width === 0) return cells;
  
  // Collect only the FILLED cells to transform
  // (this avoids grid expansion from empty positions)
  const filledPositions: Array<{ q: number; r: number }> = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      if (cells[r][q]) {
        filledPositions.push({ q, r });
      }
    }
  }
  
  // If no filled cells, return the original (empty) grid
  if (filledPositions.length === 0) {
    return cells;
  }
  
  // Transform only the filled cells
  const transformed: Array<{ newCoord: Coord }> = filledPositions.map(pos => ({
    newCoord: transform(pos).coord
  }));
  
  // Find bounds from filled cells only
  let minQ = Infinity, minR = Infinity;
  let maxQ = -Infinity, maxR = -Infinity;
  for (const { newCoord } of transformed) {
    minQ = Math.min(minQ, newCoord.q);
    maxQ = Math.max(maxQ, newCoord.q);
    minR = Math.min(minR, newCoord.r);
    maxR = Math.max(maxR, newCoord.r);
  }
  
  // Compute normalized dimensions
  const { width: newWidth, height: newHeight, offQ, offR } = computeNormalizedGridDimensions(
    minQ, maxQ, minR, maxR, grid
  );
  
  const newCells: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );
  
  // Place transformed filled cells
  for (const { newCoord } of transformed) {
    const r = newCoord.r + offR;
    const q = newCoord.q + offQ;
    if (r >= 0 && r < newHeight && q >= 0 && q < newWidth) {
      newCells[r][q] = true;
    }
  }
  
  return newCells;
}

/**
 * Rotate cells by one rotation step using the grid definition.
 */
export function rotateCells(
  grid: GridDefinition,
  cells: boolean[][]
): boolean[][] {
  return transformCells(grid, cells, grid.rotate);
}

/**
 * Flip cells horizontally using the grid definition.
 */
export function flipCells(
  grid: GridDefinition,
  cells: boolean[][]
): boolean[][] {
  return transformCells(grid, cells, grid.flip);
}

/**
 * Transform both cells and edge state together, ensuring they remain aligned.
 * 
 * This function computes bounds from filled cells, then transforms both the cells
 * and the edge state using those bounds. This ensures that:
 * 1. Cell positions and edge positions match after transformation
 * 2. The grid doesn't grow or shrink unexpectedly
 * 
 * @param grid Grid definition
 * @param cells Boolean grid where cells[r][q] = true means cell is filled
 * @param edgeState Edge state grid with same dimensions as cells
 * @param transform The transform function (grid.rotate or grid.flip)
 * @returns Transformed {cells, edgeState} with matching dimensions
 */
export function transformCellsAndEdges(
  grid: GridDefinition,
  cells: boolean[][],
  edgeState: EdgeState,
  transform: (coord: Coord) => TransformResult
): { cells: boolean[][]; edgeState: EdgeState } {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    return { cells, edgeState };
  }
  
  // Collect filled cell positions and their edges
  const filledPositions: Array<{ q: number; r: number }> = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      if (cells[r][q]) {
        filledPositions.push({ q, r });
      }
    }
  }
  
  // If no filled cells, return empty grids
  if (filledPositions.length === 0) {
    return { cells, edgeState };
  }
  
  // Transform all filled positions
  const transformedPositions = filledPositions.map(pos => {
    const result = transform(pos);
    return {
      oldPos: pos,
      newCoord: result.coord,
      neighborPerm: result.neighborPerm,
    };
  });
  
  // Find bounds from transformed filled cells
  let minQ = Infinity, minR = Infinity;
  let maxQ = -Infinity, maxR = -Infinity;
  for (const { newCoord } of transformedPositions) {
    minQ = Math.min(minQ, newCoord.q);
    maxQ = Math.max(maxQ, newCoord.q);
    minR = Math.min(minR, newCoord.r);
    maxR = Math.max(maxR, newCoord.r);
  }
  
  // Compute normalized dimensions
  const { width: newWidth, height: newHeight, offQ, offR } = computeNormalizedGridDimensions(
    minQ, maxQ, minR, maxR, grid
  );
  
  const newCells: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );
  
  const newEdgeState: EdgeState = [];
  for (let rIndex = 0; rIndex < newHeight; rIndex++) {
    const rowEdges: CellEdges[] = [];
    for (let qIndex = 0; qIndex < newWidth; qIndex++) {
      const cellType = grid.getCellType({ q: qIndex, r: rIndex });
      const numEdges = grid.neighbors[cellType].length;
      rowEdges.push(new Array(numEdges).fill(false));
    }
    newEdgeState.push(rowEdges);
  }
  
  // Place transformed cells and edges
  for (const { oldPos, newCoord, neighborPerm } of transformedPositions) {
    const newR = newCoord.r + offR;
    const newQ = newCoord.q + offQ;
    
    if (newR >= 0 && newR < newHeight && newQ >= 0 && newQ < newWidth) {
      // Place the filled cell
      newCells[newR][newQ] = true;
      
      // Transform and place the edges for this cell
      const oldEdges = edgeState[oldPos.r]?.[oldPos.q];
      if (oldEdges) {
        const newEdges = new Array(oldEdges.length).fill(false);
        for (let i = 0; i < oldEdges.length; i++) {
          const newIndex = neighborPerm[i];
          newEdges[newIndex] = oldEdges[i];
        }
        newEdgeState[newR][newQ] = newEdges;
      }
    }
  }
  
  return { cells: newCells, edgeState: newEdgeState };
}

/**
 * Rotate both cells and edge state together.
 */
export function rotateCellsAndEdges(
  grid: GridDefinition,
  cells: boolean[][],
  edgeState: EdgeState
): { cells: boolean[][]; edgeState: EdgeState } {
  return transformCellsAndEdges(grid, cells, edgeState, grid.rotate);
}

/**
 * Flip both cells and edge state together horizontally.
 */
export function flipCellsAndEdges(
  grid: GridDefinition,
  cells: boolean[][],
  edgeState: EdgeState
): { cells: boolean[][]; edgeState: EdgeState } {
  return transformCellsAndEdges(grid, cells, edgeState, grid.flip);
}
