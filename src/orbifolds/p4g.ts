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
} from "./orbifoldShared";

const DIAGONAL_REFLECTION: Matrix3x3 = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
] as const;

/**
 * Helper to add an edge to the grid, avoiding duplicates.
 */
/**
 * Add an orbifold edge, skipping duplicates and non-existent target nodes.
 * Edges between grid/diagonal nodes can be requested from both endpoints;
 * the edgeKey deduplicates so each edge is created exactly once.
 */
function addEdge(
  edges: Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>,
  processedEdges: Set<string>,
  nodes: Map<OrbifoldNodeId, OrbifoldNode<ColorData>>,
  fromId: OrbifoldNodeId,
  toId: OrbifoldNodeId,
  voltage: Matrix3x3,
  edgeKey: string,
): void {
  if (!nodes.has(toId)) return;
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
 * Create a P4g orbifold grid.
 *
 * P4g is P4 folded across the NW-SE diagonal. In the doubled coordinate system:
 * - Grid nodes (strictly above diagonal) are at (4*col+2, 4*row+2) for row < col.
 * - Diagonal half-triangle nodes are at (4*k+3, 4*k+1) for k = 0..n-1.
 *   These represent the upper half of each diagonal square.
 *
 * The diagonal nodes carry the diagonal-reflection self-edges. The first-superdiagonal
 * grid nodes no longer have self-edges; they connect to adjacent diagonal nodes instead.
 * Requires n >= 4.
 */
export function createP4gGrid(n: Int, initialColors?: ("black" | "white")[][]) {
  if (n < 4) {
    throw new Error("P4g grid size n must be at least 4");
  }

  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ColorData>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>();
  const processedEdges = new Set<string>();

  // Create grid nodes at doubled coordinates (4*col+2, 4*row+2) for row < col
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (row >= col) continue;
      const i = 4 * col + 2;
      const j = 4 * row + 2;
      const coord: readonly [Int, Int] = [i, j];
      const id = nodeIdFromCoord(coord);
      const color = initialColors?.[row]?.[col] ?? "white";
      nodes.set(id, { id, coord, data: { color } });
    }
  }

  // Create diagonal half-triangle nodes at (4*k+3, 4*k+1) for k = 0..n-1
  for (let k = 0; k < n; k++) {
    const i = 4 * k + 3;
    const j = 4 * k + 1;
    const coord: readonly [Int, Int] = [i, j];
    const id = nodeIdFromCoord(coord);
    nodes.set(id, { id, coord, data: { color: "white" } });
  }

  // --- Grid node edges ---
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (row >= col) continue;
      const i = 4 * col + 2;
      const j = 4 * row + 2;
      const fromId = nodeIdFromCoord([i, j]);
      const isOnFirstSuperdiagonal = col === row + 1;

      // North
      if (j === 2) {
        // N border crossing with 90° CCW rotation
        const tI = 4 * n - 2;
        const tJ = 4 * n - i;
        const voltage = translationWith90CCW(4 * n, -4 * n);
        const toId = nodeIdFromCoord([tI, tJ]);
        const edgeKey = fromId === toId
          ? `${fromId}|N-BORDER`
          : [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, voltage, edgeKey);
      } else {
        const toId = nodeIdFromCoord([i, j - 4]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey);
      }

      // South
      if (isOnFirstSuperdiagonal) {
        // Connect to diagonal node k+1 (the diagonal square below)
        // Superdiag at (row, row+1): going S reaches diagonal square (row+1, row+1)
        const k = row + 1;
        if (k < n) {
          const diagI = 4 * k + 3;
          const diagJ = 4 * k + 1;
          const toId = nodeIdFromCoord([diagI, diagJ]);
          const edgeKey = [fromId, toId].sort().join("|");
          addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey);
        }
      } else {
        const toId = nodeIdFromCoord([i, j + 4]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey);
      }

      // East
      if (i < 4 * (n - 1) + 2) {
        const toId = nodeIdFromCoord([i + 4, j]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey);
      }

      // West
      if (isOnFirstSuperdiagonal) {
        // Connect to diagonal node k (the diagonal square to the left)
        // Superdiag at (row, row+1): going W reaches diagonal square (row, row)
        const k = row;
        const diagI = 4 * k + 3;
        const diagJ = 4 * k + 1;
        const toId = nodeIdFromCoord([diagI, diagJ]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey);
      } else {
        const toId = nodeIdFromCoord([i - 4, j]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey);
      }
    }
  }

  // --- Diagonal node edges ---
  for (let k = 0; k < n; k++) {
    const diagI = 4 * k + 3;
    const diagJ = 4 * k + 1;
    const diagId = nodeIdFromCoord([diagI, diagJ]);

    // Self-loop with diagonal reflection
    const selfKey = `${diagId}|DIAG`;
    addEdge(edges, processedEdges, nodes, diagId, diagId, DIAGONAL_REFLECTION, selfKey);

    // Border crossing: first diagonal node (k=0) connects to last diagonal node (k=n-1)
    if (k === 0 && n > 1) {
      const lastDiagI = 4 * (n - 1) + 3;
      const lastDiagJ = 4 * (n - 1) + 1;
      const lastDiagId = nodeIdFromCoord([lastDiagI, lastDiagJ]);
      const voltage = translationWith90CCW(4 * n, -4 * n);
      const edgeKey = [diagId, lastDiagId].sort().join("|") + "|DIAG-BORDER";
      addEdge(edges, processedEdges, nodes, diagId, lastDiagId, voltage, edgeKey);
    }
  }

  return { nodes, edges } as OrbifoldGrid<ColorData, EdgeStyleData>;
}
