/**
 * Doubling transformation for orbifold grids.
 *
 * Produces a "doubled" orbifold by introducing a level parameter (0 = low, 1 = high)
 * to each node.  The doubling works as follows:
 *
 * 1. For every original node, create two copies: node@0 (low) and node@1 (high).
 *
 * 2. For every **regular** edge (2 half-edges, connecting A ↔ B):
 *    create **4 edges** covering all level pairs:
 *      - e@00: A@0 ↔ B@0  (same voltage)
 *      - e@01: A@0 ↔ B@1  (same voltage)
 *      - e@10: A@1 ↔ B@0  (same voltage)
 *      - e@11: A@1 ↔ B@1  (same voltage)
 *
 * 3. For every **self-edge** (1 half-edge, involution on A → A):
 *    create **3 edges**:
 *      - e@0:     self-edge on A@0  (same involution voltage)
 *      - e@1:     self-edge on A@1  (same involution voltage)
 *      - e@cross: cross edge A@0 ↔ A@1  (same involution voltage)
 *
 * Voltages are preserved — they act only on 2D position, not level.
 *
 * Node IDs are extended with a `@<level>` suffix, e.g. "3,5" → "3,5@0" and "3,5@1".
 * Edge IDs are extended with `@<fromLevel><toLevel>` for regular edges, `@<level>`
 * for same-level self-edges, or `@cross` for the cross-level self-edge copy.
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
  buildAdjacency,
} from "./orbifoldbasics";

export type Level = 0 | 1;

/** Append level suffix to an orbifold node ID. */
export function doubledNodeId(baseId: OrbifoldNodeId, level: Level): OrbifoldNodeId {
  return `${baseId}@${level}`;
}

/** Edge ID for a regular-edge copy with specific from/to levels. */
export function layerEdgeId(baseId: OrbifoldEdgeId, fromLevel: Level, toLevel: Level): OrbifoldEdgeId {
  return `${baseId}@${fromLevel}${toLevel}`;
}

/** Edge ID for a same-level self-edge copy. */
export function selfEdgeLevelId(baseId: OrbifoldEdgeId, level: Level): OrbifoldEdgeId {
  return `${baseId}@${level}`;
}

/** Edge ID for the cross-level self-edge copy. */
export function selfEdgeCrossId(baseId: OrbifoldEdgeId): OrbifoldEdgeId {
  return `${baseId}@cross`;
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
 * - Regular edges (A↔B) produce 4 doubled edges (all level pairs)
 * - Self-edges (involutions on A) produce 3 doubled edges (2 self + 1 cross)
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

  // --- Double edges ---
  for (const [, edge] of grid.edges) {
    const isSelfEdge = edge.halfEdges.size === 1;

    if (isSelfEdge) {
      // Self-edge: 1 half-edge, involution on node A
      const [[nodeId, half]] = Array.from(edge.halfEdges.entries());

      // (a) Same-level self-edges: e@0 and e@1
      for (const level of [0, 1] as Level[]) {
        const newEdgeId = selfEdgeLevelId(edge.id, level);
        const newNodeId = doubledNodeId(nodeId, level);
        const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
        halfEdges.set(newNodeId, {
          to: newNodeId,
          voltage: half.voltage,
          polygonSides: [...half.polygonSides],
        });
        edges.set(newEdgeId, {
          id: newEdgeId,
          halfEdges,
          data: cloneE(edge.data),
        });
      }

      // (b) Cross-level edge: e@cross  (A@0 ↔ A@1, same involution voltage)
      const crossEdgeId = selfEdgeCrossId(edge.id);
      const n0 = doubledNodeId(nodeId, 0);
      const n1 = doubledNodeId(nodeId, 1);
      const crossHalfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
      crossHalfEdges.set(n0, {
        to: n1,
        voltage: half.voltage,
        polygonSides: [...half.polygonSides],
      });
      crossHalfEdges.set(n1, {
        to: n0,
        voltage: half.voltage,
        polygonSides: [...half.polygonSides],
      });
      edges.set(crossEdgeId, {
        id: crossEdgeId,
        halfEdges: crossHalfEdges,
        data: cloneE(edge.data),
      });
    } else {
      // Regular edge: 2 half-edges, A ↔ B
      // Create 4 copies: all level combinations (fromLevel, toLevel)
      const entries = Array.from(edge.halfEdges.entries());
      const [nodeA, halfA] = entries[0];
      const [nodeB, halfB] = entries[1];

      for (const fromLevel of [0, 1] as Level[]) {
        for (const toLevel of [0, 1] as Level[]) {
          const newEdgeId = layerEdgeId(edge.id, fromLevel, toLevel);
          const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();

          // Half-edge from A@fromLevel → B@toLevel
          halfEdges.set(doubledNodeId(nodeA, fromLevel), {
            to: doubledNodeId(nodeB, toLevel),
            voltage: halfA.voltage,
            polygonSides: [...halfA.polygonSides],
          });

          // Half-edge from B@toLevel → A@fromLevel
          halfEdges.set(doubledNodeId(nodeB, toLevel), {
            to: doubledNodeId(nodeA, fromLevel),
            voltage: halfB.voltage,
            polygonSides: [...halfB.polygonSides],
          });

          edges.set(newEdgeId, {
            id: newEdgeId,
            halfEdges,
            data: cloneE(edge.data),
          });
        }
      }
    }
  }

  const result: OrbifoldGrid<ND, ED> = { nodes, edges };
  buildAdjacency(result);
  return result;
}
