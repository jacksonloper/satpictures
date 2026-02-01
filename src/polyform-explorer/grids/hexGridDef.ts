/**
 * Hexagonal Grid Definition
 * 
 * Defines the geometry for polyhex tilings on a hexagonal grid.
 * Uses pointy-top hexagons with axial coordinates (q, r).
 * Each cell has 6 neighbors.
 * 
 * Axial coordinates:
 * - q: column axis (horizontal-ish)
 * - r: row axis (diagonal, increases downward)
 * - The third cube coordinate s = -q - r (implicit)
 */

import type { GridDefinition, Coord, TransformResult, Vertex, NeighborInfo } from './types';

/**
 * Hex Grid Geometry
 * 
 * Uses pointy-top hexagons with axial coordinates (q, r).
 * 
 * The 6 neighbors in clockwise order from NE:
 * - Index 0: NE (q+1, r-1)
 * - Index 1: E  (q+1, r)
 * - Index 2: SE (q, r+1)
 * - Index 3: SW (q-1, r+1)
 * - Index 4: W  (q-1, r)
 * - Index 5: NW (q, r-1)
 * 
 * Vertices for pointy-top hex start at top and go clockwise.
 * Edge i connects vertex i to vertex (i+1) % 6 and faces neighbor i.
 */
const hexNeighbors: NeighborInfo[] = [
  { dq: 1, dr: -1 },   // NE (index 0)
  { dq: 1, dr: 0 },    // E  (index 1)
  { dq: 0, dr: 1 },    // SE (index 2)
  { dq: -1, dr: 1 },   // SW (index 3)
  { dq: -1, dr: 0 },   // W  (index 4)
  { dq: 0, dr: -1 },   // NW (index 5)
];

// Vertices for pointy-top hex (unit size), starting from top and going clockwise
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
  // Axial to cube: x = q, z = r, y = -x - z
  const x = coord.q;
  const z = coord.r;
  const y = -x - z;
  
  // Rotate 60° CW: (x, y, z) -> (-z, -x, -y)
  const newX = -z;
  const newZ = -y;
  
  // Cube to axial: q = x, r = z
  return {
    coord: { q: newX, r: newZ },
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
  return {
    coord: { q: -coord.q - coord.r, r: coord.r },
    // Flip swaps: 0<->5, 1<->4, 2<->3
    neighborPerm: [5, 4, 3, 2, 1, 0],
  };
}

/**
 * Get the center position of a cell in screen coordinates.
 * For pointy-top hex: x = size * sqrt(3) * (q + r/2), y = size * 3/2 * r
 */
function getCellCenter(coord: Coord, cellSize: number): { x: number; y: number } {
  const hexSize = cellSize * 0.5;
  return {
    x: hexSize * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: hexSize * 1.5 * coord.r,
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
  
  // Neighbors use axial coordinate offsets
  neighbors: [hexNeighbors],
  
  numRotations: 6,  // 60° steps
  
  rotate: rotateHex,
  flip: flipHex,
  
  // Translation vectors in axial coordinates
  translateVectors: [
    { q: 1, r: 0 },   // Move right (in axial coords)
    { q: 0, r: 1 },   // Move down
  ],
  
  vertices: [hexVerticesUnit],
  
  getCellCenter,
  getCellVertices,
};
