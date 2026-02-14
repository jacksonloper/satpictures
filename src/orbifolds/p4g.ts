import {
  type Int,
  type Matrix3x3,
  I3,
  nodeIdFromCoord,
  matInvUnimodular,
  type OrbifoldNodeId,
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
} from "./orbifoldShared";

const DIAGONAL_REFLECTION: Matrix3x3 = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
] as const;

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
  const isFirstSuperDiagonal = i === j + 2;

  if (isFirstSuperDiagonal && (dir === "S" || dir === "W")) {
    if (dir === "W") {
      return null;
    }
    const edgeKey = `${fromId}|DIAG`;
    return { coord: [i, j] as const, voltage: DIAGONAL_REFLECTION, edgeKey };
  }

  switch (dir) {
    case "N": {
      if (j === 1) {
        const newI = maxOdd;
        const newJ = maxOdd + 1 - i;
        const voltage = translationWith90CCW(2 * n, -2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i, j - 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j - 2] as const, voltage: I3, edgeKey };
    }
    case "S": {
      if (j === maxOdd) {
        return null;
      }
      const toId = nodeIdFromCoord([i, j + 2]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i, j + 2] as const, voltage: I3, edgeKey };
    }
    case "E": {
      if (i === maxOdd) {
        return null;
      }
      const toId = nodeIdFromCoord([i + 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i + 2, j] as const, voltage: I3, edgeKey };
    }
    case "W": {
      if (i === 1) {
        const newI = maxOdd + 1 - j;
        const newJ = maxOdd;
        const voltage = translationWith90CW(-2 * n, 2 * n);
        const toId = nodeIdFromCoord([newI, newJ]);
        const edgeKey = [fromId, toId].sort().join("|");
        return { coord: [newI, newJ] as const, voltage, edgeKey };
      }
      const toId = nodeIdFromCoord([i - 2, j]);
      const edgeKey = [fromId, toId].sort().join("|");
      return { coord: [i - 2, j] as const, voltage: I3, edgeKey };
    }
  }
}

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

      nodes.set(id, {
        id,
        coord,
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

        const { coord: toCoord, voltage, edgeKey } = result;
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
          const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3 }>();
          halfEdges.set(fromId, { to: fromId, voltage });

          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
            data: { linestyle: "solid" },
          });
        } else {
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

  return { nodes, edges } as OrbifoldGrid<ColorData, EdgeStyleData>;
}
