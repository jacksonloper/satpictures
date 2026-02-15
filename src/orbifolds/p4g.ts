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
 * Coordinate helpers for the doubled-scale P4g grid.
 *
 * Regular nodes (row < col): coord = (4*col+2, 4*row+2)
 * Diagonal nodes (row == col == k, k=0..n-1): coord = (4*k+3, k+1)
 */
function p4gRegularCoord(row: Int, col: Int): readonly [Int, Int] {
  return [4 * col + 2, 4 * row + 2] as const;
}

function p4gDiagonalCoord(k: Int): readonly [Int, Int] {
  return [4 * k + 3, k + 1] as const;
}

/**
 * Get the P4g coordinate for a grid cell at (row, col).
 * Returns null if the cell is below the diagonal (row > col).
 */
export function p4gCoord(row: Int, col: Int): readonly [Int, Int] | null {
  if (row > col) return null;
  if (row === col) return p4gDiagonalCoord(row);
  return p4gRegularCoord(row, col);
}

/** Add a single edge (self-loop or regular) to the edge map, avoiding duplicates. */
function addEdge(
  edges: Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>,
  processedEdges: Set<string>,
  fromId: OrbifoldNodeId,
  toId: OrbifoldNodeId,
  voltage: Matrix3x3,
  edgeKey: string,
): void {
  if (processedEdges.has(edgeKey)) return;
  processedEdges.add(edgeKey);
  const edgeId = edgeKey.replace(/\|/g, "--");

  if (fromId === toId) {
    const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3 }>();
    halfEdges.set(fromId, { to: fromId, voltage });
    edges.set(edgeId, { id: edgeId, halfEdges, data: { linestyle: "solid" } });
  } else {
    const inverseVoltage = matInvUnimodular(voltage);
    const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3 }>();
    halfEdges.set(fromId, { to: toId, voltage });
    halfEdges.set(toId, { to: fromId, voltage: inverseVoltage });
    edges.set(edgeId, { id: edgeId, halfEdges, data: { linestyle: "solid" } });
  }
}

/**
 * Create a P4g orbifold grid with doubled scale.
 *
 * P4g is P4 folded across the NW-SE diagonal.  Nodes above the diagonal
 * (row < col) are "regular" nodes at doubled coordinates (4*col+2, 4*row+2).
 * Nodes ON the diagonal (row == col == k) are the new "diagonal" nodes at
 * (4*k+3, k+1).  Diagonal nodes carry a mirroring self-edge with
 * DIAGONAL_REFLECTION.  Voltage translations are also doubled (period 4n).
 *
 * Requires n >= 4.
 */
export function createP4gGrid(n: Int, initialColors?: ("black" | "white")[][]) {
  if (n < 4) {
    throw new Error("P4g grid size n must be at least 4");
  }

  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ColorData>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>();
  const processedEdges = new Set<string>();

  // --- Create regular nodes (row < col) ---
  for (let row = 0; row < n; row++) {
    for (let col = row + 1; col < n; col++) {
      const coord = p4gRegularCoord(row, col);
      const id = nodeIdFromCoord(coord);
      const color = initialColors?.[row]?.[col] ?? "white";
      nodes.set(id, { id, coord, data: { color } });
    }
  }

  // --- Create diagonal nodes (k = 0 .. n-1) ---
  for (let k = 0; k < n; k++) {
    const coord = p4gDiagonalCoord(k);
    const id = nodeIdFromCoord(coord);
    const color = initialColors?.[k]?.[k] ?? "white";
    nodes.set(id, { id, coord, data: { color } });
  }

  // --- Helper: canonical edge key for a pair of node ids ---
  const pairKey = (a: OrbifoldNodeId, b: OrbifoldNodeId) =>
    [a, b].sort().join("|");

  // --- Edges from regular nodes (row < col) ---
  for (let row = 0; row < n; row++) {
    for (let col = row + 1; col < n; col++) {
      const fromCoord = p4gRegularCoord(row, col);
      const fromId = nodeIdFromCoord(fromCoord);

      // N: row-1, same col
      if (row === 0) {
        // North boundary wrap: in P4, N from (row=0, col) wraps with 90° CCW
        // to (row'=n-1-col, col'=n-1), which is a regular node since
        // n-1-col < n-1 for col > 0.
        const tRow = n - 1 - col;
        const tCol = n - 1;
        const toCoord = tRow === tCol ? p4gDiagonalCoord(tRow) : p4gRegularCoord(tRow, tCol);
        const toId = nodeIdFromCoord(toCoord);
        // Voltage: 90° CCW rotation + translate so that
        //   V * toCoord = (fromCoord_x, fromCoord_y - 4) [virtual N-neighbor position]
        // For doubled P4g the period is 4n.
        const voltage = translationWith90CCW(4 * n, -4 * n);
        addEdge(edges, processedEdges, fromId, toId, voltage, pairKey(fromId, toId));
      } else {
        // Interior N: row-1 >= 0 and row-1 < col (since row < col → row-1 < col-1 < col when row>0)
        const tRow = row - 1;
        if (tRow === col) {
          // impossible as shown above, but guard
        } else if (tRow < col) {
          const toCoord = tRow === col ? p4gDiagonalCoord(tRow) : p4gRegularCoord(tRow, col);
          const toId = nodeIdFromCoord(toCoord);
          addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
        }
      }

      // S: row+1, same col
      if (row + 1 < col) {
        // Target is another regular node
        const toCoord = p4gRegularCoord(row + 1, col);
        const toId = nodeIdFromCoord(toCoord);
        addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
      } else if (row + 1 === col) {
        // Target is a diagonal node
        const toCoord = p4gDiagonalCoord(col);
        const toId = nodeIdFromCoord(toCoord);
        addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
      }
      // else row + 1 > col can't happen since row < col

      // E: same row, col+1
      if (col + 1 < n) {
        // Target is regular (row < col+1 since row < col < col+1)
        const toCoord = p4gRegularCoord(row, col + 1);
        const toId = nodeIdFromCoord(toCoord);
        addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
      }
      // else col+1 == n: E boundary → null (created by W wrap from other side)

      // W: same row, col-1
      if (col - 1 > row) {
        // Target is another regular node (row < col-1)
        const toCoord = p4gRegularCoord(row, col - 1);
        const toId = nodeIdFromCoord(toCoord);
        addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
      } else if (col - 1 === row) {
        // Target is a diagonal node at k = row
        const toCoord = p4gDiagonalCoord(row);
        const toId = nodeIdFromCoord(toCoord);
        addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
      }
      // else col-1 < row: can't happen since col > row → col-1 >= row
    }
  }

  // --- Edges from diagonal nodes (k = 0 .. n-1) ---
  for (let k = 0; k < n; k++) {
    const fromCoord = p4gDiagonalCoord(k);
    const fromId = nodeIdFromCoord(fromCoord);

    // Self-loop with DIAGONAL_REFLECTION
    const selfKey = `${fromId}|DIAG`;
    addEdge(edges, processedEdges, fromId, fromId, DIAGONAL_REFLECTION, selfKey);

    // N: regular node (row=k-1, col=k) — valid when k > 0
    if (k > 0) {
      const toCoord = p4gRegularCoord(k - 1, k);
      const toId = nodeIdFromCoord(toCoord);
      addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
    } else {
      // k == 0: N boundary wrap.  In P4, N from (0,0) wraps to (n-1, n-1).
      // Target is diagonal(n-1).
      const toCoord = p4gDiagonalCoord(n - 1);
      const toId = nodeIdFromCoord(toCoord);
      const voltage = translationWith90CCW(4 * n, -4 * n);
      const eKey = pairKey(fromId, toId) + "|N";
      addEdge(edges, processedEdges, fromId, toId, voltage, eKey);
    }

    // E: regular node (row=k, col=k+1) — valid when k+1 < n
    if (k + 1 < n) {
      const toCoord = p4gRegularCoord(k, k + 1);
      const toId = nodeIdFromCoord(toCoord);
      addEdge(edges, processedEdges, fromId, toId, I3, pairKey(fromId, toId));
    }
    // else: E boundary → null (created by W from other side)

    // W from diagonal(k): in P4, W from (k,k) goes to (k, k-1) which is
    // below diagonal → folds to (k-1, k) = N neighbor.  Already handled
    // by N edge + self-loop, so no explicit edge.  But when k == 0,
    // W wraps to (n-1-0, n-1) = (n-1, n-1) = diagonal(n-1) with 90° CW.
    // This is a second edge between diagonal(0) and diagonal(n-1).
    if (k === 0) {
      const toCoord = p4gDiagonalCoord(n - 1);
      const toId = nodeIdFromCoord(toCoord);
      const voltage = translationWith90CW(-4 * n, 4 * n);
      const eKey = pairKey(fromId, toId) + "|W";
      addEdge(edges, processedEdges, fromId, toId, voltage, eKey);
    }
  }

  return { nodes, edges } as OrbifoldGrid<ColorData, EdgeStyleData>;
}
