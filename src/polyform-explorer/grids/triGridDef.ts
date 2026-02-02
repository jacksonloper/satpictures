/**
 * Triangle Grid Definition
 * 
 * Defines the geometry for polyiamond tilings on a triangular grid.
 * The grid consists of alternating up-pointing and down-pointing triangles.
 * 
 * Coordinate system:
 * - Axial coordinates (q, r) where triangles tessellate
 * - Triangle orientation: (q + r) % 2 === 0 means UP-pointing, otherwise DOWN-pointing
 * - Each triangle has 3 neighbors
 * 
 * For transforms, we use a vertex-based approach where each triangle is
 * represented by its 3 lattice vertices, transform the vertices, then
 * convert back to (q, r) coordinates.
 */

import type { GridDefinition, Coord, TransformResult, Vertex, NeighborInfo } from './types';

/**
 * Determine if a triangle is up-pointing or down-pointing.
 * Type 0: up-pointing (q + r is even)
 * Type 1: down-pointing (q + r is odd)
 */
function getTriCellType(coord: Coord): number {
  return (coord.q + coord.r) % 2 === 0 ? 0 : 1;
}

/**
 * Triangle Grid Geometry
 * 
 * Vertices and neighbors are ordered so that edge i (from vertex[i] to vertex[(i+1)%3])
 * faces neighbor[i]. This consistent ordering enables the unified grid model.
 * 
 * For UP-pointing triangles (type 0):
 * - v0: apex (top), v1: bottom-left, v2: bottom-right
 * - Edge 0 (v0->v1): left edge, faces left neighbor (q-1, r)
 * - Edge 1 (v1->v2): bottom edge, faces bottom neighbor (q, r+1)
 * - Edge 2 (v2->v0): right edge, faces right neighbor (q+1, r)
 * 
 * For DOWN-pointing triangles (type 1):
 * - v0: top-left, v1: top-right, v2: apex (bottom)
 * - Edge 0 (v0->v1): top edge, faces top neighbor (q, r-1)
 * - Edge 1 (v1->v2): right edge, faces right neighbor (q+1, r)
 * - Edge 2 (v2->v0): left edge, faces left neighbor (q-1, r)
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

// Redefine neighbors to match vertex edge order (using axial q, r):
// For up triangle: v0->v1 (left), v1->v2 (bottom), v2->v0 (right)
const upTriNeighborsReordered: NeighborInfo[] = [
  { dq: -1, dr: 0 },   // left (edge 0: v0->v1)
  { dq: 0, dr: 1 },    // bottom (edge 1: v1->v2)
  { dq: 1, dr: 0 },    // right (edge 2: v2->v0)
];

// For down triangle: v0->v1 (top), v1->v2 (right), v2->v0 (left)
const downTriNeighborsReordered: NeighborInfo[] = [
  { dq: 0, dr: -1 },   // top (edge 0: v0->v1)
  { dq: 1, dr: 0 },    // right (edge 1: v1->v2)
  { dq: -1, dr: 0 },   // left (edge 2: v2->v0)
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
 * Convert (q, r) cell to 3 vertices in half-edge coords.
 */
function cellToVertices(q: number, r: number): IntVertex[] {
  const isUp = (q + r) % 2 === 0;
  
  if (isUp) {
    // Up triangle vertices: apex at (q+1, r), base at r+1
    return [
      { X: q + 1, Y: r },
      { X: q, Y: r + 1 },
      { X: q + 2, Y: r + 1 },
    ];
  } else {
    // Down triangle vertices: apex at (q+1, r+1), base at r
    return [
      { X: q, Y: r },
      { X: q + 2, Y: r },
      { X: q + 1, Y: r + 1 },
    ];
  }
}

/**
 * Convert 3 vertices back to (q, r) cell.
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
    const q = Math.min(high[0].X, high[1].X);
    const r = minY;
    return { q, r };
  } else if (low.length === 2 && high.length === 1) {
    // Down triangle: base at minY
    const q = Math.min(low[0].X, low[1].X);
    const r = minY;
    return { q, r };
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
  const verts = cellToVertices(coord.q, coord.r);
  
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
  const verts = cellToVertices(coord.q, coord.r);
  
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
  const isUp = (coord.q + coord.r) % 2 === 0;
  
  // Position based on tessellation
  const x = (coord.q + 1) * (triWidth / 2);
  const y = coord.r * triHeight + (isUp ? triHeight * 2/3 : triHeight * 1/3);
  
  return { x, y };
}

/**
 * Get the vertices of a triangle cell in screen coordinates.
 */
function getCellVertices(coord: Coord, cellSize: number): Array<{ x: number; y: number }> {
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  const isUp = (coord.q + coord.r) % 2 === 0;
  
  const x = coord.q * (triWidth / 2);
  const y = coord.r * triHeight;
  
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
  
  // Translation vectors that preserve parity (q + r must stay same mod 2)
  // Moving by (2, 0) preserves parity: (q+2 + r) % 2 = (q + r) % 2
  // Moving by (1, 1) preserves parity: (q+1 + r+1) % 2 = (q + r) % 2
  translateVectors: [
    { q: 2, r: 0 },   // Move right by 2 (preserves parity)
    { q: 1, r: 1 },   // Move diagonally (preserves parity)
  ],
  
  vertices: [upTriVertices, downTriVertices],
  
  getCellCenter,
  getCellVertices,
};

// Export the upTriNeighbors and downTriNeighbors for external use
export { upTriNeighborsReordered as upTriNeighbors, downTriNeighborsReordered as downTriNeighbors };
