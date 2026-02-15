import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  createSquareOrbifoldGrid,
  translationWith90CCW,
  translationWith90CW,
  directionToPolygonEdge,
  oppositePolygonEdge,
} from "./orbifoldShared";

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
  const fromEdge = directionToPolygonEdge(dir);

  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: heading north from (i, 1) wraps to orbifold node (maxOdd, maxOdd + 1 - i)
        // P4 boundary: N(0)→W(3)
        const newI = maxOdd;
        const newJ = maxOdd + 1 - i;
        const voltage = translationWith90CCW(2 * n, -2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = (i === 1 && newI === maxOdd && newJ === maxOdd)
          ? [fromId, toId].sort().join("|") + "|NE"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: directionToPolygonEdge("W") };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: oppositePolygonEdge(fromEdge) };
    }
    case "S": {
      if (j === maxOdd) {
        return null;
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: oppositePolygonEdge(fromEdge) };
    }
    case "E": {
      if (i === maxOdd) {
        return null;
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: oppositePolygonEdge(fromEdge) };
    }
    case "W": {
      if (i === 1) {
        // West border: heading west from (1, j) wraps to orbifold node (maxOdd + 1 - j, maxOdd)
        // P4 boundary: W(3)→N(0)
        const newI = maxOdd + 1 - j;
        const newJ = maxOdd;
        const voltage = translationWith90CW(-2 * n, 2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = (j === 1 && newI === maxOdd && newJ === maxOdd)
          ? [fromId, toId].sort().join("|") + "|SW"
          : [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: directionToPolygonEdge("N") };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: oppositePolygonEdge(fromEdge) };
    }
  }
}

export function createP4Grid(n: Int, initialColors?: ("black" | "white")[][]) {
  return createSquareOrbifoldGrid(n, getP4Neighbor, initialColors);
}
