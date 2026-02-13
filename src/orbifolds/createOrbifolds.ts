/**
 * Orbifold creation routines for P1 and P2 wallpaper groups.
 * 
 * For both P1 and P2, for a fixed n, the set of nodes are integer coordinates like (i,j)
 * where i and j are *odd* and there are n^2 of them.
 * So for n=3, its (1,1),(1,3),(1,5),(3,1),...,(5,5).
 * 
 * These nodes are in direct correspondence with a nxn area for the user to color in.
 * 
 * Both groups have north, south, east, and west neighbors.
 * Interior edges have identity voltage.
 * Border edges have special voltages:
 * - P1: translation by 2n in the direction of that side
 * - P2: translation by 2n in direction AND a 180° flip
 */

import {
  type Int,
  type Matrix3x3,
  I3,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type OrbifoldNode,
  type OrbifoldEdge,
  type OrbifoldGrid,
  type ExtraData,
  nodeIdFromCoord,
  matInvUnimodular,
} from "./orbifoldbasics";

export type WallpaperGroupType = "P1" | "P2";

export interface ColorData extends ExtraData {
  color: "black" | "white";
}

/**
 * Create a translation matrix that translates by (dx, dy).
 * Using homogeneous coordinates, translation is represented as:
 * [1, 0, dx]
 * [0, 1, dy]
 * [0, 0, 1]
 */
export function translationMatrix(dx: Int, dy: Int): Matrix3x3 {
  return [
    [1, 0, dx],
    [0, 1, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a 180° rotation matrix around origin.
 * [−1,  0, 0]
 * [ 0, −1, 0]
 * [ 0,  0, 1]
 */
export const ROTATION_180: Matrix3x3 = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
] as const;

/**
 * Multiply translation by rotation: first rotate 180°, then translate.
 * This gives translation + 180° flip for P2 border edges.
 */
export function translationWith180(dx: Int, dy: Int): Matrix3x3 {
  // Combined: first rotate 180° around origin, then translate
  // Result: [-1, 0, dx], [0, -1, dy], [0, 0, 1]
  return [
    [-1, 0, dx],
    [0, -1, dy],
    [0, 0, 1],
  ] as const;
}

type Direction = "N" | "S" | "E" | "W";

/**
 * Get odd coordinates for a given grid index.
 * For index i in [0, n-1], the odd coordinate is 2*i + 1.
 */
function getOddCoord(index: Int): Int {
  return 2 * index + 1;
}

/**
 * Get grid index from odd coordinate.
 * For odd coordinate c, the index is (c - 1) / 2.
 */
function getIndexFromOddCoord(coord: Int): Int {
  return (coord - 1) / 2;
}

/**
 * Get the neighbor coordinate in a given direction.
 * Returns [newCoord, wrapped] where wrapped is true if we crossed the boundary.
 */
function getNeighborCoord(coord: Int, dir: Direction, n: Int): { newCoord: Int; wrapped: boolean } {
  const maxOdd = 2 * n - 1;
  
  switch (dir) {
    case "N": {
      const newCoord = coord - 2;
      if (newCoord < 1) {
        return { newCoord: maxOdd, wrapped: true };
      }
      return { newCoord, wrapped: false };
    }
    case "S": {
      const newCoord = coord + 2;
      if (newCoord > maxOdd) {
        return { newCoord: 1, wrapped: true };
      }
      return { newCoord, wrapped: false };
    }
    case "E": {
      const newCoord = coord + 2;
      if (newCoord > maxOdd) {
        return { newCoord: 1, wrapped: true };
      }
      return { newCoord, wrapped: false };
    }
    case "W": {
      const newCoord = coord - 2;
      if (newCoord < 1) {
        return { newCoord: maxOdd, wrapped: true };
      }
      return { newCoord, wrapped: false };
    }
  }
}

/**
 * Get the neighbor node for P1 wallpaper group.
 * P1 has simple torus wrapping - straight translation.
 */
function getP1Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): { coord: readonly [Int, Int]; voltage: Matrix3x3 } {
  switch (dir) {
    case "N": {
      const { newCoord, wrapped } = getNeighborCoord(j, "N", n);
      // N is decreasing j (row), so translation is in -y direction (which is +2n when wrapped)
      const voltage = wrapped ? translationMatrix(0, -2 * n) : I3;
      return { coord: [i, newCoord] as const, voltage };
    }
    case "S": {
      const { newCoord, wrapped } = getNeighborCoord(j, "S", n);
      const voltage = wrapped ? translationMatrix(0, 2 * n) : I3;
      return { coord: [i, newCoord] as const, voltage };
    }
    case "E": {
      const { newCoord, wrapped } = getNeighborCoord(i, "E", n);
      const voltage = wrapped ? translationMatrix(2 * n, 0) : I3;
      return { coord: [newCoord, j] as const, voltage };
    }
    case "W": {
      const { newCoord, wrapped } = getNeighborCoord(i, "W", n);
      const voltage = wrapped ? translationMatrix(-2 * n, 0) : I3;
      return { coord: [newCoord, j] as const, voltage };
    }
  }
}

/**
 * Get the neighbor node for P2 wallpaper group.
 * P2 has 180° rotation at boundaries.
 * 
 * For border edges, the voltage includes translation AND a 180° flip.
 * When n is odd, the center node on a boundary edge connects to itself (self-loop).
 */
function getP2Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): { coord: readonly [Int, Int]; voltage: Matrix3x3 } {
  const maxOdd = 2 * n - 1;
  
  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: wrap with 180° rotation
        // When going N from north edge, we flip to the opposite side with 180° rotation
        // The reflected coordinate is (maxOdd + 1 - i) for i, staying on north edge
        const reflectedI = maxOdd + 1 - i;
        const voltage = translationWith180(0, -2 * n);
        return { coord: [reflectedI, 1] as const, voltage };
      }
      return { coord: [i, j - 2] as const, voltage: I3 };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: wrap with 180° rotation
        const reflectedI = maxOdd + 1 - i;
        const voltage = translationWith180(0, 2 * n);
        return { coord: [reflectedI, maxOdd] as const, voltage };
      }
      return { coord: [i, j + 2] as const, voltage: I3 };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: wrap with 180° rotation
        const reflectedJ = maxOdd + 1 - j;
        const voltage = translationWith180(2 * n, 0);
        return { coord: [maxOdd, reflectedJ] as const, voltage };
      }
      return { coord: [i + 2, j] as const, voltage: I3 };
    }
    case "W": {
      if (i === 1) {
        // West border: wrap with 180° rotation
        const reflectedJ = maxOdd + 1 - j;
        const voltage = translationWith180(-2 * n, 0);
        return { coord: [1, reflectedJ] as const, voltage };
      }
      return { coord: [i - 2, j] as const, voltage: I3 };
    }
  }
}

/**
 * Create an edge ID from two node IDs.
 * Edge ID is the sorted concatenation to ensure uniqueness.
 */
function createEdgeId(node1: OrbifoldNodeId, node2: OrbifoldNodeId, dirType: string): OrbifoldEdgeId {
  const sorted = [node1, node2].sort();
  return `${sorted[0]}--${dirType}--${sorted[1]}`;
}

/**
 * Create an orbifold grid for the given wallpaper group and size.
 * 
 * @param groupType - "P1" or "P2"
 * @param n - Grid size (results in n×n nodes)
 * @param initialColors - Optional initial colors for each cell (row-major, n×n array)
 */
export function createOrbifoldGrid(
  groupType: WallpaperGroupType,
  n: Int,
  initialColors?: ("black" | "white")[][]
): OrbifoldGrid<ColorData> {
  if (n < 1) {
    throw new Error("Grid size n must be at least 1");
  }
  
  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ColorData>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge>();
  
  // Create nodes with odd integer coordinates
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = getOddCoord(col); // x coordinate (column)
      const j = getOddCoord(row); // y coordinate (row)
      const coord: readonly [Int, Int] = [i, j];
      const id = nodeIdFromCoord(coord);
      
      // Default color or use provided initial color
      const color = initialColors?.[row]?.[col] ?? "white";
      
      nodes.set(id, {
        id,
        coord,
        data: { color },
      });
    }
  }
  
  // Create edges (N, S, E, W for each node)
  // We only need to create each edge once, so we process N and E directions
  // (S is N's reverse, W is E's reverse)
  const processedEdges = new Set<string>();
  
  const getNeighbor = groupType === "P1" ? getP1Neighbor : getP2Neighbor;
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = getOddCoord(col);
      const j = getOddCoord(row);
      const fromId = nodeIdFromCoord([i, j]);
      
      // Process all 4 directions
      for (const dir of ["N", "S", "E", "W"] as Direction[]) {
        const { coord: toCoord, voltage } = getNeighbor(i, j, dir, n);
        const toId = nodeIdFromCoord(toCoord);
        
        // Create unique edge key
        const edgeKey = [fromId, toId].sort().join("|") + "|" + (dir === "N" || dir === "S" ? "NS" : "EW");
        
        if (processedEdges.has(edgeKey)) {
          continue;
        }
        processedEdges.add(edgeKey);
        
        const edgeId = createEdgeId(fromId, toId, dir === "N" || dir === "S" ? "NS" : "EW");
        
        // Check if this is a self-loop (same node)
        if (fromId === toId) {
          // Self-loop: single half-edge with involutive voltage
          const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3 }>();
          halfEdges.set(fromId, { to: fromId, voltage });
          
          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
          });
        } else {
          // Regular edge: two half-edges with inverse voltages
          const inverseVoltage = matInvUnimodular(voltage);
          
          const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3 }>();
          halfEdges.set(fromId, { to: toId, voltage });
          halfEdges.set(toId, { to: fromId, voltage: inverseVoltage });
          
          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
          });
        }
      }
    }
  }
  
  return { nodes, edges };
}

/**
 * Update the color of a node in the orbifold grid.
 */
export function setNodeColor(
  grid: OrbifoldGrid<ColorData>,
  row: Int,
  col: Int,
  color: "black" | "white"
): void {
  const i = getOddCoord(col);
  const j = getOddCoord(row);
  const id = nodeIdFromCoord([i, j]);
  
  const node = grid.nodes.get(id);
  if (node) {
    node.data = { color };
  }
}

/**
 * Get the color of a node in the orbifold grid.
 */
export function getNodeColor(
  grid: OrbifoldGrid<ColorData>,
  row: Int,
  col: Int
): "black" | "white" {
  const i = getOddCoord(col);
  const j = getOddCoord(row);
  const id = nodeIdFromCoord([i, j]);
  
  const node = grid.nodes.get(id);
  return node?.data?.color ?? "white";
}

/**
 * Get the n value (grid size) from an orbifold grid.
 */
export function getGridSize(grid: OrbifoldGrid<ColorData>): Int {
  return Math.round(Math.sqrt(grid.nodes.size));
}

/**
 * Convert orbifold node coordinates to grid position.
 * Returns { row, col } in 0-indexed grid coordinates.
 */
export function coordToGridPos(coord: readonly [Int, Int]): { row: Int; col: Int } {
  const [i, j] = coord;
  return {
    col: getIndexFromOddCoord(i),
    row: getIndexFromOddCoord(j),
  };
}
