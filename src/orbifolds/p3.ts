import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  createSquareOrbifoldGrid,
  translationWith120CCW,
  translationWith120CW,
} from "./orbifoldShared";

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

export function createP3Grid(n: Int, initialColors?: ("black" | "white")[][]) {
  return createSquareOrbifoldGrid(n, getP3Neighbor, initialColors);
}
