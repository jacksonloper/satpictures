/**
 * Base class for Manifold implementations
 *
 * Provides common functionality for all manifold types.
 */

import type { Manifold, ManifoldNode, ManifoldEdge, ManifoldType } from "./types";

/**
 * Abstract base class for Manifold implementations
 */
export abstract class BaseManifold implements Manifold {
  abstract readonly type: ManifoldType;
  readonly size: number;

  protected _nodes: ManifoldNode[] | null = null;
  protected _edges: ManifoldEdge[] | null = null;
  protected _edgeSet: Set<string> | null = null;

  constructor(size: number) {
    if (size < 1) {
      throw new Error("Manifold size must be at least 1");
    }
    this.size = size;
  }

  /**
   * Create a unique key for a node
   */
  nodeKey(node: ManifoldNode): string {
    return `${node.row},${node.col}`;
  }

  /**
   * Create a unique key for an edge (order-independent)
   */
  edgeKey(edge: ManifoldEdge): string {
    const fromKey = this.nodeKey(edge.from);
    const toKey = this.nodeKey(edge.to);
    // Sort for consistent ordering
    return fromKey < toKey ? `${fromKey}-${toKey}` : `${toKey}-${fromKey}`;
  }

  /**
   * Get all nodes in the manifold
   * Default implementation: size × size grid
   */
  getNodes(): ManifoldNode[] {
    if (this._nodes === null) {
      this._nodes = [];
      for (let row = 0; row < this.size; row++) {
        for (let col = 0; col < this.size; col++) {
          this._nodes.push({ row, col });
        }
      }
    }
    return this._nodes;
  }

  /**
   * Get neighbors based on manifold topology
   * Must be implemented by subclasses
   */
  abstract getNeighbors(
    node: ManifoldNode
  ): { N: ManifoldNode; S: ManifoldNode; E: ManifoldNode; W: ManifoldNode };

  /**
   * Get all edges in the manifold
   * Uses getNeighbors to build edge list (deduplicates automatically)
   */
  getEdges(): ManifoldEdge[] {
    if (this._edges === null) {
      this._edges = [];
      const seen = new Set<string>();

      for (const node of this.getNodes()) {
        const neighbors = this.getNeighbors(node);
        for (const neighbor of [neighbors.N, neighbors.S, neighbors.E, neighbors.W]) {
          const edge: ManifoldEdge = { from: node, to: neighbor };
          const key = this.edgeKey(edge);
          if (!seen.has(key)) {
            seen.add(key);
            this._edges.push(edge);
          }
        }
      }
    }
    return this._edges;
  }

  /**
   * Check if an edge exists between two nodes
   */
  hasEdge(from: ManifoldNode, to: ManifoldNode): boolean {
    if (this._edgeSet === null) {
      this._edgeSet = new Set(this.getEdges().map((e) => this.edgeKey(e)));
    }
    return this._edgeSet.has(this.edgeKey({ from, to }));
  }
}
