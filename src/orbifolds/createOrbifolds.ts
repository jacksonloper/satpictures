/**
 * Orbifold creation routines for P1, P2, P3, and P4 wallpaper groups.
 * 
 * For P1, P2, P3, and P4, for a fixed n, the set of nodes are integer coordinates like (i,j)
 * where i and j are *odd* and there are n^2 of them.
 * So for n=3, its (1,1),(1,3),(1,5),(3,1),...,(5,5).
 * 
 * These nodes are in direct correspondence with a nxn area for the user to color in.
 * 
 * All groups have north, south, east, and west neighbors.
 * Interior edges have identity voltage.
 * Border edges have special voltages:
 * - P1: translation by 2n in the direction of that side
 * - P2: translation by 2n in direction AND a 180° flip
 * - P3: 120° rotation plus translation in AXIAL coordinates (same edge wrapping as P4
 *       but with 120° rotations instead of 90°). Note: neighbor distances in the lifted
 *       graph may not be uniform when displayed in Cartesian coordinates.
 * - P4: 90° rotation plus translation (heading north you bump into the east side
 *       of the next fundamental domain, so voltage is rotate 90° CW + translate NE)
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

export type WallpaperGroupType = "P1" | "P2" | "P3" | "P4";

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
 * Create a 90° clockwise rotation matrix around origin.
 * [ 0, 1, 0]
 * [−1, 0, 0]
 * [ 0, 0, 1]
 * 
 * Note: In our coordinate system where +y is down, this rotates (1,0) -> (0,1).
 */
export const ROTATION_90_CW: Matrix3x3 = [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
] as const;

/**
 * Create a 90° counter-clockwise rotation matrix around origin.
 * [0, −1, 0]
 * [1,  0, 0]
 * [0,  0, 1]
 */
export const ROTATION_90_CCW: Matrix3x3 = [
  [0, -1, 0],
  [1, 0, 0],
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

/**
 * Create a combined rotation (90° CW) + translation matrix.
 * First rotate 90° clockwise around origin, then translate by (dx, dy).
 * Result: [0, 1, dx], [-1, 0, dy], [0, 0, 1]
 */
export function translationWith90CW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [0, 1, dx],
    [-1, 0, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a combined rotation (90° CCW) + translation matrix.
 * First rotate 90° counter-clockwise around origin, then translate by (dx, dy).
 * Result: [0, -1, dx], [1, 0, dy], [0, 0, 1]
 */
export function translationWith90CCW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [0, -1, dx],
    [1, 0, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * 120° counter-clockwise rotation matrix in axial coordinates.
 * In axial coordinates (q, r), 120° CCW rotation maps (q, r) → (-q-r, q).
 * The matrix representation (using homogeneous coords):
 * [-1, -1, 0]
 * [ 1,  0, 0]
 * [ 0,  0, 1]
 * 
 * Note: The formula (q, r) → (-r, q+r) is 60° CCW (hexagonal).
 * 120° = 2 × 60° gives (q, r) → (-q-r, q).
 * 
 * Verify: R³ = I
 * - (1,0) → (-1,1) → (0,-1) → (1,0) ✓
 */
export const ROTATION_120_CCW: Matrix3x3 = [
  [-1, -1, 0],
  [1, 0, 0],
  [0, 0, 1],
] as const;

/**
 * 120° clockwise rotation matrix in axial coordinates.
 * Equivalent to 240° CCW. Maps (q, r) → (r, -q-r).
 * The matrix representation (using homogeneous coords):
 * [ 0,  1, 0]
 * [-1, -1, 0]
 * [ 0,  0, 1]
 * 
 * This is the inverse of ROTATION_120_CCW.
 */
export const ROTATION_120_CW: Matrix3x3 = [
  [0, 1, 0],
  [-1, -1, 0],
  [0, 0, 1],
] as const;

/**
 * Create a combined rotation (120° CCW) + translation matrix in axial coords.
 * First rotate 120° counter-clockwise around origin, then translate by (dx, dy).
 * 120° CCW: (q, r) → (-q-r, q)
 * Result: [-1, -1, dx], [1, 0, dy], [0, 0, 1]
 */
export function translationWith120CCW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [-1, -1, dx],
    [1, 0, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a combined rotation (120° CW / 240° CCW) + translation matrix in axial coords.
 * First rotate 120° clockwise around origin, then translate by (dx, dy).
 * 120° CW: (q, r) → (r, -q-r)
 * Result: [0, 1, dx], [-1, -1, dy], [0, 0, 1]
 */
export function translationWith120CW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [0, 1, dx],
    [-1, -1, dy],
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
      // When wrapping north from j=1 to j=maxOdd, the neighbor in the cover space
      // is in the adjacent fundamental domain to the north (negative y direction)
      const voltage = wrapped ? translationMatrix(0, -2 * n) : I3;
      return { coord: [i, newCoord] as const, voltage };
    }
    case "S": {
      const { newCoord, wrapped } = getNeighborCoord(j, "S", n);
      // When wrapping south, neighbor is in the adjacent fundamental domain to the south
      const voltage = wrapped ? translationMatrix(0, 2 * n) : I3;
      return { coord: [i, newCoord] as const, voltage };
    }
    case "E": {
      const { newCoord, wrapped } = getNeighborCoord(i, "E", n);
      // When wrapping east, neighbor is in the adjacent fundamental domain to the east
      const voltage = wrapped ? translationMatrix(2 * n, 0) : I3;
      return { coord: [newCoord, j] as const, voltage };
    }
    case "W": {
      const { newCoord, wrapped } = getNeighborCoord(i, "W", n);
      // When wrapping west, neighbor is in the adjacent fundamental domain to the west
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
        const voltage = translationWith180(2 * n, 0);
        return { coord: [reflectedI, 1] as const, voltage };
      }
      return { coord: [i, j - 2] as const, voltage: I3 };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: wrap with 180° rotation
        const reflectedI = maxOdd + 1 - i;
        const voltage = translationWith180(2 * n, 4 * n);
        return { coord: [reflectedI, maxOdd] as const, voltage };
      }
      return { coord: [i, j + 2] as const, voltage: I3 };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: wrap with 180° rotation
        const reflectedJ = maxOdd + 1 - j;
        const voltage = translationWith180(4 * n, 2 * n);
        return { coord: [maxOdd, reflectedJ] as const, voltage };
      }
      return { coord: [i + 2, j] as const, voltage: I3 };
    }
    case "W": {
      if (i === 1) {
        // West border: wrap with 180° rotation
        const reflectedJ = maxOdd + 1 - j;
        const voltage = translationWith180(0, 2 * n);
        return { coord: [1, reflectedJ] as const, voltage };
      }
      return { coord: [i - 2, j] as const, voltage: I3 };
    }
  }
}

/**
 * Get the neighbor node for P4 wallpaper group.
 * P4 has 4-fold (90°) rotational symmetry at boundaries.
 * 
 * For border edges, the voltage includes 90° rotation plus translation.
 * The wrapping pattern follows the WallpaperGroups.ts P4 definition:
 * - North of (i, 1) wraps to (maxOdd, maxOdd + 1 - i) - heading north bumps into east side
 * - South of (i, maxOdd) wraps to (1, maxOdd + 1 - i) - heading south bumps into west side
 * - West of (1, j) wraps to (maxOdd + 1 - j, maxOdd) - heading west bumps into south side
 * - East of (maxOdd, j) wraps to (maxOdd + 1 - j, 1) - heading east bumps into north side
 * 
 * The voltages incorporate 90° rotations plus translations to place the neighbor
 * in the correct adjacent fundamental domain.
 */
function getP4Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): { coord: readonly [Int, Int]; voltage: Matrix3x3 } {
  const maxOdd = 2 * n - 1;
  
  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: heading north from (i, 1) wraps to orbifold node (maxOdd, maxOdd + 1 - i)
        // The target absolute position should be (i, -1), which is 2 units north of (i, 1)
        // Voltage: 90° CCW + translate(2n, -2n) maps (maxOdd, maxOdd+1-i) to (i, -1)
        const newI = maxOdd;
        const newJ = maxOdd + 1 - i;
        const voltage = translationWith90CCW(2 * n, -2 * n);
        return { coord: [newI, newJ] as const, voltage };
      }
      return { coord: [i, j - 2] as const, voltage: I3 };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: heading south from (i, maxOdd) wraps to orbifold node (1, maxOdd + 1 - i)
        // The target absolute position should be (i, maxOdd + 2), which is 2 units south
        // Voltage: 90° CCW + translate(2n, 2n) maps (1, maxOdd+1-i) to (i, maxOdd+2)
        const newI = 1;
        const newJ = maxOdd + 1 - i;
        const voltage = translationWith90CCW(2 * n, 2 * n);
        return { coord: [newI, newJ] as const, voltage };
      }
      return { coord: [i, j + 2] as const, voltage: I3 };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: heading east from (maxOdd, j) wraps to orbifold node (maxOdd + 1 - j, 1)
        // The target absolute position should be (maxOdd + 2, j), which is 2 units east
        // Voltage: 90° CW + translate(2n, 2n) maps (maxOdd+1-j, 1) to (maxOdd+2, j)
        const newI = maxOdd + 1 - j;
        const newJ = 1;
        const voltage = translationWith90CW(2 * n, 2 * n);
        return { coord: [newI, newJ] as const, voltage };
      }
      return { coord: [i + 2, j] as const, voltage: I3 };
    }
    case "W": {
      if (i === 1) {
        // West border: heading west from (1, j) wraps to orbifold node (maxOdd + 1 - j, maxOdd)
        // The target absolute position should be (-1, j), which is 2 units west
        // Voltage: 90° CW + translate(-2n, 2n) maps (maxOdd+1-j, maxOdd) to (-1, j)
        const newI = maxOdd + 1 - j;
        const newJ = maxOdd;
        const voltage = translationWith90CW(-2 * n, 2 * n);
        return { coord: [newI, newJ] as const, voltage };
      }
      return { coord: [i - 2, j] as const, voltage: I3 };
    }
  }
}

/**
 * Get the neighbor node for P3 wallpaper group.
 * P3 has 3-fold (120°) rotational symmetry at boundaries.
 * 
 * The orbifold edge wrapping is IDENTICAL to P4 - same coordinate mapping.
 * However, the voltages use 120° rotations instead of 90° rotations in AXIAL coordinates.
 * 
 * The wrapping pattern (same as P4):
 * - North of (i, 1) wraps to (maxOdd, maxOdd + 1 - i) - heading north bumps into east side
 * - South of (i, maxOdd) wraps to (1, maxOdd + 1 - i) - heading south bumps into west side
 * - West of (1, j) wraps to (maxOdd + 1 - j, maxOdd) - heading west bumps into south side
 * - East of (maxOdd, j) wraps to (maxOdd + 1 - j, 1) - heading east bumps into north side
 * 
 * IMPORTANT: The voltages are UNIFORM per edge type (not position-dependent).
 * They are pure products of the P3 generators: R (120° rotation) and T1, T2 (translations).
 * This ensures the voltage group acts freely on the plane with no node collisions.
 * 
 * The voltages use the translation lattice with L = 2n:
 * - V_N = R * T(-L, 0)   = R * T1⁻¹  (120° CCW + translate left)
 * - V_S = R² * T(L, 0)   = R² * T1   (120° CW + translate right)
 * - V_E = R² * T(0, L)   = R² * T2   (120° CW + translate down)
 * - V_W = R * T(0, -L)   = R * T2⁻¹  (120° CCW + translate up)
 * 
 * Note: In axial coords, neighbor screen positions may not be exactly 2 apart,
 * but the lifted graph tiles the plane correctly without collisions.
 */
function getP3Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): { coord: readonly [Int, Int]; voltage: Matrix3x3 } {
  const maxOdd = 2 * n - 1;
  const L = 2 * n; // Lattice constant = grid width
  
  // P3 voltages are uniform per edge type, using the lattice generators.
  // R: 120° CCW rotation, R²: 120° CW rotation
  // T1 = T(L, 0), T2 = T(0, L)
  //
  // The key insight is that these lattice-based voltages ensure the voltage group
  // acts freely on the plane, preventing any node collisions in the lifted graph.
  
  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: heading north from (i, 1) wraps to orbifold node (maxOdd, maxOdd + 1 - i)
        const newI = maxOdd;
        const newJ = maxOdd + 1 - i;
        // Voltage: R * T(-L, 0) = R * T1⁻¹
        const voltage = translationWith120CCW(-L, 0);
        return { coord: [newI, newJ] as const, voltage };
      }
      return { coord: [i, j - 2] as const, voltage: I3 };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: heading south from (i, maxOdd) wraps to orbifold node (1, maxOdd + 1 - i)
        const newI = 1;
        const newJ = maxOdd + 1 - i;
        // Voltage: R² * T(L, 0) = R² * T1
        const voltage = translationWith120CW(L, 0);
        return { coord: [newI, newJ] as const, voltage };
      }
      return { coord: [i, j + 2] as const, voltage: I3 };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: heading east from (maxOdd, j) wraps to orbifold node (maxOdd + 1 - j, 1)
        const newI = maxOdd + 1 - j;
        const newJ = 1;
        // Voltage: R² * T(0, L) = R² * T2
        const voltage = translationWith120CW(0, L);
        return { coord: [newI, newJ] as const, voltage };
      }
      return { coord: [i + 2, j] as const, voltage: I3 };
    }
    case "W": {
      if (i === 1) {
        // West border: heading west from (1, j) wraps to orbifold node (maxOdd + 1 - j, maxOdd)
        const newI = maxOdd + 1 - j;
        const newJ = maxOdd;
        // Voltage: R * T(0, -L) = R * T2⁻¹
        const voltage = translationWith120CCW(0, -L);
        return { coord: [newI, newJ] as const, voltage };
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
 * @param groupType - "P1", "P2", "P3", or "P4"
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
  
  // Select the appropriate neighbor function based on group type
  const getNeighbor = groupType === "P1" 
    ? getP1Neighbor 
    : groupType === "P2" 
      ? getP2Neighbor 
      : groupType === "P3"
        ? getP3Neighbor
        : getP4Neighbor;
  
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
