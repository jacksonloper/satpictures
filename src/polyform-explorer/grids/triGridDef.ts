/**
 * Triangle Grid Definition
 * 
 * Defines the geometry for polyiamond tilings on a triangular grid.
 * The grid consists of alternating up-pointing and down-pointing triangles.
 * 
 * Coordinate system:
 * - (row, col) where triangles tessellate
 * - Triangle orientation: (row + col) % 2 === 0 means UP-pointing, otherwise DOWN-pointing
 * - Each triangle has 3 neighbors
 * 
 * For transforms, we use a vertex-based approach where each triangle is
 * represented by its 3 lattice vertices, transform the vertices, then
 * convert back to (row, col) coordinates.
 */

import type { GridDefinition, Coord, TransformResult, Vertex, NeighborInfo } from './types';

/**
 * Determine if a triangle is up-pointing or down-pointing.
 * Type 0: up-pointing (row + col is even)
 * Type 1: down-pointing (row + col is odd)
 */
function getTriCellType(coord: Coord): number {
  return (coord.row + coord.col) % 2 === 0 ? 0 : 1;
}

/**
 * Triangle Grid Geometry
 * 
 * Vertices and neighbors are ordered so that edge i (from vertex[i] to vertex[(i+1)%3])
 * faces neighbor[i]. This consistent ordering enables the unified grid model.
 * 
 * For UP-pointing triangles (type 0):
 * - v0: apex (top), v1: bottom-left, v2: bottom-right
 * - Edge 0 (v0->v1): left edge, faces left neighbor (row, col-1)
 * - Edge 1 (v1->v2): bottom edge, faces bottom neighbor (row+1, col)
 * - Edge 2 (v2->v0): right edge, faces right neighbor (row, col+1)
 * 
 * For DOWN-pointing triangles (type 1):
 * - v0: top-left, v1: top-right, v2: apex (bottom)
 * - Edge 0 (v0->v1): top edge, faces top neighbor (row-1, col)
 * - Edge 1 (v1->v2): right edge, faces right neighbor (row, col+1)
 * - Edge 2 (v2->v0): left edge, faces left neighbor (row, col-1)
 */

// Height of unit equilateral triangle with base 1
const TRI_HEIGHT = Math.sqrt(3) / 2;

// Up-pointing triangle vertices (unit size, centered at origin)
const upTriVertices: Vertex[] = [
  { x: 0, y: -TRI_HEIGHT * 2/3 },           // apex (top) - v0
  { x: -0.5, y: TRI_HEIGHT * 1/3 },         // bottom-left - v1
  { x: 0.5, y: TRI_HEIGHT * 1/3 },          // bottom-right - v2
];

// Down-pointing triangle vertices (unit size, centered at origin)
const downTriVertices: Vertex[] = [
  { x: -0.5, y: -TRI_HEIGHT * 1/3 },        // top-left
  { x: 0.5, y: -TRI_HEIGHT * 1/3 },         // top-right
  { x: 0, y: TRI_HEIGHT * 2/3 },            // apex (bottom)
];

// Redefine neighbors to match vertex edge order:
// For up triangle: v0->v1 (left), v1->v2 (bottom), v2->v0 (right)
const upTriNeighborsReordered: NeighborInfo[] = [
  { dRow: 0, dCol: -1 },   // left (edge 0: v0->v1)
  { dRow: 1, dCol: 0 },    // bottom (edge 1: v1->v2)
  { dRow: 0, dCol: 1 },    // right (edge 2: v2->v0)
];

// For down triangle: v0->v1 (top), v1->v2 (right), v2->v0 (left)
const downTriNeighborsReordered: NeighborInfo[] = [
  { dRow: -1, dCol: 0 },   // top (edge 0: v0->v1)
  { dRow: 0, dCol: 1 },    // right (edge 1: v1->v2)
  { dRow: 0, dCol: -1 },   // left (edge 2: v2->v0)
];

// ----- Vertex-based transform system -----

/** Integer vertex coordinates (half-edge coords) */
interface IntVertex {
  X: number;
  Y: number;
}

/** Lattice UV coordinates for geometric transforms */
interface UV {
  u: number;
  v: number;
}

function vertexToUV(p: IntVertex): UV {
  // Triangle vertices always satisfy (X - Y) is ODD.
  // We use the "odd sublattice" mapping: u = (X - Y - 1)/2, v = Y
  return { u: (p.X - p.Y - 1) / 2, v: p.Y };
}

function uvToVertex(p: UV): IntVertex {
  // Inverse: X = 2u + v + 1, Y = v
  return { X: 2 * p.u + p.v + 1, Y: p.v };
}

function rotateUV60CW(p: UV): UV {
  // rot60 CW: (u,v) -> (u+v, -u)
  return { u: p.u + p.v, v: -p.u };
}

function flipUVH(p: UV): UV {
  // flipH: x -> -x => (u,v) -> (-u - v, v)
  return { u: -p.u - p.v, v: p.v };
}

/**
 * Convert (row, col) cell to 3 vertices in half-edge coords.
 */
function cellToVertices(row: number, col: number): IntVertex[] {
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
 */
function verticesToCell(verts: IntVertex[]): Coord | null {
  if (verts.length !== 3) return null;
  
  const Ys = verts.map(p => p.Y);
  const minY = Math.min(...Ys);
  const maxY = Math.max(...Ys);
  
  // Each elementary triangle spans exactly 1 in Y
  if (maxY - minY !== 1) return null;
  
  const low = verts.filter(p => p.Y === minY);
  const high = verts.filter(p => p.Y === maxY);
  
  if (low.length === 1 && high.length === 2) {
    // Up triangle: base at maxY
    const col = Math.min(high[0].X, high[1].X);
    const row = minY;
    return { row, col };
  } else if (low.length === 2 && high.length === 1) {
    // Down triangle: base at minY
    const col = Math.min(low[0].X, low[1].X);
    const row = minY;
    return { row, col };
  }
  
  return null;
}

/**
 * Rotate 60° clockwise via vertex transform.
 * 
 * For triangles, the neighbor permutation after a 60° CW rotation is [1, 2, 0].
 * This is because edges shift one position clockwise:
 * - Edge 0 (originally facing one direction) now faces where edge 2 was pointing
 * - Edge 1 now faces where edge 0 was pointing  
 * - Edge 2 now faces where edge 1 was pointing
 * 
 * The transform works correctly regardless of whether the starting triangle
 * is up-pointing or down-pointing, as the vertex-based transformation
 * handles the type change automatically.
 */
function rotateTri(coord: Coord): TransformResult {
  const verts = cellToVertices(coord.row, coord.col);
  
  // Transform all vertices
  const transformedVerts = verts.map(v => {
    const uv = vertexToUV(v);
    const rotated = rotateUV60CW(uv);
    return uvToVertex(rotated);
  });
  
  const newCell = verticesToCell(transformedVerts);
  if (!newCell) {
    // Shouldn't happen for valid transforms
    return { coord, neighborPerm: [0, 1, 2] };
  }
  
  // Neighbor permutation for 60° CW rotation: edges shift one position clockwise
  const neighborPerm = [1, 2, 0];
  
  return {
    coord: newCell,
    neighborPerm,
  };
}

/**
 * Flip horizontally via vertex transform.
 * 
 * For horizontal flip, the edge permutation swaps positions 0 and 2 while
 * keeping position 1 in place. This corresponds to mirroring left/right edges.
 */
function flipTri(coord: Coord): TransformResult {
  const verts = cellToVertices(coord.row, coord.col);
  
  // Transform all vertices
  const transformedVerts = verts.map(v => {
    const uv = vertexToUV(v);
    const flipped = flipUVH(uv);
    return uvToVertex(flipped);
  });
  
  const newCell = verticesToCell(transformedVerts);
  if (!newCell) {
    return { coord, neighborPerm: [0, 1, 2] };
  }
  
  // Neighbor permutation for horizontal flip: edges 0 and 2 swap, edge 1 stays
  const neighborPerm = [2, 1, 0];
  
  return {
    coord: newCell,
    neighborPerm,
  };
}

/**
 * Get the center position of a triangle cell in screen coordinates.
 */
function getCellCenter(coord: Coord, cellSize: number): { x: number; y: number } {
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  const isUp = (coord.row + coord.col) % 2 === 0;
  
  // Position based on tessellation
  const x = (coord.col + 1) * (triWidth / 2);
  const y = coord.row * triHeight + (isUp ? triHeight * 2/3 : triHeight * 1/3);
  
  return { x, y };
}

/**
 * Get the vertices of a triangle cell in screen coordinates.
 */
function getCellVertices(coord: Coord, cellSize: number): Array<{ x: number; y: number }> {
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  const isUp = (coord.row + coord.col) % 2 === 0;
  
  const x = coord.col * (triWidth / 2);
  const y = coord.row * triHeight;
  
  if (isUp) {
    return [
      { x: x + triWidth / 2, y: y },              // apex (top)
      { x: x, y: y + triHeight },                  // bottom-left
      { x: x + triWidth, y: y + triHeight },       // bottom-right
    ];
  } else {
    return [
      { x: x, y: y },                              // top-left
      { x: x + triWidth, y: y },                   // top-right
      { x: x + triWidth / 2, y: y + triHeight },   // apex (bottom)
    ];
  }
}

export const triGridDefinition: GridDefinition = {
  name: 'triangle',
  numCellTypes: 2,  // Up and down triangles
  
  getCellType: getTriCellType,
  
  // Neighbors for each cell type, ordered to match vertex edges
  neighbors: [upTriNeighborsReordered, downTriNeighborsReordered],
  
  numRotations: 6,  // 60° steps
  
  rotate: rotateTri,
  flip: flipTri,
  
  // Translation vectors that preserve parity (row + col must stay same mod 2)
  // Moving by (2, 0) preserves parity: (r+2 + c) % 2 = (r + c) % 2
  // Moving by (1, 1) preserves parity: (r+1 + c+1) % 2 = (r + c) % 2
  translateVectors: [
    { row: 0, col: 2 },   // Move right by 2 (preserves parity)
    { row: 1, col: 1 },   // Move diagonally (preserves parity)
  ],
  
  vertices: [upTriVertices, downTriVertices],
  
  getCellCenter,
  getCellVertices,
};

// Export the upTriNeighbors and downTriNeighbors for external use
export { upTriNeighborsReordered as upTriNeighbors, downTriNeighborsReordered as downTriNeighbors };
