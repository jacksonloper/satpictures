/**
 * Polyform transformation utilities for polyomino, polyhex, and polyiamond shapes.
 * Contains rotation and flip operations using coordinate geometry.
 */

/** Polyform type - determines the grid geometry */
export type PolyformType = "polyomino" | "polyhex" | "polyiamond";

export type PolyhexTransform = "flipH" | "flipV";
export type PolyiamondTransform = "flipH" | "flipV" | "rot60";

/**
 * Create an empty grid of boolean cells.
 */
export function createEmptyBooleanGrid(width: number, height: number): boolean[][] {
  return Array.from({ length: height }, () => 
    Array.from({ length: width }, () => false)
  );
}

/**
 * Rotate the polyform 90 degrees clockwise (for square/polyomino).
 * For hex and iamond, rotation is 60 degrees.
 */
export function rotatePolyomino(cells: boolean[][]): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  // Rotate 90° clockwise: new[col][height-1-row] = old[row][col]
  const newCells: boolean[][] = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => false)
  );
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      newCells[col][height - 1 - row] = cells[row][col];
    }
  }
  return newCells;
}

/**
 * Rotate hex grid 60° clockwise.
 * Uses cube coordinates for rotation, then converts back.
 */
export function rotatePolyhex(cells: boolean[][]): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Find all filled cells and convert to cube coordinates
  const filledCubes: { x: number; y: number; z: number }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (cells[row][col]) {
        // Offset to cube (odd-r layout)
        const x = col - Math.floor(row / 2);
        const z = row;
        const y = -x - z;
        filledCubes.push({ x, y, z });
      }
    }
  }
  
  if (filledCubes.length === 0) return cells;
  
  // Rotate 60° clockwise in cube coords: (x, y, z) -> (-z, -x, -y)
  const rotatedCubes = filledCubes.map(({ x, y, z }) => ({
    x: -z,
    y: -x,
    z: -y,
  }));
  
  // Find bounding box and normalize to positive coordinates
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const cube of rotatedCubes) {
    minX = Math.min(minX, cube.x);
    maxX = Math.max(maxX, cube.x);
    minZ = Math.min(minZ, cube.z);
    maxZ = Math.max(maxZ, cube.z);
  }
  
  // Calculate new dimensions
  const newHeight = maxZ - minZ + 1;
  const newWidth = maxX - minX + 1 + Math.floor(newHeight / 2);
  
  // Create new grid and fill
  const newCells: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );
  
  for (const cube of rotatedCubes) {
    const row = cube.z - minZ;
    const col = cube.x - minX + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      newCells[row][col] = true;
    }
  }
  
  return newCells;
}

/**
 * Rotate polyiamond (triangle grid) 60° clockwise.
 * Correct implementation via rotating each triangle's lattice vertices.
 */
export function rotatePolyiamond(cells: boolean[][]): boolean[][] {
  return transformPolyiamond(cells, "rot60");
}

/**
 * Convert polyhex (odd-r offset) filled cells -> axial (q,r),
 * apply a transform, then rasterize back to odd-r offset grid.
 *
 * These reflections are defined to match screen axes:
 * - Horizontal flip: mirror across a vertical screen line (x -> -x), keep r
 * - Vertical flip: mirror across a horizontal screen line (y -> -y), r -> -r
 *
 * Using pointy-top axial pixel relation: x ~ q + r/2, y ~ r.
 */
export function transformPolyhex(cells: boolean[][], t: PolyhexTransform): boolean[][] {
  const height = cells.length;
  if (height === 0) return cells;
  const width = cells[0]?.length ?? 0;
  if (width === 0) return cells;

  const filled: { q: number; r: number }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;
      // odd-r -> axial(q,r) with r=row
      const q = col - Math.floor(row / 2);
      const r = row;
      filled.push({ q, r });
    }
  }
  if (filled.length === 0) return cells;

  const transformed = filled.map(({ q, r }) => {
    if (t === "flipH") {
      // x' = -(q + r/2), y' = r  => q' = -q - r, r' = r
      return { q: -q - r, r };
    } else {
      // y' = -r, x' same => q' = q + r, r' = -r
      return { q: q + r, r: -r };
    }
  });

  // Bounding in axial (q,r)
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const coord of transformed) {
    minQ = Math.min(minQ, coord.q);
    maxQ = Math.max(maxQ, coord.q);
    minR = Math.min(minR, coord.r);
    maxR = Math.max(maxR, coord.r);
  }

  const newHeight = maxR - minR + 1;
  const newWidth = (maxQ - minQ + 1) + Math.floor(newHeight / 2);

  const out: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );

  for (const { q, r } of transformed) {
    const row = r - minR;
    const col = (q - minQ) + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      out[row][col] = true;
    }
  }

  return out;
}

/**
 * Polyiamond transforms via lattice-vertex representation.
 *
 * We treat each small triangle as having 3 vertices on the triangular lattice.
 * Use lattice coords (u,v) where physical x = u + v/2 and y = v*(sqrt3/2).
 *
 * Vertex conversions:
 *   X = 2x (in half-edge units) = 2u + v
 *   Y = v
 * so u = (X - Y)/2, v = Y
 *
 * Transforms (matching screen axes used by the renderer):
 *   rot60 CW: (u,v) -> (u+v, -u)
 *   flipH:    x -> -x => (u,v) -> (-u - v, v)
 *   flipV:    y -> -y => (u,v) -> (u+v, -v)
 */
export function transformPolyiamond(cells: boolean[][], t: PolyiamondTransform): boolean[][] {
  const height = cells.length;
  if (height === 0) return cells;
  const width = cells[0]?.length ?? 0;
  if (width === 0) return cells;

  type Vertex = { X: number; Y: number }; // integer "half-edge" coords (X step = half base, Y step = row)
  type UV = { u: number; v: number };

  const toUV = (p: Vertex): UV => {
    // IMPORTANT:
    // Our triangle vertices always satisfy (X - Y) is ODD.
    // So we use the "odd sublattice" mapping: u = (X - Y - 1)/2 (integer), v = Y (integer).
    return { u: (p.X - p.Y - 1) / 2, v: p.Y };
  };

  const fromUV = (p: UV): Vertex => {
    // Inverse of the above: X = 2u + v + 1, Y = v
    return { X: 2 * p.u + p.v + 1, Y: p.v };
  };

  const applyUV = (p: UV): UV => {
    if (t === "rot60") return { u: p.u + p.v, v: -p.u };
    if (t === "flipH") return { u: -p.u - p.v, v: p.v };
    // flipV
    return { u: p.u + p.v, v: -p.v };
  };

  // Build triangle list as 3 vertices each
  const tris: Vertex[][] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;

      const isUp = (row + col) % 2 === 0;

      // Using the renderer geometry in integer half-edge coords:
      // x = col*(base/2) => X = col
      // y = row*(height) => Y = row
      if (isUp) {
        // Up triangle vertices: (col+1,row), (col,row+1), (col+2,row+1)
        tris.push([
          { X: col + 1, Y: row },
          { X: col, Y: row + 1 },
          { X: col + 2, Y: row + 1 },
        ]);
      } else {
        // Down triangle vertices: (col,row), (col+2,row), (col+1,row+1)
        tris.push([
          { X: col, Y: row },
          { X: col + 2, Y: row },
          { X: col + 1, Y: row + 1 },
        ]);
      }
    }
  }

  if (tris.length === 0) return cells;

  // Transform all triangles
  const transformedTris: Vertex[][] = tris.map((verts) =>
    verts.map((vtx) => fromUV(applyUV(toUV(vtx))))
  );

  // Convert transformed triangles back into (row,col) cells
  const cellsOut: { row: number; col: number }[] = [];

  for (const verts of transformedTris) {
    const Ys = verts.map((p) => p.Y);
    const minY = Math.min(...Ys);
    const maxY = Math.max(...Ys);

    // Each elementary triangle spans exactly 1 in Y in this coordinate system
    if (maxY - minY !== 1) continue;

    const low = verts.filter((p) => p.Y === minY);
    const high = verts.filter((p) => p.Y === maxY);

    if (low.length === 1 && high.length === 2) {
      // Up triangle: base at maxY, col = minX among base vertices, row = minY
      const col = Math.min(high[0].X, high[1].X);
      const row = minY;
      cellsOut.push({ row, col });
    } else if (low.length === 2 && high.length === 1) {
      // Down triangle: base at minY, col = minX among base vertices, row = minY
      const col = Math.min(low[0].X, low[1].X);
      const row = minY;
      cellsOut.push({ row, col });
    }
  }

  if (cellsOut.length === 0) return cells;

  // Normalize to positive row/col bounding box
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const p of cellsOut) {
    minRow = Math.min(minRow, p.row);
    maxRow = Math.max(maxRow, p.row);
    minCol = Math.min(minCol, p.col);
    maxCol = Math.max(maxCol, p.col);
  }

  // Base offsets to bring mins to 0
  const offRow = -minRow;
  let offCol = -minCol;

  // IMPORTANT: preserve (row+col)%2 orientation.
  // If offRow+offCol is odd, shift by 1 in col to maintain triangle parity.
  if (((offRow + offCol) & 1) !== 0) {
    offCol += 1;
  }

  const newHeight = maxRow + offRow + 1;
  const newWidth = maxCol + offCol + 1;

  const out: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );

  for (const p of cellsOut) {
    const r = p.row + offRow;
    const c = p.col + offCol;
    if (r >= 0 && r < newHeight && c >= 0 && c < newWidth) {
      out[r][c] = true;
    }
  }

  return out;
}

/**
 * Flip the polyform horizontally (simple array reverse).
 * Used for polyomino (square) grids where array reversal produces correct results.
 * For polyhex and polyiamond, use the geometry-correct transform functions instead.
 */
export function flipHorizontal(cells: boolean[][]): boolean[][] {
  return cells.map(row => [...row].reverse());
}

/**
 * Flip the polyform vertically (simple array reverse).
 * Used for polyomino (square) grids where array reversal produces correct results.
 * For polyhex and polyiamond, use the geometry-correct transform functions instead.
 */
export function flipVertical(cells: boolean[][]): boolean[][] {
  return [...cells].reverse();
}

// ======================================================================
// Edge State Transformation Functions
// These match the cell transformations exactly to maintain consistency
// between cells and their edge markings.
// ======================================================================

type EdgeState = boolean[][][];

/**
 * Rotate edge state for polyomino (square grid) 90° clockwise.
 * Matches rotatePolyomino.
 * 
 * For square grid, neighbors are: 0=up, 1=right, 2=down, 3=left
 * After 90° CW: up->right, right->down, down->left, left->up
 * So edge permutation: 0->1, 1->2, 2->3, 3->0 (shift by +1 mod 4)
 */
export function rotatePolyominoEdgeState(edgeState: EdgeState): EdgeState {
  const height = edgeState.length;
  const width = edgeState[0]?.length ?? 0;
  
  if (height === 0 || width === 0) return edgeState;
  
  // New dimensions: newHeight = width, newWidth = height
  const newHeight = width;
  const newWidth = height;
  
  const newEdgeState: EdgeState = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => [false, false, false, false])
  );
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Same transform as cells: new[col][height-1-row] = old[row][col]
      const newRow = col;
      const newCol = height - 1 - row;
      
      const oldEdges = edgeState[row][col];
      if (!oldEdges) continue;
      
      // Permute edges: 90° CW means edge i becomes edge (i+1) % 4
      const newEdges: boolean[] = [false, false, false, false];
      for (let i = 0; i < 4; i++) {
        newEdges[(i + 1) % 4] = oldEdges[i] ?? false;
      }
      
      newEdgeState[newRow][newCol] = newEdges;
    }
  }
  
  return newEdgeState;
}

/**
 * Flip edge state for polyomino (square grid) horizontally.
 * Matches flipHorizontal.
 * 
 * For square grid: 0=up, 1=right, 2=down, 3=left
 * Horizontal flip: up->up, right<->left, down->down
 * Edge permutation: 0->0, 1<->3, 2->2
 */
export function flipPolyominoEdgeStateH(edgeState: EdgeState): EdgeState {
  return edgeState.map(row => 
    [...row].reverse().map(edges => {
      if (!edges) return [false, false, false, false];
      // Swap left and right edges: 0->0, 1<->3, 2->2
      return [edges[0], edges[3], edges[2], edges[1]];
    })
  );
}

/**
 * Flip edge state for polyomino (square grid) vertically.
 * Matches flipVertical.
 * 
 * For square grid: 0=up, 1=right, 2=down, 3=left
 * Vertical flip: up<->down, left->left, right->right
 * Edge permutation: 0<->2, 1->1, 3->3
 */
export function flipPolyominoEdgeStateV(edgeState: EdgeState): EdgeState {
  return [...edgeState].reverse().map(row =>
    row.map(edges => {
      if (!edges) return [false, false, false, false];
      // Swap up and down edges: 0<->2, 1->1, 3->3
      return [edges[2], edges[1], edges[0], edges[3]];
    })
  );
}

/**
 * Rotate edge state for polyhex 60° clockwise.
 * Matches rotatePolyhex exactly - uses cube coordinates.
 * 
 * For hex grid, 6 neighbors: 0=NE, 1=E, 2=SE, 3=SW, 4=W, 5=NW
 * After 60° CW: each edge shifts +1 position (mod 6)
 */
export function rotatePolyhexEdgeState(edgeState: EdgeState): EdgeState {
  const height = edgeState.length;
  const width = edgeState[0]?.length ?? 0;
  
  if (height === 0 || width === 0) return edgeState;
  
  // Collect all cells with any filled edges and convert to cube coordinates
  type CellEdge = { x: number; y: number; z: number; edges: boolean[] };
  const cellEdges: CellEdge[] = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const edges = edgeState[row][col];
      // Only include cells that have at least one filled edge
      if (!edges || !edges.some(e => e)) continue;
      
      // Offset to cube (odd-r layout) - same as rotatePolyhex
      const x = col - Math.floor(row / 2);
      const z = row;
      const y = -x - z;
      cellEdges.push({ x, y, z, edges: [...edges] });
    }
  }
  
  if (cellEdges.length === 0) return edgeState;
  
  // Rotate 60° CW in cube coords: (x, y, z) -> (-z, -x, -y)
  const rotatedCells = cellEdges.map(({ x, y, z, edges }) => ({
    x: -z,
    y: -x,
    z: -y,
    // After 60° CW rotation, each edge direction rotates by 60°.
    // New edge i comes from old edge (i-1). E.g., new NE comes from old NW.
    // Formula: new_edges[i] = old_edges[(i - 1 + 6) % 6] = old_edges[(i + 5) % 6]
    edges: edges.map((_, i, arr) => arr[(i + 5) % 6]),
  }));
  
  // Find bounding box
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const cell of rotatedCells) {
    minX = Math.min(minX, cell.x);
    maxX = Math.max(maxX, cell.x);
    minZ = Math.min(minZ, cell.z);
    maxZ = Math.max(maxZ, cell.z);
  }
  
  // Calculate new dimensions - same as rotatePolyhex
  const newHeight = maxZ - minZ + 1;
  const newWidth = maxX - minX + 1 + Math.floor(newHeight / 2);
  
  // Create new edge state
  const newEdgeState: EdgeState = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => [false, false, false, false, false, false])
  );
  
  for (const cell of rotatedCells) {
    const row = cell.z - minZ;
    const col = cell.x - minX + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      newEdgeState[row][col] = cell.edges;
    }
  }
  
  return newEdgeState;
}

/**
 * Flip edge state for polyhex horizontally.
 * Matches transformPolyhex with "flipH".
 * 
 * For hex grid: 0=NE, 1=E, 2=SE, 3=SW, 4=W, 5=NW
 * Horizontal flip: NE<->NW, E<->W, SE<->SW
 * Edge permutation: 0<->5, 1<->4, 2<->3
 */
export function flipPolyhexEdgeStateH(edgeState: EdgeState): EdgeState {
  const height = edgeState.length;
  const width = edgeState[0]?.length ?? 0;
  
  if (height === 0 || width === 0) return edgeState;
  
  // Collect cells and convert to axial coords
  type CellEdge = { q: number; r: number; edges: boolean[] };
  const cellEdges: CellEdge[] = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const edges = edgeState[row][col];
      // Only include cells that have at least one filled edge
      if (!edges || !edges.some(e => e)) continue;
      
      // odd-r -> axial: q = col - floor(row/2), r = row
      const q = col - Math.floor(row / 2);
      const r = row;
      cellEdges.push({ q, r, edges: [...edges] });
    }
  }
  
  if (cellEdges.length === 0) return edgeState;
  
  // Horizontal flip: q' = -q - r, r' = r (same as transformPolyhex)
  const flippedCells = cellEdges.map(({ q, r, edges }) => ({
    q: -q - r,
    r,
    // Flip edges: 0<->5, 1<->4, 2<->3
    edges: [edges[5], edges[4], edges[3], edges[2], edges[1], edges[0]],
  }));
  
  // Find bounding box
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const cell of flippedCells) {
    minQ = Math.min(minQ, cell.q);
    maxQ = Math.max(maxQ, cell.q);
    minR = Math.min(minR, cell.r);
    maxR = Math.max(maxR, cell.r);
  }
  
  const newHeight = maxR - minR + 1;
  const newWidth = (maxQ - minQ + 1) + Math.floor(newHeight / 2);
  
  const newEdgeState: EdgeState = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => [false, false, false, false, false, false])
  );
  
  for (const { q, r, edges } of flippedCells) {
    const row = r - minR;
    const col = (q - minQ) + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      newEdgeState[row][col] = edges;
    }
  }
  
  return newEdgeState;
}

/**
 * Flip edge state for polyhex vertically.
 * Matches transformPolyhex with "flipV".
 * 
 * Vertical flip: q' = q + r, r' = -r
 * This is like rotating 180° around a horizontal axis.
 * Edge permutation for vertical flip: 0<->3, 1<->2, 4<->5 (flip across horizontal)
 */
export function flipPolyhexEdgeStateV(edgeState: EdgeState): EdgeState {
  const height = edgeState.length;
  const width = edgeState[0]?.length ?? 0;
  
  if (height === 0 || width === 0) return edgeState;
  
  // Collect cells and convert to axial coords
  type CellEdge = { q: number; r: number; edges: boolean[] };
  const cellEdges: CellEdge[] = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const edges = edgeState[row][col];
      // Only include cells that have at least one filled edge
      if (!edges || !edges.some(e => e)) continue;
      
      const q = col - Math.floor(row / 2);
      const r = row;
      cellEdges.push({ q, r, edges: [...edges] });
    }
  }
  
  if (cellEdges.length === 0) return edgeState;
  
  // Vertical flip: q' = q + r, r' = -r
  const flippedCells = cellEdges.map(({ q, r, edges }) => ({
    q: q + r,
    r: -r,
    // Flip edges across horizontal: 0<->3, 1<->2, 4<->5
    edges: [edges[3], edges[2], edges[1], edges[0], edges[5], edges[4]],
  }));
  
  // Find bounding box
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const cell of flippedCells) {
    minQ = Math.min(minQ, cell.q);
    maxQ = Math.max(maxQ, cell.q);
    minR = Math.min(minR, cell.r);
    maxR = Math.max(maxR, cell.r);
  }
  
  const newHeight = maxR - minR + 1;
  const newWidth = (maxQ - minQ + 1) + Math.floor(newHeight / 2);
  
  const newEdgeState: EdgeState = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => [false, false, false, false, false, false])
  );
  
  for (const { q, r, edges } of flippedCells) {
    const row = r - minR;
    const col = (q - minQ) + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      newEdgeState[row][col] = edges;
    }
  }
  
  return newEdgeState;
}

/**
 * Rotate edge state for polyiamond 60° clockwise.
 * Matches rotatePolyiamond.
 * 
 * For triangle grid:
 * - Up-pointing (type 0): 3 edges (indices 0,1,2) facing different directions
 * - Down-pointing (type 1): 3 edges (indices 0,1,2) facing opposite directions
 * 
 * 60° CW rotation shifts edge indices by +1 (mod 3)
 */
export function rotatePolyiamondEdgeState(edgeState: EdgeState): EdgeState {
  const height = edgeState.length;
  const width = edgeState[0]?.length ?? 0;
  
  if (height === 0 || width === 0) return edgeState;
  
  // Use the same transformation as transformPolyiamond with "rot60"
  type CellEdge = { row: number; col: number; edges: boolean[] };
  const cellEdges: CellEdge[] = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const edges = edgeState[row][col];
      // Only include cells that have at least one filled edge
      if (!edges || !edges.some(e => e)) continue;
      cellEdges.push({ row, col, edges: [...edges] });
    }
  }
  
  if (cellEdges.length === 0) return edgeState;
  
  // Use the same lattice-vertex transformation as transformPolyiamond
  const transformed = cellEdges.map(({ row, col, edges }) => {
    // Convert to lattice coords (matching transformPolyiamond)
    const X = col;
    const Y = row;
    // For rot60: (X, Y) -> (-Y, X + Y)
    const newX = -Y;
    const newY = X + Y;
    
    // Convert back to row, col
    const newRow = newY;
    const newCol = newX;
    
    // After 60° CW rotation, edges shift positions.
    // For triangles with 3 edges: new_edges[i] = old_edges[(i - 1 + 3) % 3]
    // new_edges[0] = old_edges[2], new_edges[1] = old_edges[0], new_edges[2] = old_edges[1]
    const newEdges = [edges[2], edges[0], edges[1]];
    
    return { row: newRow, col: newCol, edges: newEdges };
  });
  
  // Find bounding box
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const cell of transformed) {
    minRow = Math.min(minRow, cell.row);
    maxRow = Math.max(maxRow, cell.row);
    minCol = Math.min(minCol, cell.col);
    maxCol = Math.max(maxCol, cell.col);
  }
  
  // Offset to normalize, preserving parity
  const offRow = -minRow;
  let offCol = -minCol;
  if ((offRow + offCol) % 2 !== 0) {
    offCol += 1;
  }
  
  const newHeight = maxRow + offRow + 1;
  const newWidth = maxCol + offCol + 1;
  
  const newEdgeState: EdgeState = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => [false, false, false])
  );
  
  for (const { row, col, edges } of transformed) {
    const r = row + offRow;
    const c = col + offCol;
    if (r >= 0 && r < newHeight && c >= 0 && c < newWidth) {
      newEdgeState[r][c] = edges;
    }
  }
  
  return newEdgeState;
}

/**
 * Flip edge state for polyiamond horizontally.
 * Matches transformPolyiamond with "flipH".
 */
export function flipPolyiamondEdgeStateH(edgeState: EdgeState): EdgeState {
  const height = edgeState.length;
  const width = edgeState[0]?.length ?? 0;
  
  if (height === 0 || width === 0) return edgeState;
  
  type CellEdge = { row: number; col: number; edges: boolean[] };
  const cellEdges: CellEdge[] = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const edges = edgeState[row][col];
      // Only include cells that have at least one filled edge
      if (!edges || !edges.some(e => e)) continue;
      cellEdges.push({ row, col, edges: [...edges] });
    }
  }
  
  if (cellEdges.length === 0) return edgeState;
  
  // flipH: (X, Y) -> (-X - 1, Y) (from transformPolyiamond)
  const transformed = cellEdges.map(({ row, col, edges }) => {
    const newRow = row;
    const newCol = -col - 1;
    
    // Horizontal flip permutes edges differently for up vs down triangles
    // For simplicity, swap edge 0 and 2 (left<->right edges)
    const newEdges = [edges[2], edges[1], edges[0]];
    
    return { row: newRow, col: newCol, edges: newEdges };
  });
  
  // Find bounding box
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const cell of transformed) {
    minRow = Math.min(minRow, cell.row);
    maxRow = Math.max(maxRow, cell.row);
    minCol = Math.min(minCol, cell.col);
    maxCol = Math.max(maxCol, cell.col);
  }
  
  const offRow = -minRow;
  let offCol = -minCol;
  if ((offRow + offCol) % 2 !== 0) {
    offCol += 1;
  }
  
  const newHeight = maxRow + offRow + 1;
  const newWidth = maxCol + offCol + 1;
  
  const newEdgeState: EdgeState = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => [false, false, false])
  );
  
  for (const { row, col, edges } of transformed) {
    const r = row + offRow;
    const c = col + offCol;
    if (r >= 0 && r < newHeight && c >= 0 && c < newWidth) {
      newEdgeState[r][c] = edges;
    }
  }
  
  return newEdgeState;
}

/**
 * Flip edge state for polyiamond vertically.
 * Matches transformPolyiamond with "flipV".
 */
export function flipPolyiamondEdgeStateV(edgeState: EdgeState): EdgeState {
  const height = edgeState.length;
  const width = edgeState[0]?.length ?? 0;
  
  if (height === 0 || width === 0) return edgeState;
  
  type CellEdge = { row: number; col: number; edges: boolean[] };
  const cellEdges: CellEdge[] = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const edges = edgeState[row][col];
      // Only include cells that have at least one filled edge
      if (!edges || !edges.some(e => e)) continue;
      cellEdges.push({ row, col, edges: [...edges] });
    }
  }
  
  if (cellEdges.length === 0) return edgeState;
  
  // flipV: (X, Y) -> (X + Y, -Y - 1) (from transformPolyiamond, adjusted)
  const transformed = cellEdges.map(({ row, col, edges }) => {
    const newRow = -row - 1;
    const newCol = col + row;
    
    // Vertical flip changes up triangles to down and vice versa
    // Edge positions change accordingly:
    // UP (left=0, bottom=1, right=2) -> DOWN (top=0, right=1, left=2)
    //   Up edge 0 (left) -> Down edge 2 (left)
    //   Up edge 1 (bottom) -> Down edge 0 (top)  
    //   Up edge 2 (right) -> Down edge 1 (right)
    // DOWN (top=0, right=1, left=2) -> UP (left=0, bottom=1, right=2)
    //   Down edge 0 (top) -> Up edge 1 (bottom)
    //   Down edge 1 (right) -> Up edge 2 (right)
    //   Down edge 2 (left) -> Up edge 0 (left)
    const isUp = (row + col) % 2 === 0;
    const newEdges = isUp 
      ? [edges[1], edges[2], edges[0]]  // up -> down
      : [edges[2], edges[0], edges[1]]; // down -> up
    
    return { row: newRow, col: newCol, edges: newEdges };
  });
  
  // Find bounding box
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const cell of transformed) {
    minRow = Math.min(minRow, cell.row);
    maxRow = Math.max(maxRow, cell.row);
    minCol = Math.min(minCol, cell.col);
    maxCol = Math.max(maxCol, cell.col);
  }
  
  const offRow = -minRow;
  let offCol = -minCol;
  if ((offRow + offCol) % 2 !== 0) {
    offCol += 1;
  }
  
  const newHeight = maxRow + offRow + 1;
  const newWidth = maxCol + offCol + 1;
  
  const newEdgeState: EdgeState = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => [false, false, false])
  );
  
  for (const { row, col, edges } of transformed) {
    const r = row + offRow;
    const c = col + offCol;
    if (r >= 0 && r < newHeight && c >= 0 && c < newWidth) {
      newEdgeState[r][c] = edges;
    }
  }
  
  return newEdgeState;
}
