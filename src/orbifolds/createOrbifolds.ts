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

export type WallpaperGroupType = "P1" | "P2" | "P3" | "P4" | "pgg";

export type EdgeLinestyle = "solid" | "dashed";

export interface ColorData extends ExtraData {
  color: "black" | "white";
}

export interface EdgeStyleData extends ExtraData {
  linestyle: EdgeLinestyle;
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

/**
 * Reflection across the y-axis (horizontal flip): x → -x, y → y
 * The y-axis serves as the mirror line.
 * Matrix: [-1, 0, 0], [0, 1, 0], [0, 0, 1]
 */
export const REFLECTION_Y: Matrix3x3 = [
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
] as const;

/**
 * Reflection across the x-axis (vertical flip): x → x, y → -y
 * The x-axis serves as the mirror line.
 * Matrix: [1, 0, 0], [0, -1, 0], [0, 0, 1]
 */
export const REFLECTION_X: Matrix3x3 = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
] as const;

/**
 * Create a glide reflection: reflect across y-axis then translate.
 * First reflect x → -x (using y-axis as mirror), then translate by (dx, dy).
 * Result: [-1, 0, dx], [0, 1, dy], [0, 0, 1]
 * 
 * For pgg, the north/south boundaries use this glide reflection (flip x-coords).
 */
export function glideReflectionY(dx: Int, dy: Int): Matrix3x3 {
  return [
    [-1, 0, dx],
    [0, 1, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a glide reflection: reflect across x-axis then translate.
 * First reflect y → -y (using x-axis as mirror), then translate by (dx, dy).
 * Result: [1, 0, dx], [0, -1, dy], [0, 0, 1]
 * 
 * For pgg, the east/west boundaries use this glide reflection (flip y-coords).
 */
export function glideReflectionX(dx: Int, dy: Int): Matrix3x3 {
  return [
    [1, 0, dx],
    [0, -1, dy],
    [0, 0, 1],
  ] as const;
}

type Direction = "N" | "S" | "E" | "W";

/**
 * Result from a getNeighbor function.
 * Returns null if this direction should not create an edge (e.g., P3/P4 S/E on border).
 */
type NeighborResult = {
  coord: readonly [Int, Int];
  voltage: Matrix3x3;
  edgeKey: string;
} | null;

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
 * Edge keys use NS/EW labels to distinguish vertical vs horizontal edges.
 */
function getP1Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): NeighborResult {
  const fromId = nodeIdFromCoord([i, j]);
  
  switch (dir) {
    case "N": {
      const { newCoord, wrapped } = getNeighborCoord(j, "N", n);
      // When wrapping north from j=1 to j=maxOdd, the neighbor in the cover space
      // is in the adjacent fundamental domain to the north (negative y direction)
      const voltage = wrapped ? translationMatrix(0, -2 * n) : I3;
      const toId = nodeIdFromCoord([i, newCoord]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, newCoord] as const, voltage, edgeKey };
    }
    case "S": {
      const { newCoord, wrapped } = getNeighborCoord(j, "S", n);
      // When wrapping south, neighbor is in the adjacent fundamental domain to the south
      const voltage = wrapped ? translationMatrix(0, 2 * n) : I3;
      const toId = nodeIdFromCoord([i, newCoord]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, newCoord] as const, voltage, edgeKey };
    }
    case "E": {
      const { newCoord, wrapped } = getNeighborCoord(i, "E", n);
      // When wrapping east, neighbor is in the adjacent fundamental domain to the east
      const voltage = wrapped ? translationMatrix(2 * n, 0) : I3;
      const toId = nodeIdFromCoord([newCoord, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [newCoord, j] as const, voltage, edgeKey };
    }
    case "W": {
      const { newCoord, wrapped } = getNeighborCoord(i, "W", n);
      // When wrapping west, neighbor is in the adjacent fundamental domain to the west
      const voltage = wrapped ? translationMatrix(-2 * n, 0) : I3;
      const toId = nodeIdFromCoord([newCoord, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [newCoord, j] as const, voltage, edgeKey };
    }
  }
}

/**
 * Get the neighbor node for P2 wallpaper group.
 * P2 has 180° rotation at boundaries.
 * Edge keys use NS/EW labels to distinguish vertical vs horizontal edges.
 * 
 * For border edges, the voltage includes translation AND a 180° flip.
 * When n is odd, the center node on a boundary edge connects to itself (self-loop).
 */
function getP2Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): NeighborResult {
  const maxOdd = 2 * n - 1;
  const fromId = nodeIdFromCoord([i, j]);
  
  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: wrap with 180° rotation
        // When going N from north edge, we flip to the opposite side with 180° rotation
        // The reflected coordinate is (maxOdd + 1 - i) for i, staying on north edge
        const reflectedI = maxOdd + 1 - i;
        const voltage = translationWith180(2 * n, 0);
        const toId = nodeIdFromCoord([reflectedI, 1]);
        const edgeKey = [fromId, toId].sort().join("|") + "|NS";
        return { coord: [reflectedI, 1] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: wrap with 180° rotation
        const reflectedI = maxOdd + 1 - i;
        const voltage = translationWith180(2 * n, 4 * n);
        const toId = nodeIdFromCoord([reflectedI, maxOdd]);
        const edgeKey = [fromId, toId].sort().join("|") + "|NS";
        return { coord: [reflectedI, maxOdd] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: wrap with 180° rotation
        const reflectedJ = maxOdd + 1 - j;
        const voltage = translationWith180(4 * n, 2 * n);
        const toId = nodeIdFromCoord([maxOdd, reflectedJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|EW";
        return { coord: [maxOdd, reflectedJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === 1) {
        // West border: wrap with 180° rotation
        const reflectedJ = maxOdd + 1 - j;
        const voltage = translationWith180(0, 2 * n);
        const toId = nodeIdFromCoord([1, reflectedJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|EW";
        return { coord: [1, reflectedJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey };
    }
  }
}

/**
 * Get the neighbor node for P4 wallpaper group.
 * P4 has 4-fold (90°) rotational symmetry at boundaries.
 * 
 * For P4, coordinates alone disambiguate edges EXCEPT for the two edges
 * between (1,1) and (maxOdd, maxOdd). These need NE/SW labels:
 * - NE: North from NW corner OR West from SE corner
 * - SW: South from NW corner OR East from SE corner
 * 
 * S and E directions on the border return null because those edges are
 * already created by N and W from the other endpoint.
 */
function getP4Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): NeighborResult {
  const maxOdd = 2 * n - 1;
  const fromId = nodeIdFromCoord([i, j]);
  
  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: heading north from (i, 1) wraps to orbifold node (maxOdd, maxOdd + 1 - i)
        const newI = maxOdd;
        const newJ = maxOdd + 1 - i;
        const voltage = translationWith90CCW(2 * n, -2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        // Special case: (1,1) -> (maxOdd, maxOdd) is the NE edge
        const edgeKey = (i === 1 && newI === maxOdd && newJ === maxOdd)
          ? [fromId, toId].sort().join("|") + "|NE"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: return null - this edge is created by N from the other side
        return null;
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: return null - this edge is created by W from the other side
        return null;
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === 1) {
        // West border: heading west from (1, j) wraps to orbifold node (maxOdd + 1 - j, maxOdd)
        const newI = maxOdd + 1 - j;
        const newJ = maxOdd;
        const voltage = translationWith90CW(-2 * n, 2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        // Special case: W from (1, 1) goes to (maxOdd, maxOdd) - this is the SW edge
        const edgeKey = (j === 1 && newI === maxOdd && newJ === maxOdd)
          ? [fromId, toId].sort().join("|") + "|SW"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey };
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
 * For P3, coordinates alone disambiguate edges EXCEPT for the two edges
 * between (1,1) and (maxOdd, maxOdd). These need NE/SW labels:
 * - NE: North from NW corner OR West from SE corner
 * - SW: South from NW corner OR East from SE corner
 * 
 * S and E directions on the border return null because those edges are
 * already created by N and W from the other endpoint.
 */
function getP3Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): NeighborResult {
  const maxOdd = 2 * n - 1;
  const L = 2 * n; // Lattice constant = grid width
  const fromId = nodeIdFromCoord([i, j]);
  
  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: heading north from (i, 1) wraps to orbifold node (maxOdd, maxOdd + 1 - i)
        const newI = maxOdd;
        const newJ = maxOdd + 1 - i;
        // Voltage: R * T(2L, -L) where L=2n - translate right by 4n, up by 2n
        const voltage = translationWith120CCW(2 * L, -L);
        const toId = nodeIdFromCoord([newI, newJ]);
        // Special case: (1,1) -> (maxOdd, maxOdd) is the NE edge
        const edgeKey = (i === 1 && newI === maxOdd && newJ === maxOdd)
          ? [fromId, toId].sort().join("|") + "|NE"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: return null - this edge is created by N from the other side
        return null;
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: return null - this edge is created by W from the other side
        return null;
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === 1) {
        // West border: heading west from (1, j) wraps to orbifold node (maxOdd + 1 - j, maxOdd)
        const newI = maxOdd + 1 - j;
        const newJ = maxOdd;
        // Voltage: R² * T(-L, 2L) where L=2n - translate left by 2n, down by 6n
        const voltage = translationWith120CW(-L, 2 * L);
        const toId = nodeIdFromCoord([newI, newJ]);
        // Special case: W from (1, 1) goes to (maxOdd, maxOdd) - this is the SW edge
        const edgeKey = (j === 1 && newI === maxOdd && newJ === maxOdd)
          ? [fromId, toId].sort().join("|") + "|SW"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey };
    }
  }
}

/**
 * Get the neighbor node for pgg wallpaper group.
 * pgg has glide reflections at boundaries (no pure rotations).
 * 
 * The orbifold edge wrapping for pgg:
 * - North of (i, 1) wraps to (maxOdd + 1 - i, maxOdd) with a vertical glide reflection
 * - South of (i, maxOdd) wraps to (maxOdd + 1 - i, 1) with a vertical glide reflection
 * - West of (1, j) wraps to (maxOdd, maxOdd + 1 - j) with a horizontal glide reflection
 * - East of (maxOdd, j) wraps to (1, maxOdd + 1 - j) with a horizontal glide reflection
 * 
 * Edge keys use NS/EW labels to distinguish vertical vs horizontal edges.
 * 
 * For pgg, all boundary edges are created from both sides (unlike P3/P4 which only create
 * from one side), but each edge is only created once using edge key deduplication.
 */
function getPggNeighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): NeighborResult {
  const maxOdd = 2 * n - 1;
  const L = 2 * n; // Lattice constant = grid width (same as height for square)
  const fromId = nodeIdFromCoord([i, j]);
  
  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: heading north from (i, 1) wraps to (maxOdd + 1 - i, maxOdd)
        // This is a vertical glide reflection: flip x, then translate
        const newI = maxOdd + 1 - i;
        const newJ = maxOdd;
        // Voltage: reflect in y-axis (flip x) then translate
        // The glide sends (x, y) → (-x + 2n, y - 2n)
        const voltage = glideReflectionY(L, -L);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|NS";
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxOdd) {
        // South border: heading south from (i, maxOdd) wraps to (maxOdd + 1 - i, 1)
        const newI = maxOdd + 1 - i;
        const newJ = 1;
        // Voltage: glide reflection (inverse of north) - x → -x + 2n, y → -y + 4n
        const voltage = glideReflectionY(L, L);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|NS";
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxOdd) {
        // East border: heading east from (maxOdd, j) wraps to (1, maxOdd + 1 - j)
        const newI = 1;
        const newJ = maxOdd + 1 - j;
        // Voltage: horizontal glide reflection - reflect y, translate
        // x → x + 2n, y → -y + 2n
        const voltage = glideReflectionX(L, L);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|EW";
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === 1) {
        // West border: heading west from (1, j) wraps to (maxOdd, maxOdd + 1 - j)
        const newI = maxOdd;
        const newJ = maxOdd + 1 - j;
        // Voltage: horizontal glide reflection (inverse of east)
        // x → x - 2n, y → -y + 2n
        const voltage = glideReflectionX(-L, L);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|EW";
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey };
    }
  }
}

/**
 * Create an orbifold grid for the given wallpaper group and size.
 * 
 * @param groupType - "P1", "P2", "P3", "P4", or "pgg"
 * @param n - Grid size (results in n×n nodes). Must be at least 2.
 * @param initialColors - Optional initial colors for each cell (row-major, n×n array)
 */
export function createOrbifoldGrid(
  groupType: WallpaperGroupType,
  n: Int,
  initialColors?: ("black" | "white")[][]
): OrbifoldGrid<ColorData, EdgeStyleData> {
  if (n < 2) {
    throw new Error("Grid size n must be at least 2");
  }
  
  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ColorData>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>();
  
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
  // The getNeighbor functions provide edge keys and may return null
  // to indicate that an edge should not be created (e.g., P3/P4 S/E on border)
  const processedEdges = new Set<string>();
  
  // Select the appropriate neighbor function based on group type
  let getNeighbor: (i: Int, j: Int, dir: Direction, n: Int) => NeighborResult;
  switch (groupType) {
    case "P1":
      getNeighbor = getP1Neighbor;
      break;
    case "P2":
      getNeighbor = getP2Neighbor;
      break;
    case "P3":
      getNeighbor = getP3Neighbor;
      break;
    case "P4":
      getNeighbor = getP4Neighbor;
      break;
    case "pgg":
      getNeighbor = getPggNeighbor;
      break;
  }
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = getOddCoord(col);
      const j = getOddCoord(row);
      const fromId = nodeIdFromCoord([i, j]);
      
      // Process all 4 directions
      for (const dir of ["N", "S", "E", "W"] as Direction[]) {
        const result = getNeighbor(i, j, dir, n);
        
        // Skip if this direction returns null (edge already created from other side)
        if (result === null) {
          continue;
        }
        
        const { coord: toCoord, voltage, edgeKey } = result;
        const toId = nodeIdFromCoord(toCoord);
        
        // Skip if this edge has already been created (either by a previous direction or by the other endpoint)
        if (processedEdges.has(edgeKey)) {
          continue;
        }
        processedEdges.add(edgeKey);
        
        // Edge ID is just the edge key with -- separators for readability
        const edgeId = edgeKey.replace(/\|/g, "--");
        
        // Check if this is a self-loop (same node)
        if (fromId === toId) {
          // Self-loop: single half-edge with involutive voltage
          const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3 }>();
          halfEdges.set(fromId, { to: fromId, voltage });
          
          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
            data: { linestyle: "solid" },
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
            data: { linestyle: "solid" },
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
 * Get the linestyle of an orbifold edge.
 */
export function getEdgeLinestyle(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  edgeId: OrbifoldEdgeId
): EdgeLinestyle {
  const edge = grid.edges.get(edgeId);
  return edge?.data?.linestyle ?? "solid";
}

/**
 * Set the linestyle of an orbifold edge.
 */
export function setEdgeLinestyle(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  edgeId: OrbifoldEdgeId,
  linestyle: EdgeLinestyle
): void {
  const edge = grid.edges.get(edgeId);
  if (edge) {
    edge.data = { linestyle };
  }
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
