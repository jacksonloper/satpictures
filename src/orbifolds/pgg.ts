import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  createSquareOrbifoldGrid,
  glideReflectionX,
  glideReflectionY,
} from "./orbifoldShared";

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

export function createPggGrid(n: Int, initialColors?: ("black" | "white")[][]) {
  return createSquareOrbifoldGrid(n, getPggNeighbor, initialColors);
}
