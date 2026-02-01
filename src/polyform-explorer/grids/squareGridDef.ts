/**
 * Square Grid Definition
 * 
 * Defines the geometry for polyomino tilings on a square grid.
 * Each cell is a unit square with 4 neighbors (up, right, down, left).
 * 
 * Uses axial coordinates (q, r) where q is horizontal and r is vertical.
 */

import type { GridDefinition, Coord, TransformResult, Vertex, NeighborInfo } from './types';

// Neighbor offsets for square grid: [up, right, down, left]
// In a square grid, all cells have the same neighbors
const squareNeighbors: NeighborInfo[] = [
  { dq: 0, dr: -1 },   // up (neighbor 0)
  { dq: 1, dr: 0 },    // right (neighbor 1)
  { dq: 0, dr: 1 },    // down (neighbor 2)
  { dq: -1, dr: 0 },   // left (neighbor 3)
];

// Vertices for a unit square centered at origin (before translation)
// Ordered so edge from vertex i to i+1 faces neighbor i
// Edge 0 (up): v0 to v1, Edge 1 (right): v1 to v2, etc.
const squareVertices: Vertex[] = [
  { x: -0.5, y: -0.5 },  // top-left (v0)
  { x: 0.5, y: -0.5 },   // top-right (v1)
  { x: 0.5, y: 0.5 },    // bottom-right (v2)
  { x: -0.5, y: 0.5 },   // bottom-left (v3)
];

/**
 * Rotate 90° clockwise: (q, r) -> (r, -q)
 * Then normalize so the result can be used relative to origin.
 * 
 * Neighbor permutation for 90° CW rotation:
 * - What was up (0) becomes right (1)
 * - What was right (1) becomes down (2)
 * - What was down (2) becomes left (3)
 * - What was left (3) becomes up (0)
 * So neighborPerm[i] = (i + 1) % 4
 */
function rotateSquare(coord: Coord): TransformResult {
  return {
    coord: {
      q: coord.r,
      r: -coord.q,
    },
    neighborPerm: [1, 2, 3, 0],
  };
}

/**
 * Flip horizontally: (q, r) -> (-q, r)
 * 
 * Neighbor permutation for horizontal flip:
 * - What was up (0) stays up (0)
 * - What was right (1) becomes left (3)
 * - What was down (2) stays down (2)
 * - What was left (3) becomes right (1)
 */
function flipSquare(coord: Coord): TransformResult {
  return {
    coord: {
      q: -coord.q,
      r: coord.r,
    },
    neighborPerm: [0, 3, 2, 1],
  };
}

/**
 * Get the center position of a cell in screen coordinates.
 */
function getCellCenter(coord: Coord, cellSize: number): { x: number; y: number } {
  return {
    x: (coord.q + 0.5) * cellSize,
    y: (coord.r + 0.5) * cellSize,
  };
}

/**
 * Get the vertices of a cell in screen coordinates.
 */
function getCellVertices(coord: Coord, cellSize: number): Array<{ x: number; y: number }> {
  const center = getCellCenter(coord, cellSize);
  return squareVertices.map(v => ({
    x: center.x + v.x * cellSize,
    y: center.y + v.y * cellSize,
  }));
}

export const squareGridDefinition: GridDefinition = {
  name: 'square',
  numCellTypes: 1,
  
  getCellType: () => 0,  // All cells are type 0
  
  neighbors: [squareNeighbors],  // One neighbor list for the single cell type
  
  numRotations: 4,  // 90° steps
  
  rotate: rotateSquare,
  flip: flipSquare,
  
  // For square grid, simple unit translations
  translateVectors: [
    { q: 1, r: 0 },  // Right
    { q: 0, r: 1 },  // Down
  ],
  
  vertices: [squareVertices],  // One vertex list for the single cell type
  
  getCellCenter,
  getCellVertices,
};
