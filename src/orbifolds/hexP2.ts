import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  createSquareOrbifoldGrid,
  translationWith180,
} from "./orbifoldShared";

/**
 * Get the neighbor node for hex P2 wallpaper group (P2 on a hexagonal lattice).
 *
 * Uses doubled (4-unit) spacing in axial coordinates. The fundamental domain is
 * a parallelogram with 180° rotation symmetry. Boundary crossings use 180° rotation
 * in axial coordinates, which has the same matrix form as in Cartesian coordinates:
 * (q, r) → (-q + dx, -r + dy).
 *
 * When rendered with the axial-to-Cartesian transform, the parallelogram tiles become
 * rhombi and the lattice appears hexagonal.
 *
 * Requires n to be even (avoids self-edges at boundary midpoints).
 */
function getHexP2Neighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int,
): NeighborResult {
  const step = 4;
  const minCoord = 2;
  const maxCoord = step * (n - 1) + minCoord; // 4*(n-1)+2
  const L = step * n; // 4*n
  const fromId = nodeIdFromCoord([i, j]);

  switch (dir) {
    case "N": {
      if (j === minCoord) {
        // North border: 180° rotation
        const reflectedI = L - i;
        const voltage = translationWith180(L, 0);
        const toId = nodeIdFromCoord([reflectedI, minCoord]);
        const edgeKey = [fromId, toId].sort().join("|") + "|NS";
        return { coord: [reflectedI, minCoord] as const, voltage, edgeKey, targetSide: 0 };
      }
      const toId = nodeIdFromCoord([i, j - step]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j - step] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxCoord) {
        // South border: 180° rotation
        const reflectedI = L - i;
        const voltage = translationWith180(L, 2 * L);
        const toId = nodeIdFromCoord([reflectedI, maxCoord]);
        const edgeKey = [fromId, toId].sort().join("|") + "|NS";
        return { coord: [reflectedI, maxCoord] as const, voltage, edgeKey, targetSide: 2 };
      }
      const toId = nodeIdFromCoord([i, j + step]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, j + step] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxCoord) {
        // East border: 180° rotation
        const reflectedJ = L - j;
        const voltage = translationWith180(2 * L, L);
        const toId = nodeIdFromCoord([maxCoord, reflectedJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|EW";
        return { coord: [maxCoord, reflectedJ] as const, voltage, edgeKey, targetSide: 1 };
      }
      const toId = nodeIdFromCoord([i + step, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i + step, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === minCoord) {
        // West border: 180° rotation
        const reflectedJ = L - j;
        const voltage = translationWith180(0, L);
        const toId = nodeIdFromCoord([minCoord, reflectedJ]);
        const edgeKey = [fromId, toId].sort().join("|") + "|EW";
        return { coord: [minCoord, reflectedJ] as const, voltage, edgeKey, targetSide: 3 };
      }
      const toId = nodeIdFromCoord([i - step, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [i - step, j] as const, voltage: I3, edgeKey };
    }
  }
}

export function createHexP2Grid(n: Int, initialColors?: ("black" | "white")[][]) {
  if (n % 2 !== 0) {
    throw new Error("HexP2 grid size n must be even");
  }
  return createSquareOrbifoldGrid(n, getHexP2Neighbor, initialColors, true);
}
