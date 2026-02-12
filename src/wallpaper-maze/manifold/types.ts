/**
 * Core type definitions for the Manifold system
 *
 * A Manifold is a graph with integer coordinate nodes and edges between them.
 * A SubManifold is a Manifold with a subset of edges (e.g., a spanning tree).
 * An OrbifoldLift takes a SubManifold and produces a larger graph.
 */

/**
 * A node in the manifold, identified by integer coordinates
 */
export interface ManifoldNode {
  /** Row coordinate (integer) */
  row: number;
  /** Column coordinate (integer) */
  col: number;
}

/**
 * An edge in the manifold, connecting two nodes
 * Note: May include self-edges in certain manifold types
 */
export interface ManifoldEdge {
  /** First node */
  from: ManifoldNode;
  /** Second node */
  to: ManifoldNode;
}

/**
 * Manifold type identifiers
 * Note: P4 is not included because the P4 manifold is the same as P3
 */
export type ManifoldType = "P1" | "P2" | "P3" | "PGG";

/**
 * A Manifold is a graph with nodes at integer coordinates and edges between them.
 * Each manifold type has specific wrapping/symmetry rules.
 */
export interface Manifold {
  /** The type of manifold */
  readonly type: ManifoldType;

  /** The size parameter (usually results in n² nodes) */
  readonly size: number;

  /** Get all nodes in the manifold */
  getNodes(): ManifoldNode[];

  /** Get all edges in the manifold (including self-edges if applicable) */
  getEdges(): ManifoldEdge[];

  /**
   * Get the neighbors of a node in all four directions
   * Returns the wrapped neighbor coordinates based on manifold topology
   */
  getNeighbors(
    node: ManifoldNode
  ): { N: ManifoldNode; S: ManifoldNode; E: ManifoldNode; W: ManifoldNode };

  /**
   * Check if an edge exists between two nodes
   */
  hasEdge(from: ManifoldNode, to: ManifoldNode): boolean;

  /**
   * Create a unique key for a node (for use in Maps/Sets)
   */
  nodeKey(node: ManifoldNode): string;

  /**
   * Create a unique key for an edge (order-independent)
   */
  edgeKey(edge: ManifoldEdge): string;
}

/**
 * A SubManifold is a Manifold together with a subset of its edges.
 * Typically used to represent a spanning tree or partial solution.
 */
export interface SubManifold {
  /** The underlying manifold */
  readonly manifold: Manifold;

  /** Set of edge keys that are included in this sub-manifold */
  readonly includedEdges: Set<string>;

  /** Set of node keys that are blocked/vacant */
  readonly blockedNodes: Set<string>;

  /** The root node (for spanning trees) */
  readonly root: ManifoldNode | null;

  /**
   * Check if a specific edge is included in this sub-manifold
   */
  hasEdge(edge: ManifoldEdge): boolean;

  /**
   * Check if a node is blocked
   */
  isBlocked(node: ManifoldNode): boolean;

  /**
   * Get all active (non-blocked) nodes
   */
  getActiveNodes(): ManifoldNode[];

  /**
   * Get all included edges
   */
  getIncludedEdges(): ManifoldEdge[];

  /**
   * Get the parent of a node in the spanning tree (if this is a spanning tree)
   */
  getParent(node: ManifoldNode): ManifoldNode | null;
}

/**
 * A node in the lifted graph, with 2D position for rendering
 */
export interface LiftedNode {
  /** Unique ID */
  id: number;

  /** Visual position (may be non-integer) */
  x: number;
  y: number;

  /** Reference to the original manifold node */
  originalNode: ManifoldNode;

  /** Which copy this node belongs to (for tiled patterns) */
  copyIndex: number;
}

/**
 * An edge in the lifted graph
 */
export interface LiftedEdge {
  /** Source node ID */
  fromId: number;
  /** Target node ID */
  toId: number;

  /** Reference to the original manifold edge */
  originalEdge: ManifoldEdge;
}

/**
 * The result of an orbifold lift operation
 */
export interface OrbifoldLiftGraph {
  /** All nodes in the lifted graph */
  nodes: LiftedNode[];

  /** All edges in the lifted graph */
  edges: LiftedEdge[];

  /** Map from node ID to node for quick lookup */
  nodeById: Map<number, LiftedNode>;

  /** Map from original manifold node key to lifted nodes */
  nodesByOriginal: Map<string, LiftedNode[]>;

  /** Map from original manifold edge key to lifted edges */
  edgesByOriginal: Map<string, LiftedEdge[]>;

  /** Bounding box for rendering */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * An OrbifoldLift takes a SubManifold and produces a larger graph
 * formed by many copies of the SubManifold.
 */
export interface OrbifoldLift {
  /** The type identifier for this orbifold lift */
  readonly type: string;

  /** Supported manifold types for this lift */
  readonly supportedManifolds: ManifoldType[];

  /**
   * Check if this lift supports the given manifold type
   */
  supports(manifoldType: ManifoldType): boolean;

  /**
   * Perform the lift operation
   * @param subManifold The sub-manifold to lift
   * @param multiplier How many times to copy (squared)
   * @param cellSize Size of each cell for positioning
   */
  lift(
    subManifold: SubManifold,
    multiplier: number,
    cellSize: number
  ): OrbifoldLiftGraph;
}
