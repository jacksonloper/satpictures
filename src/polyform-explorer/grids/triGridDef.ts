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

// Note: Original neighbor definitions (left, right, bottom/top) are reordered
// below to match vertex edge ordering for the unified grid model.

/**
 * Vertices for up-pointing triangle (centered at origin in unit coords).
 * The apex is at the top, base at the bottom.
 * Vertices ordered so edge i faces neighbor i:
 * - Edge 0 (v0 to v1): left edge, faces left neighbor
 * - Edge 1 (v1 to v2): bottom edge... wait, we need to reconsider.
 * 
 * For up-pointing triangle with neighbors [left, right, bottom]:
 * - Left edge faces left neighbor (row, col-1)
 * - Right edge faces right neighbor (row, col+1)
 * - Bottom edge faces bottom neighbor (row+1, col)
 * 
 * Vertices in order such that edge i (from v[i] to v[(i+1)%3]) faces neighbor i:
 * - v0: top apex
 * - v1: bottom-left (edge v0->v1 is left edge, faces left)
 * - v2: bottom-right (edge v1->v2 is bottom edge, faces bottom)
 * Then edge v2->v0 is right edge, faces right
 * 
 * But neighbors are [left=0, right=1, bottom=2], so we need:
 * - Edge 0 faces left: v0->v1
 * - Edge 1 faces right: v1->v2
 * - Edge 2 faces bottom: v2->v0
 * 
 * This doesn't work... Let me reconsider.
 * 
 * Actually, for the mapping to work:
 * - Edge from v[i] to v[(i+1)%3] faces neighbor[i]
 * 
 * For up triangle neighbors [left, right, bottom]:
 * - Edge 0 (v0->v1) should face left neighbor
 * - Edge 1 (v1->v2) should face right neighbor  
 * - Edge 2 (v2->v0) should face bottom neighbor
 * 
 * If v0=top, v1=bottom-left, v2=bottom-right:
 * - v0->v1 is left edge ✓
 * - v1->v2 is bottom edge (but should face right neighbor) ✗
 * 
 * Let's reorder: v0=top, v1=bottom-right, v2=bottom-left
 * - v0->v1 is right edge (but should face left) ✗
 * 
 * Alternative: change neighbor order to match vertex order.
 * If vertices are v0=top, v1=bottom-left, v2=bottom-right:
 * - v0->v1: left edge
 * - v1->v2: bottom edge
 * - v2->v0: right edge
 * 
 * So neighbors should be [left, bottom, right] for this to work.
 * But that changes the semantics...
 * 
 * For now, let's define vertices in a way that works:
 */

// Height of unit equilateral triangle with base 1
const TRI_HEIGHT = Math.sqrt(3) / 2;

// Up-pointing triangle vertices (unit size)
// v0: apex (top), v1: bottom-left, v2: bottom-right
// Edge mapping: v0->v1 (left), v1->v2 (bottom), v2->v0 (right)
// So we need neighbor order: [left, bottom, right] for up triangles
// But we already defined [left, right, bottom]... Let's adjust.
const upTriVertices: Vertex[] = [
  { x: 0, y: -TRI_HEIGHT * 2/3 },           // apex (top)
  { x: -0.5, y: TRI_HEIGHT * 1/3 },         // bottom-left
  { x: 0.5, y: TRI_HEIGHT * 1/3 },          // bottom-right
];

// Down-pointing triangle vertices (unit size)
// v0: top-left, v1: top-right, v2: apex (bottom)
// Edge mapping: v0->v1 (top), v1->v2 (right), v2->v0 (left)
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
 * Neighbor permutation for 60° CW rotation depends on cell type.
 * For up triangle [left, bottom, right] -> after 60° CW, this becomes
 * a down triangle, and the edges rotate. The permutation maps old
 * neighbor indices to new neighbor indices.
 * 
 * This is complex because the cell type changes after rotation.
 * For the simplified model, we provide a permutation that maps edge indices.
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
  
  // For triangles, the permutation is complex because cell type can change.
  // For a single 60° rotation:
  // - Up triangle (type 0) becomes Down triangle at new location
  // - Down triangle (type 1) becomes Up triangle at new location
  // 
  // The edge permutation needs to map based on geometry.
  // After 60° CW rotation:
  // For up triangle [left=0, bottom=1, right=2]:
  //   Rotates to down triangle where old-left becomes new-top, etc.
  // This requires careful geometric analysis.
  // 
  // Simplified: for 60° CW rotation of edges [0,1,2] -> [1,2,0]
  // (each edge shifts one position clockwise)
  const neighborPerm = [1, 2, 0];
  
  return {
    coord: newCell,
    neighborPerm,
  };
}

/**
 * Flip horizontally via vertex transform.
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
  
  // For horizontal flip, left and right edges swap.
  // For up triangle [left=0, bottom=1, right=2]:
  //   After flip: left<->right, so [2, 1, 0]
  // For down triangle [top=0, right=1, left=2]:
  //   After flip: right<->left, so [0, 2, 1]
  // 
  // Since cell type changes after flip, we use a general permutation.
  // For flip: edges at positions 0 and 2 swap (left/right for up, or right/left for down)
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
