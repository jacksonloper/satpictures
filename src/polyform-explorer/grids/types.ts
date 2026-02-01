/**
 * Unified Grid Definition Types
 * 
 * A grid definition encapsulates all the geometric properties needed for polyform
 * tiling and display operations. This abstraction allows the SAT solver and
 * display code to work generically with any grid type.
 */

/** A 2D coordinate in the grid */
export interface Coord {
  row: number;
  col: number;
}

/**
 * Neighbor information for a given cell type.
 * Each entry describes how to reach a neighboring cell.
 */
export interface NeighborInfo {
  /** Row offset to reach this neighbor */
  dRow: number;
  /** Col offset to reach this neighbor */
  dCol: number;
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
 * Normalize a set of coordinates to have minimum row and col at 0,
 * while preserving cell type parity for grids that require it.
 */
export function normalizeCoords(grid: GridDefinition, coords: Coord[]): Coord[] {
  if (coords.length === 0) return [];
  
  // Find minimum values
  let minRow = Infinity, minCol = Infinity;
  for (const c of coords) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  // Base offsets
  const offRow = -minRow;
  let offCol = -minCol;
  
  // For triangle grids, we need to preserve (row+col) % 2 parity
  if (grid.numCellTypes === 2) {
    // Check if the offset changes parity
    if ((offRow + offCol) % 2 !== 0) {
      offCol += 1;
    }
  }
  
  return coords.map(c => ({
    row: c.row + offRow,
    col: c.col + offCol,
  }));
}

/**
 * Generate all unique transforms of a set of coordinates.
 * Returns array of { coords, transformIndex } where transformIndex
 * corresponds to: 0..numRotations-1 for rotations, 
 * numRotations..(2*numRotations-1) for flip+rotations.
 */
export function generateAllTransforms(
  grid: GridDefinition,
  baseCoords: Coord[]
): Array<{ coords: Coord[]; transformIndex: number }> {
  const transforms: Array<{ coords: Coord[]; transformIndex: number }> = [];
  const seen = new Set<string>();
  
  const coordsToKey = (cs: Coord[]): string => {
    const sorted = [...cs]
      .map(c => `${c.row},${c.col}`)
      .sort();
    return sorted.join(';');
  };
  
  // Generate all rotations
  let current = baseCoords;
  for (let rot = 0; rot < grid.numRotations; rot++) {
    const normalized = normalizeCoords(grid, current);
    const key = coordsToKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      transforms.push({ coords: normalized, transformIndex: rot });
    }
    // Rotate for next iteration
    current = current.map(c => grid.rotate(c).coord);
  }
  
  // Flip and generate all rotations
  current = baseCoords.map(c => grid.flip(c).coord);
  for (let rot = 0; rot < grid.numRotations; rot++) {
    const normalized = normalizeCoords(grid, current);
    const key = coordsToKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      transforms.push({ coords: normalized, transformIndex: grid.numRotations + rot });
    }
    // Rotate for next iteration
    current = current.map(c => grid.rotate(c).coord);
  }
  
  return transforms;
}

/**
 * Get bounding box of a set of coordinates.
 */
export function getBoundingBox(coords: Coord[]): {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  width: number;
  height: number;
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
    minRow,
    maxRow,
    minCol,
    maxCol,
    width: maxCol - minCol + 1,
    height: maxRow - minRow + 1,
  };
}

/**
 * Check if a coordinate is within a given rectangular grid.
 */
export function isInGrid(coord: Coord, width: number, height: number): boolean {
  return coord.row >= 0 && coord.row < height && 
         coord.col >= 0 && coord.col < width;
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
  for (let row = 0; row < height; row++) {
    const rowEdges: CellEdges[] = [];
    for (let col = 0; col < width; col++) {
      const cellType = grid.getCellType({ row, col });
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
 * @param row Cell row
 * @param col Cell column
 * @param edgeIndex Edge index to toggle
 * @returns New edge state with the edge toggled
 */
export function toggleEdge(
  edgeState: EdgeState,
  row: number,
  col: number,
  edgeIndex: number
): EdgeState {
  return edgeState.map((rowEdges, r) =>
    rowEdges.map((cellEdges, c) => {
      if (r === row && c === col) {
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
  
  // Transform all cells and collect their new positions + transformed edges
  const transformedCells: Array<{
    newCoord: Coord;
    newEdges: boolean[];
  }> = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const coord = { row, col };
      const result = transform(coord);
      const oldEdges = edgeState[row][col];
      
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
  
  // Find bounds of transformed coordinates
  let minRow = Infinity, minCol = Infinity;
  let maxRow = -Infinity, maxCol = -Infinity;
  for (const { newCoord } of transformedCells) {
    minRow = Math.min(minRow, newCoord.row);
    maxRow = Math.max(maxRow, newCoord.row);
    minCol = Math.min(minCol, newCoord.col);
    maxCol = Math.max(maxCol, newCoord.col);
  }
  
  // Compute offset for normalization (preserve parity for triangle grids)
  // For triangle grids, the cell type (up vs down) is determined by (row + col) % 2.
  // If we shift by an offset that changes this parity, up triangles would become down
  // triangles and vice versa, which would break the edge indexing. By ensuring
  // (offRow + offCol) is even, we preserve the original cell types.
  const offRow = -minRow;
  let offCol = -minCol;
  if (grid.numCellTypes === 2 && (offRow + offCol) % 2 !== 0) {
    offCol += 1;
  }
  
  // Create new edge state grid
  const newHeight = maxRow - minRow + 1;
  const newWidth = maxCol + offCol + 1;
  
  const newEdgeState: EdgeState = [];
  for (let r = 0; r < newHeight; r++) {
    const rowEdges: CellEdges[] = [];
    for (let c = 0; c < newWidth; c++) {
      const cellType = grid.getCellType({ row: r, col: c });
      const numEdges = grid.neighbors[cellType].length;
      rowEdges.push(new Array(numEdges).fill(false));
    }
    newEdgeState.push(rowEdges);
  }
  
  // Place transformed edges into new grid
  for (const { newCoord, newEdges } of transformedCells) {
    const r = newCoord.row + offRow;
    const c = newCoord.col + offCol;
    if (r >= 0 && r < newHeight && c >= 0 && c < newWidth) {
      newEdgeState[r][c] = newEdges;
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
