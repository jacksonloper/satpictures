import {
  type Int,
  type Matrix3x3,
  I3,
  nodeIdFromCoord,
  matInvUnimodular,
  type OrbifoldNodeId,
  type OrbifoldHalfEdge,
  type OrbifoldEdgeId,
  type OrbifoldNode,
  type OrbifoldEdge,
  type OrbifoldGrid,
} from "./orbifoldbasics";
import {
  type Direction,
  type NeighborResult,
  type ColorData,
  type EdgeStyleData,
  translationWith90CCW,
  translationWith90CW,
  squarePolygon,
  directionToPolygonEdge,
  oppositePolygonEdge,
} from "./orbifoldShared";

const DIAGONAL_REFLECTION: Matrix3x3 = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
] as const;

/**
 * P4g triangle polygon edge index for the diagonal/hypotenuse edge.
 * Triangle vertices: (i-1,j-1), (i+1,j-1), (i-1,j+1)
 * Edge 0 (N): top, Edge 1: diagonal/hypotenuse, Edge 2 (W): left
 */
const P4G_DIAG_EDGE = 1;

/**
 * Get the neighbor node for P4g wallpaper group.
 * P4g is like P4 but only keeps nodes strictly above the NW-SE diagonal.
 * Nodes on the first superdiagonal get a self-loop that reflects across the diagonal.
 */
function getP4gNeighbor(
  i: Int,
  j: Int,
  dir: Direction,
  n: Int
): NeighborResult {
  const maxOdd = 2 * n - 1;
  const fromId = nodeIdFromCoord([i, j]);
  const isOnFirstSuperdiagonal = i === j + 2;

  if (isOnFirstSuperdiagonal && (dir === "S" || dir === "W")) {
    if (dir === "W") {
      return null;
    }
    // S direction on superdiagonal → self-loop with diagonal reflection
    // Uses the diagonal/hypotenuse edge (edge 1) of the triangle polygon
    const edgeKey = `${fromId}|DIAG`;
    return { coord: [i, j] as const, voltage: DIAGONAL_REFLECTION, edgeKey, fromPolygonEdgeIndex: P4G_DIAG_EDGE, toPolygonEdgeIndex: P4G_DIAG_EDGE };
  }

  // For superdiagonal nodes (triangle: edges 0=N, 1=diagonal, 2=W),
  // only N and E directions reach here (S→self-loop, W→null above).
  // For regular nodes (square: edges 0=N, 1=E, 2=S, 3=W), use standard mapping.
  let fromEdge: number;
  if (isOnFirstSuperdiagonal) {
    // Triangle node: N exits through top edge (0), E exits through diagonal (1)
    fromEdge = dir === "N" ? 0 : 1;
  } else {
    fromEdge = directionToPolygonEdge(dir);
  }

  switch (dir) {
    case "N": {
      if (j === 1) {
        // North border: P4g boundary N(0)→W(3) for square targets, or W(2) for triangle targets
        const newI = maxOdd;
        const newJ = maxOdd + 1 - i;
        const voltage = translationWith90CCW(2 * n, -2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|");
        // Target's polygon edge depends on whether the target is a triangle or square
        const targetIsTriangle = newI === newJ + 2;
        const toEdge = targetIsTriangle ? 2 : directionToPolygonEdge("W");
        return { coord: [newI, newJ] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: oppositePolygonEdge(directionToPolygonEdge("N")) };
    }
    case "S": {
      if (j === maxOdd) {
        return null;
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      // Target is below, so enters through its North edge
      const targetIsTriangle = i === j + 4;
      const toEdge = targetIsTriangle ? 0 : directionToPolygonEdge("N");
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
    }
    case "E": {
      if (i === maxOdd) {
        return null;
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      // Target is to the right, enters through its West edge
      const targetIsTriangle = (i + 2) === j + 2;
      const toEdge = targetIsTriangle ? 2 : directionToPolygonEdge("W");
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
    }
    case "W": {
      if (i === 1) {
        // West border: P4g boundary W(3)→N(0) for square targets, or N(0) for triangle targets
        const newI = maxOdd + 1 - j;
        const newJ = maxOdd;
        const voltage = translationWith90CW(-2 * n, 2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|");
        const targetIsTriangle = newI === newJ + 2;
        const toEdge = targetIsTriangle ? 0 : directionToPolygonEdge("N");
        return { coord: [newI, newJ] as const, voltage, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      // Target is to the left, enters through its East edge (or diagonal edge for triangles)
      const targetIsTriangle = (i - 2) === j + 2;
      const toEdge = targetIsTriangle ? 1 : directionToPolygonEdge("E");
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey, fromPolygonEdgeIndex: fromEdge, toPolygonEdgeIndex: toEdge };
    }
  }
}

/**
 * Create a P4g orbifold grid.
 *
 * P4g is P4 folded across the NW-SE diagonal; only nodes strictly above the
 * diagonal are kept. The first superdiagonal receives a diagonal reflection
 * self-loop to mirror across the excluded half. Requires n >= 4.
 *
 * Nodes on the superdiagonal (i = j + 2) have a right triangle polygon:
 *   vertices: (i-1,j-1), (i+1,j-1), (i-1,j+1)
 *   edges: 0=North (top), 1=diagonal (hypotenuse), 2=West (left)
 * All other nodes have a standard square polygon.
 */
export function createP4gGrid(n: Int, initialColors?: ("black" | "white")[][]) {
  if (n < 4) {
    throw new Error("P4g grid size n must be at least 4");
  }

  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ColorData>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>();
  const processedEdges = new Set<string>();

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (row >= col) {
        continue;
      }
      const i = 2 * col + 1;
      const j = 2 * row + 1;
      const coord: readonly [Int, Int] = [i, j];
      const id = nodeIdFromCoord(coord);
      const color = initialColors?.[row]?.[col] ?? "white";

      // Nodes on the first superdiagonal get a right triangle polygon;
      // all others get a standard square polygon.
      const isOnFirstSuperdiagonal = i === j + 2;
      const polygon: readonly (readonly [number, number])[] = isOnFirstSuperdiagonal
        ? [[i - 1, j - 1], [i + 1, j - 1], [i - 1, j + 1]] as const
        : squarePolygon(i, j);

      nodes.set(id, {
        id,
        coord,
        polygon,
        data: { color },
      });
    }
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (row >= col) {
        continue;
      }
      const i = 2 * col + 1;
      const j = 2 * row + 1;
      const fromId = nodeIdFromCoord([i, j]);

      for (const dir of ["N", "S", "E", "W"] as Direction[]) {
        const result = getP4gNeighbor(i, j, dir, n);
        if (!result) {
          continue;
        }

        const { coord: toCoord, voltage, edgeKey, fromPolygonEdgeIndex, toPolygonEdgeIndex } = result;
        const toId = nodeIdFromCoord(toCoord);

        if (!nodes.has(toId)) {
          continue;
        }

        if (processedEdges.has(edgeKey)) {
          continue;
        }
        processedEdges.add(edgeKey);

        const edgeId = edgeKey.replace(/\|/g, "--");

        if (fromId === toId) {
          const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
          halfEdges.set(fromId, { to: fromId, voltage, polygonEdgeIndex: fromPolygonEdgeIndex });

          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
            data: { linestyle: "solid" },
          });
        } else {
          const inverseVoltage = matInvUnimodular(voltage);
          const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
          halfEdges.set(fromId, { to: toId, voltage, polygonEdgeIndex: fromPolygonEdgeIndex });
          halfEdges.set(toId, { to: fromId, voltage: inverseVoltage, polygonEdgeIndex: toPolygonEdgeIndex });

          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
            data: { linestyle: "solid" },
          });
        }
      }
    }
  }

  return { nodes, edges } as OrbifoldGrid<ColorData, EdgeStyleData>;
}
