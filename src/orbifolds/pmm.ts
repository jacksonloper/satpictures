import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  REFLECTION_X,
  REFLECTION_Y,
  createSquareOrbifoldGrid,
  glideReflectionX,
  glideReflectionY,
} from "./orbifoldShared";

/**
 * Get the neighbor node for pmm wallpaper group.
 * pmm has mirror lines on all four boundaries of the fundamental domain.
 *
 * Each boundary is a mirror: crossing it creates a self-edge whose voltage
 * is a reflection that maps the node's orbifold coordinate to the reflected
 * position in the covering space.
 *
 * Boundary voltages (all involutive, V² = I):
 * - North (y = 0 mirror):  REFLECTION_X          = [1,0,0; 0,-1,0;  0,0,1]
 * - South (y = 2n mirror): glideReflectionX(0,4n) = [1,0,0; 0,-1,4n; 0,0,1]
 * - West  (x = 0 mirror):  REFLECTION_Y          = [-1,0,0;  0,1,0; 0,0,1]
 * - East  (x = 2n mirror): glideReflectionY(4n,0) = [-1,0,4n; 0,1,0; 0,0,1]
 *
 * The targetSide matches the direction's own side (not the opposite), because
 * a mirror sends you back through the same polygon side.
 *
 * Edge keys use NS/EW labels to distinguish vertical vs horizontal edges.
 */
function getPmmNeighbor(
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
        // North mirror at y = 0: self-edge reflecting y
        // V * (i, 1) = (i, -1) — distance 2 from (i, 1) ✓
        const voltage = REFLECTION_X;
        const edgeKey = [fromId, fromId].sort().join("|") + "|NS";
        return { coord: [i, 1] as const, voltage, edgeKey, targetSide: 0 };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxOdd) {
        // South mirror at y = 2n: self-edge reflecting y around y = 2n
        // V * (i, maxOdd) = (i, 4n - maxOdd) = (i, 2n+1) — distance 2 ✓
        const voltage = glideReflectionX(0, 4 * n);
        const edgeKey = [fromId, fromId].sort().join("|") + "|NS";
        return { coord: [i, maxOdd] as const, voltage, edgeKey, targetSide: 2 };
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxOdd) {
        // East mirror at x = 2n: self-edge reflecting x around x = 2n
        // V * (maxOdd, j) = (4n - maxOdd, j) = (2n+1, j) — distance 2 ✓
        const voltage = glideReflectionY(4 * n, 0);
        const edgeKey = [fromId, fromId].sort().join("|") + "|EW";
        return { coord: [maxOdd, j] as const, voltage, edgeKey, targetSide: 1 };
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === 1) {
        // West mirror at x = 0: self-edge reflecting x
        // V * (1, j) = (-1, j) — distance 2 from (1, j) ✓
        const voltage = REFLECTION_Y;
        const edgeKey = [fromId, fromId].sort().join("|") + "|EW";
        return { coord: [1, j] as const, voltage, edgeKey, targetSide: 3 };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey };
    }
  }
}

export function createPmmGrid(n: Int, initialColors?: ("black" | "white")[][]) {
  return createSquareOrbifoldGrid(n, getPmmNeighbor, initialColors);
}
