/**
 * SubManifoldImpl - Implementation of SubManifold
 *
 * A SubManifold represents a Manifold with a subset of edges included
 * (e.g., a spanning tree) and some nodes blocked.
 */

import type {
  Manifold,
  SubManifold,
  ManifoldNode,
  ManifoldEdge,
} from "./types";

/**
 * Implementation of SubManifold
 */
export class SubManifoldImpl implements SubManifold {
  readonly manifold: Manifold;
  readonly includedEdges: Set<string>;
  readonly blockedNodes: Set<string>;
  readonly root: ManifoldNode | null;

  /** Parent relationships for spanning tree traversal */
  private _parentMap: Map<string, ManifoldNode | null> | null = null;

  constructor(
    manifold: Manifold,
    options?: {
      includedEdges?: Set<string>;
      blockedNodes?: Set<string>;
      root?: ManifoldNode | null;
      parentMap?: Map<string, ManifoldNode | null>;
    }
  ) {
    this.manifold = manifold;
    this.includedEdges = options?.includedEdges ?? new Set();
    this.blockedNodes = options?.blockedNodes ?? new Set();
    this.root = options?.root ?? null;
    this._parentMap = options?.parentMap ?? null;
  }

  /**
   * Check if a specific edge is included in this sub-manifold
   */
  hasEdge(edge: ManifoldEdge): boolean {
    return this.includedEdges.has(this.manifold.edgeKey(edge));
  }

  /**
   * Check if a node is blocked
   */
  isBlocked(node: ManifoldNode): boolean {
    return this.blockedNodes.has(this.manifold.nodeKey(node));
  }

  /**
   * Get all active (non-blocked) nodes
   */
  getActiveNodes(): ManifoldNode[] {
    return this.manifold
      .getNodes()
      .filter((node) => !this.isBlocked(node));
  }

  /**
   * Get all included edges
   */
  getIncludedEdges(): ManifoldEdge[] {
    return this.manifold
      .getEdges()
      .filter((edge) => this.hasEdge(edge));
  }

  /**
   * Get the parent of a node in the spanning tree
   */
  getParent(node: ManifoldNode): ManifoldNode | null {
    if (this._parentMap === null) {
      return null;
    }
    return this._parentMap.get(this.manifold.nodeKey(node)) ?? null;
  }

  /**
   * Set parent relationships (from solution)
   */
  setParentMap(parentMap: Map<string, ManifoldNode | null>): void {
    this._parentMap = parentMap;
  }

  /**
   * Create a new SubManifold with additional blocked nodes
   */
  withBlockedNode(node: ManifoldNode): SubManifoldImpl {
    const newBlocked = new Set(this.blockedNodes);
    newBlocked.add(this.manifold.nodeKey(node));
    return new SubManifoldImpl(this.manifold, {
      includedEdges: this.includedEdges,
      blockedNodes: newBlocked,
      root: this.root,
      parentMap: this._parentMap ?? undefined,
    });
  }

  /**
   * Create a new SubManifold with a node unblocked
   */
  withUnblockedNode(node: ManifoldNode): SubManifoldImpl {
    const newBlocked = new Set(this.blockedNodes);
    newBlocked.delete(this.manifold.nodeKey(node));
    return new SubManifoldImpl(this.manifold, {
      includedEdges: this.includedEdges,
      blockedNodes: newBlocked,
      root: this.root,
      parentMap: this._parentMap ?? undefined,
    });
  }

  /**
   * Create a new SubManifold with a different root
   */
  withRoot(root: ManifoldNode): SubManifoldImpl {
    return new SubManifoldImpl(this.manifold, {
      includedEdges: this.includedEdges,
      blockedNodes: this.blockedNodes,
      root,
      parentMap: this._parentMap ?? undefined,
    });
  }

  /**
   * Create a new SubManifold with included edges
   */
  withIncludedEdges(edges: Set<string>): SubManifoldImpl {
    return new SubManifoldImpl(this.manifold, {
      includedEdges: edges,
      blockedNodes: this.blockedNodes,
      root: this.root,
      parentMap: this._parentMap ?? undefined,
    });
  }

  /**
   * Create a SubManifold from a parent map (spanning tree solution)
   */
  static fromParentMap(
    manifold: Manifold,
    parentMap: Map<string, ManifoldNode | null>,
    blockedNodes: Set<string> = new Set(),
    root: ManifoldNode | null = null
  ): SubManifoldImpl {
    // Build included edges from parent relationships
    const includedEdges = new Set<string>();

    for (const [nodeKey, parent] of parentMap) {
      if (parent !== null) {
        // Parse node key to get coordinates
        const [row, col] = nodeKey.split(",").map(Number);
        const node = { row, col };
        const edge: ManifoldEdge = { from: node, to: parent };
        includedEdges.add(manifold.edgeKey(edge));
      }
    }

    return new SubManifoldImpl(manifold, {
      includedEdges,
      blockedNodes,
      root,
      parentMap,
    });
  }
}
