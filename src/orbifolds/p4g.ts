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
  fromSides: number[],
  toSides: number[],
): void {
  if (!nodes.has(toId)) return;
  if (processedEdges.has(edgeKey)) return;
  processedEdges.add(edgeKey);

  const edgeId = edgeKey.replace(/\|/g, "--");

  if (fromId === toId) {
    // Self-edge: combine fromSides and toSides into one half-edge
    const combinedSides = [...fromSides];
    for (const s of toSides) {
      if (!combinedSides.includes(s)) combinedSides.push(s);
    }
    const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3; polygonSides: number[] }>();
    halfEdges.set(fromId, { to: fromId, voltage, polygonSides: combinedSides });
    edges.set(edgeId, { id: edgeId, halfEdges, data: { linestyle: "solid" } });
  } else {
    const inverseVoltage = matInvUnimodular(voltage);
    const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3; polygonSides: number[] }>();
    halfEdges.set(fromId, { to: toId, voltage, polygonSides: fromSides });
    halfEdges.set(toId, { to: fromId, voltage: inverseVoltage, polygonSides: toSides });
    edges.set(edgeId, { id: edgeId, halfEdges, data: { linestyle: "solid" } });
  }
}

/**
 * Build a square polygon (clockwise: NW, NE, SE, SW) for a P4g grid node at (i, j).
 * P4g grid nodes use 4-unit spacing.
 */
function p4gSquarePolygon(i: Int, j: Int): readonly (readonly [number, number])[] {
  return [
    [i - 2, j - 2], // NW (side 0 = North)
    [i + 2, j - 2], // NE (side 1 = East)
    [i + 2, j + 2], // SE (side 2 = South)
    [i - 2, j + 2], // SW (side 3 = West)
  ] as const;
}

/**
 * Build a triangle polygon (clockwise: NW, NE, SE) for a P4g diagonal node.
 * The triangle is the upper-right half of the diagonal square cut by the NW-SE diagonal.
 * Side 0 (NW→NE) = North, Side 1 (NE→SE) = East, Side 2 (SE→NW) = Diagonal (hypotenuse)
 */
function p4gTrianglePolygon(k: Int): readonly (readonly [number, number])[] {
  const base = 4 * k;
  return [
    [base, base],         // NW (side 0 = North: NW→NE)
    [base + 4, base],     // NE (side 1 = East: NE→SE)
    [base + 4, base + 4], // SE (side 2 = Diagonal: SE→NW)
  ] as const;
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
 *
 * Grid node polygon sides: N=0, E=1, S=2, W=3 (square)
 * Diagonal node polygon sides: N=0, E=1, Diag=2 (triangle)
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
      nodes.set(id, { id, coord, polygon: p4gSquarePolygon(i, j), data: { color } });
    }
  }

  // Create diagonal half-triangle nodes at (4*k+3, 4*k+1) for k = 0..n-1
  for (let k = 0; k < n; k++) {
    const i = 4 * k + 3;
    const j = 4 * k + 1;
    const coord: readonly [Int, Int] = [i, j];
    const id = nodeIdFromCoord(coord);
    nodes.set(id, { id, coord, polygon: p4gTrianglePolygon(k), data: { color: "white" } });
  }

  // --- Grid node edges ---
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (row >= col) continue;
      const i = 4 * col + 2;
      const j = 4 * row + 2;
      const fromId = nodeIdFromCoord([i, j]);
      const isOnFirstSuperdiagonal = col === row + 1;

      // North (from side 0)
      if (j === 2) {
        // N border crossing with 90° CCW rotation
        const tI = 4 * n - 2;
        const tJ = 4 * n - i;
        const voltage = translationWith90CCW(4 * n, -4 * n);
        const toId = nodeIdFromCoord([tI, tJ]);
        const edgeKey = fromId === toId
          ? `${fromId}|N-BORDER`
          : [fromId, toId].sort().join("|");
        // Target is on east border, arrives at E side (1)
        addEdge(edges, processedEdges, nodes, fromId, toId, voltage, edgeKey, [0], [1]);
      } else {
        const toId = nodeIdFromCoord([i, j - 4]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey, [0], [2]);
      }

      // South (from side 2)
      if (isOnFirstSuperdiagonal) {
        // Connect to diagonal node k+1 (the diagonal square below)
        const k = row + 1;
        if (k < n) {
          const diagI = 4 * k + 3;
          const diagJ = 4 * k + 1;
          const toId = nodeIdFromCoord([diagI, diagJ]);
          const edgeKey = [fromId, toId].sort().join("|");
          // Grid node S side (2) → diagonal node N side (0)
          addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey, [2], [0]);
        }
      } else {
        const toId = nodeIdFromCoord([i, j + 4]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey, [2], [0]);
      }

      // East (from side 1)
      if (i < 4 * (n - 1) + 2) {
        const toId = nodeIdFromCoord([i + 4, j]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey, [1], [3]);
      }

      // West (from side 3)
      if (isOnFirstSuperdiagonal) {
        // Connect to diagonal node k (the diagonal square to the left)
        const k = row;
        const diagI = 4 * k + 3;
        const diagJ = 4 * k + 1;
        const toId = nodeIdFromCoord([diagI, diagJ]);
        const edgeKey = [fromId, toId].sort().join("|");
        // Grid node W side (3) → diagonal node E side (1)
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey, [3], [1]);
      } else {
        const toId = nodeIdFromCoord([i - 4, j]);
        const edgeKey = [fromId, toId].sort().join("|");
        addEdge(edges, processedEdges, nodes, fromId, toId, I3, edgeKey, [3], [1]);
      }
    }
  }

  // --- Diagonal node edges ---
  for (let k = 0; k < n; k++) {
    const diagI = 4 * k + 3;
    const diagJ = 4 * k + 1;
    const diagId = nodeIdFromCoord([diagI, diagJ]);

    // Self-loop with diagonal reflection (uses diagonal/hypotenuse side = 2)
    const selfKey = `${diagId}|DIAG`;
    addEdge(edges, processedEdges, nodes, diagId, diagId, DIAGONAL_REFLECTION, selfKey, [2], [2]);

    // Border crossing: first diagonal node (k=0) connects to last diagonal node (k=n-1)
    if (k === 0 && n > 1) {
      const lastDiagI = 4 * (n - 1) + 3;
      const lastDiagJ = 4 * (n - 1) + 1;
      const lastDiagId = nodeIdFromCoord([lastDiagI, lastDiagJ]);
      const voltage = translationWith90CCW(4 * n, -4 * n);
      const edgeKey = [diagId, lastDiagId].sort().join("|") + "|DIAG-BORDER";
      // k=0 uses N side (0), k=n-1 uses E side (1)
      addEdge(edges, processedEdges, nodes, diagId, lastDiagId, voltage, edgeKey, [0], [1]);
    }
  }

  return { nodes, edges } as OrbifoldGrid<ColorData, EdgeStyleData>;
}
