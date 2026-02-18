/**
 * Doubling transformation for orbifold grids.
 *
 * Produces a "doubled" orbifold by introducing a level parameter (0 = low, 1 = high)
 * to each node.  For every original node we create two nodes (one per level),
 * and for every original edge we create four edges (low→low, low→high,
 * high→low, high→high).  Voltages are copied verbatim – they only act on the
 * 2D (x, y) coordinates and ignore the level.
 *
 * Node IDs are extended with a `@<level>` suffix, e.g. "3,5" → "3,5@0" and "3,5@1".
 * Edge IDs are extended with `@<fromLevel><toLevel>`, e.g. "e0" → "e0@00", "e0@01", …
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

/** Append level-pair suffix to an orbifold edge ID. */
export function doubledEdgeId(baseId: OrbifoldEdgeId, fromLevel: Level, toLevel: Level): OrbifoldEdgeId {
  return `${baseId}@${fromLevel}${toLevel}`;
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
 * - Every edge becomes four edges covering all level combinations
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

  // --- Quadruple edges (or triple for self-edges) ---
  for (const [, edge] of grid.edges) {
    if (edge.halfEdges.size === 1) {
      // Self-edge: A → A.  Doubling produces 3 edges:
      //   @00: self-edge on A@0
      //   @11: self-edge on A@1
      //   @01: regular edge A@0 ↔ A@1  (note: @10 would be the same undirected edge)
      const [[baseNodeId, half]] = Array.from(edge.halfEdges.entries());

      // @00: self-edge on A@0
      {
        const id = doubledEdgeId(edge.id, 0, 0);
        const nodeId = doubledNodeId(baseNodeId, 0);
        const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
        halfEdges.set(nodeId, {
          to: nodeId,
          voltage: half.voltage,
          polygonSides: [...half.polygonSides],
        });
        edges.set(id, { id, halfEdges, data: cloneE(edge.data) });
      }

      // @11: self-edge on A@1
      {
        const id = doubledEdgeId(edge.id, 1, 1);
        const nodeId = doubledNodeId(baseNodeId, 1);
        const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
        halfEdges.set(nodeId, {
          to: nodeId,
          voltage: half.voltage,
          polygonSides: [...half.polygonSides],
        });
        edges.set(id, { id, halfEdges, data: cloneE(edge.data) });
      }

      // @01: regular edge A@0 ↔ A@1
      {
        const id = doubledEdgeId(edge.id, 0, 1);
        const n0 = doubledNodeId(baseNodeId, 0);
        const n1 = doubledNodeId(baseNodeId, 1);
        const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
        halfEdges.set(n0, {
          to: n1,
          voltage: half.voltage,
          polygonSides: [...half.polygonSides],
        });
        halfEdges.set(n1, {
          to: n0,
          voltage: half.voltage, // Self-edge voltage is involutive (V = V^-1)
          polygonSides: [...half.polygonSides],
        });
        edges.set(id, { id, halfEdges, data: cloneE(edge.data) });
      }
    } else {
      // Two-endpoint edge: produce 4 edges as before
      for (const fromLevel of [0, 1] as Level[]) {
        for (const toLevel of [0, 1] as Level[]) {
          const newEdgeId = doubledEdgeId(edge.id, fromLevel, toLevel);

          const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();

          const entries = Array.from(edge.halfEdges.entries());
          const [n1, h1] = entries[0];
          const [n2, h2] = entries[1];

          const newN1 = doubledNodeId(n1, fromLevel);
          const newN2 = doubledNodeId(n2, toLevel);

          if (newN1 === newN2) {
            // Collapsed to self-edge (unlikely but handle correctly)
            halfEdges.set(newN1, {
              to: newN2,
              voltage: h1.voltage,
              polygonSides: [...h1.polygonSides, ...h2.polygonSides],
            });
          } else {
            halfEdges.set(newN1, {
              to: newN2,
              voltage: h1.voltage,
              polygonSides: [...h1.polygonSides],
            });
            halfEdges.set(newN2, {
              to: newN1,
              voltage: h2.voltage,
              polygonSides: [...h2.polygonSides],
            });
          }

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
