/**
 * Grid Neighbor Functions
 *
 * Defines how cells connect to their neighbors for different grid types.
 * Each grid type has its own adjacency pattern.
 */

import type { GridPoint, GridType } from "./graph-types";

/**
 * Get the 4-neighbors of a point for square grid within bounds
 */
function getSquareNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (const [dr, dc] of deltas) {
    const nr = p.row + dr;
    const nc = p.col + dc;
    if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
      neighbors.push({ row: nr, col: nc });
    }
  }

  return neighbors;
}

/**
 * Get the 6-neighbors of a point for hex grid (offset coordinates) within bounds
 * Uses "odd-r" offset coordinates where odd rows are shifted right
 */
function getHexNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  
  // For hex grids with odd-r offset coordinates:
  // Even rows: NW, NE, W, E, SW, SE offsets
  // Odd rows: different offsets due to stagger
  const isOddRow = p.row % 2 === 1;
  
  const deltas = isOddRow
    ? [
        [-1, 0],  // NW
        [-1, 1],  // NE
        [0, -1],  // W
        [0, 1],   // E
        [1, 0],   // SW
        [1, 1],   // SE
      ]
    : [
        [-1, -1], // NW
        [-1, 0],  // NE
        [0, -1],  // W
        [0, 1],   // E
        [1, -1],  // SW
        [1, 0],   // SE
      ];

  for (const [dr, dc] of deltas) {
    const nr = p.row + dr;
    const nc = p.col + dc;
    if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
      neighbors.push({ row: nr, col: nc });
    }
  }

  return neighbors;
}

/**
 * Get the 8-neighbors of a point for octagon grid (like square but with 8 directions)
 * Each octagon can connect to 4 cardinal + 4 diagonal neighbors
 */
function getOctagonNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  const deltas = [
    [-1, -1], // NW (diagonal)
    [-1, 0],  // N
    [-1, 1],  // NE (diagonal)
    [0, -1],  // W
    [0, 1],   // E
    [1, -1],  // SW (diagonal)
    [1, 0],   // S
    [1, 1],   // SE (diagonal)
  ];

  for (const [dr, dc] of deltas) {
    const nr = p.row + dr;
    const nc = p.col + dc;
    if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
      neighbors.push({ row: nr, col: nc });
    }
  }

  return neighbors;
}

/**
 * Get the neighbors of a point for Cairo pentagonal tiling.
 * Cairo tiling uses pentagonal tiles with parity-dependent adjacencies.
 * Each tile has 4 cardinal neighbors plus 1 diagonal neighbor depending on parity.
 * 
 * Python reference uses (i, j) where i=col, j=row, and offsets are (di, dj).
 * parity_adjacency keyed by (i%2, j%2) = (col%2, row%2):
 * - (0,0): diagonal (di=-1, dj=+1) → (dc=-1, dr=+1) → SW
 * - (1,0): diagonal (di=-1, dj=-1) → (dc=-1, dr=-1) → NW
 * - (0,1): diagonal (di=+1, dj=+1) → (dc=+1, dr=+1) → SE
 * - (1,1): diagonal (di=+1, dj=-1) → (dc=+1, dr=-1) → NE
 */
function getCairoNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  
  // Parity of the cell: (col%2, row%2) matches Python's (i%2, j%2)
  const parityCol = p.col % 2;
  const parityRow = p.row % 2;
  
  // Cardinal directions (same for all parities)
  const cardinalDeltas = [
    [-1, 0],  // N
    [1, 0],   // S
    [0, -1],  // W
    [0, 1],   // E
  ];
  
  // Diagonal neighbor depends on parity (col%2, row%2)
  // Python offsets are (di, dj) where di=col change, dj=row change
  // We need [dr, dc] = [dj, di]
  let diagonalDelta: [number, number];  // [dr, dc]
  if (parityCol === 0 && parityRow === 0) {
    // (0,0): Python (-1,1) means di=-1, dj=+1 → dr=+1, dc=-1 (SW)
    diagonalDelta = [1, -1];
  } else if (parityCol === 1 && parityRow === 0) {
    // (1,0): Python (-1,-1) means di=-1, dj=-1 → dr=-1, dc=-1 (NW)
    diagonalDelta = [-1, -1];
  } else if (parityCol === 0 && parityRow === 1) {
    // (0,1): Python (1,1) means di=+1, dj=+1 → dr=+1, dc=+1 (SE)
    diagonalDelta = [1, 1];
  } else {
    // (1,1): Python (1,-1) means di=+1, dj=-1 → dr=-1, dc=+1 (NE)
    diagonalDelta = [-1, 1];
  }
  
  // Add cardinal neighbors
  for (const [dr, dc] of cardinalDeltas) {
    const nr = p.row + dr;
    const nc = p.col + dc;
    if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
      neighbors.push({ row: nr, col: nc });
    }
  }
  
  // Add diagonal neighbor
  const [ddr, ddc] = diagonalDelta;
  const dnr = p.row + ddr;
  const dnc = p.col + ddc;
  if (dnr >= 0 && dnr < height && dnc >= 0 && dnc < width) {
    neighbors.push({ row: dnr, col: dnc });
  }
  
  return neighbors;
}

/**
 * Get the neighbors of a point for Cairo Bridge tiling.
 * Cairo Bridge is like Cairo tiling but with 7 neighbors instead of 5:
 * - 4 cardinal neighbors (N, S, E, W)
 * - 3 diagonal neighbors (all except the one diametrically opposed to Cairo's diagonal)
 * 
 * For Cairo, the diagonal neighbor depends on parity (col%2, row%2):
 * - (0,0): diagonal is SW → excluded is NE
 * - (1,0): diagonal is NW → excluded is SE  
 * - (0,1): diagonal is SE → excluded is NW
 * - (1,1): diagonal is NE → excluded is SW
 */
function getCairoBridgeNeighbors(p: GridPoint, width: number, height: number): GridPoint[] {
  const neighbors: GridPoint[] = [];
  
  const parityCol = p.col % 2;
  const parityRow = p.row % 2;
  
  // Cardinal directions (same for all parities)
  const cardinalDeltas = [
    [-1, 0],  // N
    [1, 0],   // S
    [0, -1],  // W
    [0, 1],   // E
  ];
  
  // All diagonal directions
  const allDiagonals: [number, number, string][] = [
    [-1, -1, "NW"],
    [-1, 1, "NE"],
    [1, -1, "SW"],
    [1, 1, "SE"],
  ];
  
  // Determine which diagonal to exclude based on parity (diametrically opposed to Cairo's diagonal)
  let excludedDiagonal: string;
  if (parityCol === 0 && parityRow === 0) {
    // Cairo diagonal is SW, so exclude NE
    excludedDiagonal = "NE";
  } else if (parityCol === 1 && parityRow === 0) {
    // Cairo diagonal is NW, so exclude SE
    excludedDiagonal = "SE";
  } else if (parityCol === 0 && parityRow === 1) {
    // Cairo diagonal is SE, so exclude NW
    excludedDiagonal = "NW";
  } else {
    // (1,1): Cairo diagonal is NE, so exclude SW
    excludedDiagonal = "SW";
  }
  
  // Add cardinal neighbors
  for (const [dr, dc] of cardinalDeltas) {
    const nr = p.row + dr;
    const nc = p.col + dc;
    if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
      neighbors.push({ row: nr, col: nc });
    }
  }
  
  // Add diagonal neighbors (excluding the diametrically opposed one)
  for (const [dr, dc, name] of allDiagonals) {
    if (name !== excludedDiagonal) {
      const nr = p.row + dr;
      const nc = p.col + dc;
      if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
        neighbors.push({ row: nr, col: nc });
      }
    }
  }
  
  return neighbors;
}

/**
 * Get neighbors based on grid type
 */
export function getNeighbors(p: GridPoint, width: number, height: number, gridType: GridType = "square"): GridPoint[] {
  if (gridType === "hex") {
    return getHexNeighbors(p, width, height);
  }
  if (gridType === "octagon") {
    return getOctagonNeighbors(p, width, height);
  }
  if (gridType === "cairo") {
    return getCairoNeighbors(p, width, height);
  }
  if (gridType === "cairobridge") {
    return getCairoBridgeNeighbors(p, width, height);
  }
  return getSquareNeighbors(p, width, height);
}

/**
 * Create a canonical key for an edge (unordered pair)
 */
export function edgeKey(u: GridPoint, v: GridPoint): string {
  // Normalize order: smaller row first, or if same row, smaller col first
  if (u.row < v.row || (u.row === v.row && u.col < v.col)) {
    return `${u.row},${u.col}-${v.row},${v.col}`;
  }
  return `${v.row},${v.col}-${u.row},${u.col}`;
}
