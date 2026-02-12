/**
 * Base class for OrbifoldLift implementations
 *
 * Provides common functionality for lifting sub-manifolds to larger graphs.
 */

import type {
  SubManifold,
  ManifoldType,
  OrbifoldLift,
  OrbifoldLiftGraph,
  LiftedNode,
  LiftedEdge,
  ManifoldNode,
} from "../manifold/types";

/**
 * Abstract base class for OrbifoldLift implementations
 */
export abstract class BaseOrbifoldLift implements OrbifoldLift {
  abstract readonly type: string;
  abstract readonly supportedManifolds: ManifoldType[];

  /**
   * Check if this lift supports the given manifold type
   */
  supports(manifoldType: ManifoldType): boolean {
    return this.supportedManifolds.includes(manifoldType);
  }

  /**
   * Perform the lift operation
   */
  abstract lift(
    subManifold: SubManifold,
    multiplier: number,
    cellSize: number
  ): OrbifoldLiftGraph;

  /**
   * Helper to create an OrbifoldLiftGraph from nodes and edges
   */
  protected buildGraph(
    nodes: LiftedNode[],
    edges: LiftedEdge[],
    manifold: SubManifold["manifold"]
  ): OrbifoldLiftGraph {
    // Build lookup maps
    const nodeById = new Map<number, LiftedNode>();
    const nodesByOriginal = new Map<string, LiftedNode[]>();
    const edgesByOriginal = new Map<string, LiftedEdge[]>();

    for (const node of nodes) {
      nodeById.set(node.id, node);

      const origKey = manifold.nodeKey(node.originalNode);
      if (!nodesByOriginal.has(origKey)) {
        nodesByOriginal.set(origKey, []);
      }
      nodesByOriginal.get(origKey)!.push(node);
    }

    for (const edge of edges) {
      const origKey = manifold.edgeKey(edge.originalEdge);
      if (!edgesByOriginal.has(origKey)) {
        edgesByOriginal.set(origKey, []);
      }
      edgesByOriginal.get(origKey)!.push(edge);
    }

    // Calculate bounds
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }

    // Handle empty graph case
    if (nodes.length === 0) {
      minX = minY = maxX = maxY = 0;
    }

    return {
      nodes,
      edges,
      nodeById,
      nodesByOriginal,
      edgesByOriginal,
      bounds: { minX, minY, maxX, maxY },
    };
  }

  /**
   * Helper to get the copy index from copy row/col
   */
  protected getCopyIndex(copyRow: number, copyCol: number, multiplier: number): number {
    return copyRow * multiplier + copyCol;
  }

  /**
   * Helper to create a position key for deduplication
   */
  protected positionKey(copyRow: number, copyCol: number, node: ManifoldNode): string {
    return `${copyRow},${copyCol},${node.row},${node.col}`;
  }
}
