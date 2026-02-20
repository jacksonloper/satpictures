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
  splitCornerSquare,
  translationWith120CCW,
  translationWith180,
} from "./orbifoldShared";

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
 * Build a square polygon (clockwise: NW, NE, SE, SW) for a P6 grid node at (i, j).
 * P6 grid nodes use 4-unit spacing.
 */
function p6SquarePolygon(i: Int, j: Int): readonly (readonly [number, number])[] {
  return [
    [i - 2, j - 2], // NW (side 0 = North)
    [i + 2, j - 2], // NE (side 1 = East)
    [i + 2, j + 2], // SE (side 2 = South)
    [i - 2, j + 2], // SW (side 3 = West)
  ] as const;
}

/**
 * Build a triangle polygon (clockwise: NW, NE, SE) for a P6 diagonal node.
 * The triangle is the upper-right half of the square from (base, base) to (base+4, base+4),
 * cut by the NW-SE diagonal, where base = 4*k.
 * Side 0 (NW→NE) = North, Side 1 (NE→SE) = East, Side 2 (SE→NW) = Diagonal (hypotenuse)
 */
function p6TrianglePolygon(k: Int): readonly (readonly [number, number])[] {
  const base = 4 * k;
  return [
    [base, base],         // NW (side 0 = North: NW→NE)
    [base + 4, base],     // NE (side 1 = East: NE→SE)
    [base + 4, base + 4], // SE (side 2 = Diagonal: SE→NW)
  ] as const;
}

/**
 * Create a P6 orbifold grid.
 *
 * P6 is P3 folded across the NW-SE diagonal. In the doubled coordinate system:
 * - Grid nodes (strictly above diagonal) are at (4*col+2, 4*row+2) for row < col.
 * - Diagonal half-triangle nodes are at (4*k+3, 4*k+1) for k = 0..n-1.
 *   These represent the upper half of each diagonal square.
 *
 * Like P4g, the diagonal is folded, but the differences are:
 * 1. Border crossings (N) use P3's 120° rotation voltages instead of P4's 90°.
 * 2. Diagonal edges are a "flip" (180° rotation around diagonal center) instead of
 *    a mirror (diagonal reflection self-loop). Node k's hypotenuse connects to
 *    node (n-1-k)'s hypotenuse.
 *
 * Requires n >= 4.
 *
 * Grid node polygon sides: N=0, E=1, S=2, W=3 (square)
 * Diagonal node polygon sides: N=0, E=1, Diag=2 (triangle)
 */
export function createP6Grid(n: Int, initialColors?: ("black" | "white")[][]) {
  if (n < 4) {
    throw new Error("P6 grid size n must be at least 4");
  }

  const L = 4 * n; // lattice constant

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
      nodes.set(id, { id, coord, polygon: p6SquarePolygon(i, j), data: { color } });
    }
  }

  // Create diagonal half-triangle nodes at (4*k+3, 4*k+1) for k = 0..n-1
  for (let k = 0; k < n; k++) {
    const i = 4 * k + 3;
    const j = 4 * k + 1;
    const coord: readonly [Int, Int] = [i, j];
    const id = nodeIdFromCoord(coord);
    nodes.set(id, { id, coord, polygon: p6TrianglePolygon(k), data: { color: "white" } });
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
        // N border crossing with 120° CCW rotation (P3 voltage)
        const tI = 4 * n - 2;
        const tJ = 4 * n - i;
        const voltage = translationWith120CCW(2 * L, -L);
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
  // Diagonal flip voltage: 180° rotation around center of diagonal = (L/2, L/2)
  // Maps (x,y) → (L-x, L-y). This is involutive (V² = I).
  const diagFlipVoltage = translationWith180(L, L);

  for (let k = 0; k < n; k++) {
    const diagI = 4 * k + 3;
    const diagJ = 4 * k + 1;
    const diagId = nodeIdFromCoord([diagI, diagJ]);

    // Flip edge: node k's hypotenuse (side 2) ↔ node (n-1-k)'s hypotenuse (side 2)
    const partner = n - 1 - k;
    if (partner >= k) {
      // Only process each pair once (or self-edge for middle node)
      const partnerI = 4 * partner + 3;
      const partnerJ = 4 * partner + 1;
      const partnerId = nodeIdFromCoord([partnerI, partnerJ]);

      if (partner === k) {
        // Self-edge (middle node when n is odd)
        const selfKey = `${diagId}|DIAG`;
        addEdge(edges, processedEdges, nodes, diagId, diagId, diagFlipVoltage, selfKey, [2], [2]);
      } else {
        const edgeKey = [diagId, partnerId].sort().join("|") + "|DIAG-FLIP";
        addEdge(edges, processedEdges, nodes, diagId, partnerId, diagFlipVoltage, edgeKey, [2], [2]);
      }
    }

    // Border crossing: first diagonal node (k=0) connects to last diagonal node (k=n-1)
    if (k === 0 && n > 1) {
      const lastDiagI = 4 * (n - 1) + 3;
      const lastDiagJ = 4 * (n - 1) + 1;
      const lastDiagId = nodeIdFromCoord([lastDiagI, lastDiagJ]);
      const voltage = translationWith120CCW(2 * L, -L);
      const edgeKey = [diagId, lastDiagId].sort().join("|") + "|DIAG-BORDER";
      // k=0 uses N side (0), k=n-1 uses E side (1)
      addEdge(edges, processedEdges, nodes, diagId, lastDiagId, voltage, edgeKey, [0], [1]);
    }
  }

  const grid = { nodes, edges } as OrbifoldGrid<ColorData, EdgeStyleData>;

  // Split the NE grid node to eliminate the non-involutive N-BORDER self-edge.
  // The NE grid node is at col=n-1, row=0: i=4*(n-1)+2, j=2.
  const neI = 4 * (n - 1) + 2;
  const neJ = 2;
  splitCornerSquare(
    grid,
    neI, neJ,
    [neI - 1, neJ - 1], [neI + 1, neJ + 1],
    0, 1,
    translationWith120CCW(2 * L, -L),
    2,
  );

  return grid;
}
