import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  createSquareOrbifoldGrid,
  splitCornerSquare,
  translationWith90CCW,
  translationWith90CW,
} from "./orbifoldShared";

/**
 * Get the neighbor node for P4 wallpaper group (doubled coordinate system).
 * P4 has 4-fold (90°) rotational symmetry at boundaries.
 * 
 * Uses 4-unit spacing: nodes at (4*col+2, 4*row+2), polygon ±2.
 * 
 * For P4, coordinates alone disambiguate edges EXCEPT for the two edges
 * between (2,2) and (maxCoord, maxCoord). These need NE/SW labels:
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
  const step = 4;
  const minCoord = step / 2;            // 2
  const maxCoord = step * (n - 1) + minCoord;  // 4*(n-1)+2
  const L = step * n;                    // 4*n = lattice constant
  const fromId = nodeIdFromCoord([i, j]);

  switch (dir) {
    case "N": {
      if (j === minCoord) {
        // North border: heading north from (i, minCoord) wraps to (maxCoord, L - i)
        const newI = maxCoord;
        const newJ = L - i;
        const voltage = translationWith90CCW(L, -L);
        const toId = nodeIdFromCoord([newI, newJ]);
        // Special case: NW corner (minCoord,minCoord) → SE corner (maxCoord, maxCoord) is the NE edge
        const edgeKey = (i === minCoord && newI === maxCoord && newJ === maxCoord)
          ? [fromId, toId].sort().join("|") + "|NE"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey, targetSide: 1 };
      }
      const toId = nodeIdFromCoord([i, j - step]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j - step] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxCoord) {
        // South border: return null - this edge is created by N from the other side
        return null;
      }
      const toId = nodeIdFromCoord([i, j + step]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j + step] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxCoord) {
        // East border: return null - this edge is created by W from the other side
        return null;
      }
      const toId = nodeIdFromCoord([i + step, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i + step, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === minCoord) {
        // West border: heading west from (minCoord, j) wraps to (L - j, maxCoord)
        const newI = L - j;
        const newJ = maxCoord;
        const voltage = translationWith90CW(-L, L);
        const toId = nodeIdFromCoord([newI, newJ]);
        // Special case: W from NW corner goes to SE corner - this is the SW edge
        const edgeKey = (j === minCoord && newI === maxCoord && newJ === maxCoord)
          ? [fromId, toId].sort().join("|") + "|SW"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey, targetSide: 2 };
      }
      const toId = nodeIdFromCoord([i - step, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i - step, j] as const, voltage: I3, edgeKey };
    }
  }
}

export function createP4Grid(n: Int, initialColors?: ("black" | "white")[][]) {
  const grid = createSquareOrbifoldGrid(n, getP4Neighbor, initialColors, true);
  const step = 4;
  const minCoord = 2;
  const maxCoord = step * (n - 1) + minCoord;
  const L = step * n;

  // Split NE corner: node (maxCoord, minCoord) has self-edge on sides [0 (N), 1 (E)]
  // with 90° CCW voltage. Split into two triangles.
  // North triangle centroid ≈ (maxCoord-1, minCoord-1), South ≈ (maxCoord+1, minCoord+1)
  splitCornerSquare(
    grid,
    maxCoord, minCoord,
    [maxCoord - 1, minCoord - 1], [maxCoord + 1, minCoord + 1],
    0, 1,
    translationWith90CCW(L, -L),
    2,
  );

  // Split SW corner: node (minCoord, maxCoord) has self-edge on sides [3 (W), 2 (S)]
  // with 90° CW voltage. Split into two triangles.
  // North triangle centroid ≈ (minCoord-1, maxCoord-1), South ≈ (minCoord+1, maxCoord+1)
  splitCornerSquare(
    grid,
    minCoord, maxCoord,
    [minCoord - 1, maxCoord - 1], [minCoord + 1, maxCoord + 1],
    3, 2,
    translationWith90CW(-L, L),
    2,
  );

  return grid;
}
