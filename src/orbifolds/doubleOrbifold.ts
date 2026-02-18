/**
 * Doubling transformation for orbifold grids.
 *
 * Produces a "doubled" orbifold by introducing a level parameter (0 = low, 1 = high)
 * to each node.  The doubling works as follows:
 *
 * 1. For every original node, create two copies: node@0 (low) and node@1 (high).
 * 2. For every original edge, create two copies (one within each level) with the
 *    same voltage and structure.  Edge "e" becomes "e@0" (among level-0 nodes)
 *    and "e@1" (among level-1 nodes).
 * 3. For every original node, introduce a vertical identity-voltage edge between
 *    node@0 and node@1.  These are tagged "vert:<nodeId>".
 *
 * This means all edges are either *within-layer* (same level) or *same-xy
 * between-layer* (vertical, identity voltage).  No cross-level diagonal edges
 * exist, which greatly simplifies rendering and eliminates special-casing for
 * self-edges.
 *
 * Node IDs are extended with a `@<level>` suffix, e.g. "3,5" → "3,5@0" and "3,5@1".
 * Edge IDs are extended with `@<level>` for layer copies, or prefixed with "vert:" for
 * vertical edges.
 *
 * The polygon geometry is shared between the two copies (same 2D position).
 */

import {
  type OrbifoldGrid,
  type OrbifoldNode,
  type OrbifoldEdge,
  type OrbifoldHalfEdge,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type ExtraData,
  type Matrix3x3,
  I3,
  buildAdjacency,
} from "./orbifoldbasics";

export type Level = 0 | 1;

/** Append level suffix to an orbifold node ID. */
export function doubledNodeId(baseId: OrbifoldNodeId, level: Level): OrbifoldNodeId {
  return `${baseId}@${level}`;
}

/** Edge ID for a within-layer copy of an original edge. */
export function layerEdgeId(baseId: OrbifoldEdgeId, level: Level): OrbifoldEdgeId {
  return `${baseId}@${level}`;
}

/** Edge ID for a vertical (between-layer) edge. */
export function verticalEdgeId(baseNodeId: OrbifoldNodeId): OrbifoldEdgeId {
  return `vert:${baseNodeId}`;
}

/** Extract the level from a doubled node ID.  Returns undefined if not a doubled ID. */
export function getLevelFromNodeId(nodeId: OrbifoldNodeId): Level | undefined {
  const m = nodeId.match(/@([01])$/);
  if (!m) return undefined;
  return Number(m[1]) as Level;
}

/** Strip the level suffix to recover the original orbifold node ID. */
export function getBaseNodeId(nodeId: OrbifoldNodeId): OrbifoldNodeId {
  return nodeId.replace(/@[01]$/, "");
}

/**
 * Transform a single-layer orbifold grid into a doubled orbifold.
 *
 * - Every node (x,y) becomes two nodes: (x,y)@0 and (x,y)@1
 * - Every edge is copied once per level (2× edges)
 * - A vertical identity-voltage edge connects node@0 ↔ node@1 for each node
 * - Voltages are preserved (they act only on x,y, not level)
 * - Node data is cloned via the optional `cloneNodeData` callback (defaults to
 *   shallow copy).
 * - Edge data is cloned via the optional `cloneEdgeData` callback.
 */
export function doubleOrbifold<
  ND extends ExtraData = ExtraData,
  ED extends ExtraData = ExtraData,
>(
  grid: OrbifoldGrid<ND, ED>,
  cloneNodeData?: (d: ND | undefined) => ND | undefined,
  cloneEdgeData?: (d: ED | undefined) => ED | undefined,
): OrbifoldGrid<ND, ED> {
  const cloneN = cloneNodeData ?? ((d) => d ? { ...d } as ND : undefined);
  const cloneE = cloneEdgeData ?? ((d) => d ? { ...d } as ED : undefined);

  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ND>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge<ED>>();

  // --- Double nodes ---
  for (const [, node] of grid.nodes) {
    for (const level of [0, 1] as Level[]) {
      const id = doubledNodeId(node.id, level);
      nodes.set(id, {
        id,
        coord: node.coord,
        polygon: node.polygon,
        data: cloneN(node.data),
      });
    }
  }

  // --- Copy edges: one copy per level (2× total) ---
  for (const [, edge] of grid.edges) {
    for (const level of [0, 1] as Level[]) {
      const newEdgeId = layerEdgeId(edge.id, level);
      const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();

      for (const [nodeId, half] of edge.halfEdges) {
        const newNodeId = doubledNodeId(nodeId, level);
        const newToId = doubledNodeId(half.to, level);
        halfEdges.set(newNodeId, {
          to: newToId,
          voltage: half.voltage,
          polygonSides: [...half.polygonSides],
        });
      }

      edges.set(newEdgeId, {
        id: newEdgeId,
        halfEdges,
        data: cloneE(edge.data),
      });
    }
  }

  // --- Vertical identity edges: one per original node ---
  const identityVoltage: Matrix3x3 = I3;
  for (const [nodeId] of grid.nodes) {
    const edgeId = verticalEdgeId(nodeId);
    const n0 = doubledNodeId(nodeId, 0);
    const n1 = doubledNodeId(nodeId, 1);
    const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
    halfEdges.set(n0, {
      to: n1,
      voltage: identityVoltage,
      polygonSides: [],
    });
    halfEdges.set(n1, {
      to: n0,
      voltage: identityVoltage,
      polygonSides: [],
    });
    edges.set(edgeId, {
      id: edgeId,
      halfEdges,
      data: cloneE(undefined),
    });
  }

  const result: OrbifoldGrid<ND, ED> = { nodes, edges };
  buildAdjacency(result);
  return result;
}
