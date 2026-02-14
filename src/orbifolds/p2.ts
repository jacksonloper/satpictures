import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  createSquareOrbifoldGrid,
  translationWith180,
} from "./orbifoldShared";

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

export function createP2Grid(n: Int, initialColors?: ("black" | "white")[][]) {
  return createSquareOrbifoldGrid(n, getP2Neighbor, initialColors);
}
