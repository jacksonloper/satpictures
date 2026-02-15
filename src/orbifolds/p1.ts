import { type Int, I3, nodeIdFromCoord } from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  createSquareOrbifoldGrid,
  translationMatrix,
  directionToPolygonEdge,
  oppositePolygonEdge,
} from "./orbifoldShared";

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
  const fromEdge = directionToPolygonEdge(dir);
  const toEdge = oppositePolygonEdge(fromEdge);

  switch (dir) {
    case "N": {
      const { newCoord, wrapped } = getNeighborCoord(j, "N", n);
      // When wrapping north from j=1 to j=maxOdd, the neighbor in the cover space
      // is in the adjacent fundamental domain to the north (negative y direction)
      const voltage = wrapped ? translationMatrix(0, -2 * n) : I3;
      const toId = nodeIdFromCoord([i, newCoord]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, newCoord] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
    }
    case "S": {
      const { newCoord, wrapped } = getNeighborCoord(j, "S", n);
      // When wrapping south, neighbor is in the adjacent fundamental domain to the south
      const voltage = wrapped ? translationMatrix(0, 2 * n) : I3;
      const toId = nodeIdFromCoord([i, newCoord]);
      const edgeKey = [fromId, toId].sort().join("|") + "|NS";
      return { coord: [i, newCoord] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
    }
    case "E": {
      const { newCoord, wrapped } = getNeighborCoord(i, "E", n);
      // When wrapping east, neighbor is in the adjacent fundamental domain to the east
      const voltage = wrapped ? translationMatrix(2 * n, 0) : I3;
      const toId = nodeIdFromCoord([newCoord, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [newCoord, j] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
    }
    case "W": {
      const { newCoord, wrapped } = getNeighborCoord(i, "W", n);
      // When wrapping west, neighbor is in the adjacent fundamental domain to the west
      const voltage = wrapped ? translationMatrix(-2 * n, 0) : I3;
      const toId = nodeIdFromCoord([newCoord, j]);
      const edgeKey = [fromId, toId].sort().join("|") + "|EW";
      return { coord: [newCoord, j] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
    }
  }
}

export function createP1Grid(n: Int, initialColors?: ("black" | "white")[][]) {
  return createSquareOrbifoldGrid(n, getP1Neighbor, initialColors);
}
