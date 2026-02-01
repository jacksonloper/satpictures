/**
 * Hexagonal Grid Definition
 * 
 * Defines the geometry for polyhex tilings on a hexagonal grid.
 * Uses pointy-top hexagons with odd-r offset coordinate storage.
 * Each cell has 6 neighbors.
 * 
 * Coordinate system:
 * - Storage: odd-r offset coordinates (row, col) where odd rows are shifted right
 * - For transforms, we convert to axial coordinates (q, r) internally
 */

import type { GridDefinition, Coord, TransformResult, Vertex, NeighborInfo } from './types';

/**
 * Neighbor offsets for hex grid in odd-r offset coordinates.
 * These depend on whether the row is even or odd.
 * We handle this by providing neighbors for type 0 (even rows) and type 1 (odd rows)
 * but logically this is one cell type.
 * 
 * Actually, for simplicity in this unified model, we'll use a single neighbor list
 * that works via the axial coordinate system internally. The neighbors array
 * will be dynamically computed based on the actual coordinate.
 * 
 * For the unified interface, we store the 6 neighbors in axial offset form:
 * [NE, E, SE, SW, W, NW] in terms of the axial neighbors.
 */

// For odd-r offset, neighbors depend on whether row is even or odd.
// We'll use a neighbor function instead of static offsets.
// But to fit the interface, we provide the "logical" 6 directions.

// In pointy-top axial coords, the 6 neighbors are at:
// (q+1, r-1), (q+1, r), (q, r+1), (q-1, r+1), (q-1, r), (q, r-1)
// These correspond to: NE, E, SE, SW, W, NW

// The static neighbor list represents neighbors in axial form,
// then we convert to/from offset as needed.
const hexNeighborsAxial: NeighborInfo[] = [
  { dRow: -1, dCol: 1 },  // NE: (q+1, r-1) - but using row=r, we need to think in offset
  { dRow: 0, dCol: 1 },   // E: (q+1, r)
  { dRow: 1, dCol: 0 },   // SE: (q, r+1)
  { dRow: 1, dCol: -1 },  // SW: (q-1, r+1)
  { dRow: 0, dCol: -1 },  // W: (q-1, r)
  { dRow: -1, dCol: 0 },  // NW: (q, r-1)
];

/**
 * For hex grid, the neighbor offsets in odd-r offset coordinates vary by row parity.
 * To fit the unified model, we'll use a different approach:
 * The neighbors array stores the neighbors in AXIAL coordinate offsets (dq, dr).
 * Then getCellNeighbor will convert appropriately.
 * 
 * Vertices for pointy-top hex, starting from top and going clockwise.
 * Edge i connects vertex i to vertex (i+1) % 6.
 */
const hexVerticesUnit: Vertex[] = (() => {
  const vertices: Vertex[] = [];
  for (let i = 0; i < 6; i++) {
    // Pointy-top: first vertex at top (90° from positive x)
    const angle = (Math.PI / 3) * i + Math.PI / 2;
    vertices.push({
      x: Math.cos(angle),
      y: Math.sin(angle),
    });
  }
  return vertices;
})();

// Offset to axial conversion: q = col - floor(row/2), r = row
function offsetToAxial(coord: Coord): { q: number; r: number } {
  return {
    q: coord.col - Math.floor(coord.row / 2),
    r: coord.row,
  };
}

// Axial to offset conversion: row = r, col = q + floor(r/2)
function axialToOffset(q: number, r: number): Coord {
  return {
    row: r,
    col: q + Math.floor(r / 2),
  };
}

/**
 * Rotate 60° clockwise in axial coordinates.
 * Cube coords: (x, y, z) -> (-z, -x, -y)
 * Axial coords: q = x, r = z, so rotate is applied via cube.
 * 
 * Neighbor permutation for 60° CW rotation:
 * [NE, E, SE, SW, W, NW] (indices 0-5)
 * After 60° CW, each neighbor shifts: 0->1, 1->2, 2->3, 3->4, 4->5, 5->0
 * So neighborPerm[i] = (i + 1) % 6
 */
function rotateHex(coord: Coord): TransformResult {
  const axial = offsetToAxial(coord);
  // Axial to cube: x = q, z = r, y = -x - z
  const x = axial.q;
  const z = axial.r;
  const y = -x - z;
  
  // Rotate 60° CW: (x, y, z) -> (-z, -x, -y)
  const newX = -z;
  const newZ = -y;
  
  // Cube to axial: q = x, r = z
  const newAxial = { q: newX, r: newZ };
  const newOffset = axialToOffset(newAxial.q, newAxial.r);
  
  return {
    coord: newOffset,
    neighborPerm: [1, 2, 3, 4, 5, 0],
  };
}

/**
 * Flip horizontally in axial coordinates.
 * Mirror across vertical screen line (x -> -x in screen).
 * In axial: (q, r) -> (-q - r, r)
 * 
 * Neighbor permutation for horizontal flip:
 * NE(0) <-> NW(5), E(1) <-> W(4), SE(2) <-> SW(3)
 */
function flipHex(coord: Coord): TransformResult {
  const axial = offsetToAxial(coord);
  const newAxial = { q: -axial.q - axial.r, r: axial.r };
  const newOffset = axialToOffset(newAxial.q, newAxial.r);
  
  return {
    coord: newOffset,
    // Flip swaps: 0<->5, 1<->4, 2<->3
    neighborPerm: [5, 4, 3, 2, 1, 0],
  };
}

/**
 * Get the center position of a cell in screen coordinates.
 * For pointy-top hex: x = size * sqrt(3) * (q + r/2), y = size * 3/2 * r
 */
function getCellCenter(coord: Coord, cellSize: number): { x: number; y: number } {
  const axial = offsetToAxial(coord);
  const hexSize = cellSize * 0.5;
  return {
    x: hexSize * Math.sqrt(3) * (axial.q + axial.r / 2),
    y: hexSize * 1.5 * axial.r,
  };
}

/**
 * Get the vertices of a cell in screen coordinates.
 */
function getCellVertices(coord: Coord, cellSize: number): Array<{ x: number; y: number }> {
  const center = getCellCenter(coord, cellSize);
  const hexSize = cellSize * 0.5;
  return hexVerticesUnit.map(v => ({
    x: center.x + v.x * hexSize,
    y: center.y + v.y * hexSize,
  }));
}

export const hexGridDefinition: GridDefinition = {
  name: 'hex',
  numCellTypes: 1,
  
  getCellType: () => 0,  // All cells are type 0
  
  // Neighbors are stored in axial coordinate offsets
  // The actual neighbor computation uses the offset conversion
  neighbors: [hexNeighborsAxial],
  
  numRotations: 6,  // 60° steps
  
  rotate: rotateHex,
  flip: flipHex,
  
  // Translation vectors that preserve coordinate validity
  // For hex grid in odd-r offset, we need to move by 2 in row
  // or appropriately in column
  translateVectors: [
    { row: 0, col: 1 },   // Move right (in offset coords)
    { row: 2, col: 0 },   // Move down by 2 rows (maintains column offset pattern)
  ],
  
  vertices: [hexVerticesUnit],
  
  getCellCenter,
  getCellVertices,
};

// Export utilities for external use
export { offsetToAxial, axialToOffset };
