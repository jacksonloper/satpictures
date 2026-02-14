/**
 * Spanning tree utilities for orbifold graphs.
 * 
 * Provides functions for generating random spanning trees on orbifold grids,
 * used for maze generation in wallpaper patterns.
 */

import type {
  ColorData,
  EdgeStyleData,
  EdgeLinestyle,
} from "./createOrbifolds";
import type {
  OrbifoldGrid,
  OrbifoldNodeId,
  OrbifoldEdgeId,
} from "./orbifoldbasics";

type WeightedEdge = {
  source: OrbifoldNodeId;
  target: OrbifoldNodeId;
  weight: number;
};

function buildSpanningTreeEdgeSet(
  nodeIds: Set<OrbifoldNodeId>,
  edges: WeightedEdge[]
): Set<string> | null {
  const parent = new Map<OrbifoldNodeId, OrbifoldNodeId>();
  const rank = new Map<OrbifoldNodeId, number>();

  for (const nodeId of nodeIds) {
    parent.set(nodeId, nodeId);
    rank.set(nodeId, 0);
  }

  const find = (nodeId: OrbifoldNodeId): OrbifoldNodeId => {
    const current = parent.get(nodeId);
    if (!current) {
      return nodeId;
    }
    if (current !== nodeId) {
      const root = find(current);
      parent.set(nodeId, root);
      return root;
    }
    return current;
  };

  const union = (left: OrbifoldNodeId, right: OrbifoldNodeId): boolean => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      return false;
    }
    const leftRank = rank.get(leftRoot) ?? 0;
    const rightRank = rank.get(rightRoot) ?? 0;
    if (leftRank < rightRank) {
      parent.set(leftRoot, rightRoot);
    } else if (leftRank > rightRank) {
      parent.set(rightRoot, leftRoot);
    } else {
      parent.set(rightRoot, leftRoot);
      rank.set(leftRoot, leftRank + 1);
    }
    return true;
  };

  const sortedEdges = [...edges].sort((a, b) => a.weight - b.weight);
  const edgeSet = new Set<string>();
  let edgesAdded = 0;

  for (const edge of sortedEdges) {
    if (union(edge.source, edge.target)) {
      const s = String(edge.source);
      const t = String(edge.target);
      edgeSet.add(s < t ? `${s}-${t}` : `${t}-${s}`);
      edgesAdded += 1;
      if (edgesAdded === nodeIds.size - 1) {
        break;
      }
    }
  }

  if (edgesAdded !== nodeIds.size - 1) {
    return null;
  }

  return edgeSet;
}

/**
 * Constructs a random spanning tree of the white orbifold nodes using Kruskal's algorithm
 * with random weights. Sets edges in the tree as solid and edges not in the tree as dashed.
 * 
 * For orbifolds with multi-edges (multiple edges connecting the same pair of nodes),
 * exactly one edge is randomly selected for each spanning tree edge.
 * 
 * @param grid - The orbifold grid to modify (edges will be updated in place)
 * @returns A new grid with updated edge linestyles
 */
export function applyRandomSpanningTreeToWhiteNodes(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>
): OrbifoldGrid<ColorData, EdgeStyleData> {
  // Get all white nodes
  const whiteNodeIds = new Set<OrbifoldNodeId>();
  for (const [nodeId, node] of grid.nodes) {
    if (node.data?.color === "white") {
      whiteNodeIds.add(nodeId);
    }
  }

  // If we have 0 or 1 white nodes, nothing to do
  if (whiteNodeIds.size < 2) {
    // Just set all edges to dashed (no spanning tree possible)
    const newEdges = new Map(grid.edges);
    for (const [edgeId, edge] of newEdges) {
      newEdges.set(edgeId, { ...edge, data: { linestyle: "dashed" } });
    }
    return { nodes: grid.nodes, edges: newEdges, adjacency: grid.adjacency };
  }

  // Find edges that connect two white nodes
  const edgesBetweenWhiteNodes: OrbifoldEdgeId[] = [];
  for (const [edgeId, edge] of grid.edges) {
    // Get the two endpoint node IDs from the half-edges
    const endpoints = Array.from(edge.halfEdges.keys());
    const bothEndpointsWhite = endpoints.every(nodeId => whiteNodeIds.has(nodeId));
    
    if (bothEndpointsWhite) {
      edgesBetweenWhiteNodes.push(edgeId);
    }
  }

  // Track edges we've already added to avoid duplicates (parallel edges)
  const addedEdgePairs = new Set<string>();
  
  // Group orbifold edges by their normalized edge pair key (for later random selection)
  // Key: "nodeA-nodeB" (sorted), Value: array of orbifold edge IDs connecting those nodes
  const edgePairToOrbifoldEdges = new Map<string, OrbifoldEdgeId[]>();

  const weightedEdges: WeightedEdge[] = [];
  
  // Add edges with random weights
  for (const edgeId of edgesBetweenWhiteNodes) {
    const edge = grid.edges.get(edgeId)!;
    const endpoints = Array.from(edge.halfEdges.keys());
    const [source, target] = endpoints.length === 1 
      ? [endpoints[0], endpoints[0]]  // Self-loop
      : endpoints;
    
    // Skip self-loops - they can't be part of a spanning tree
    if (source === target) {
      continue;
    }
    
    // Create normalized edge pair key
    const edgePairKey = source < target ? `${source}-${target}` : `${target}-${source}`;
    
    // Add this orbifold edge to the group for this node pair
    if (!edgePairToOrbifoldEdges.has(edgePairKey)) {
      edgePairToOrbifoldEdges.set(edgePairKey, []);
    }
    edgePairToOrbifoldEdges.get(edgePairKey)!.push(edgeId);
    
    // Only add to Kruskal graph if we haven't seen this node pair yet
    if (!addedEdgePairs.has(edgePairKey)) {
      addedEdgePairs.add(edgePairKey);
      const randomWeight = Math.random();
      weightedEdges.push({ source, target, weight: randomWeight });
    }
  }

  // Run Kruskal's algorithm to get the minimum spanning tree (with random weights = random tree)
  const spanningTreeEdgeSet = buildSpanningTreeEdgeSet(whiteNodeIds, weightedEdges);
  if (!spanningTreeEdgeSet) {
    // Graph is not connected - just set all edges to dashed
    const newEdges = new Map(grid.edges);
    for (const [edgeId, edge] of newEdges) {
      newEdges.set(edgeId, { ...edge, data: { linestyle: "dashed" } });
    }
    return { nodes: grid.nodes, edges: newEdges, adjacency: grid.adjacency };
  }

  // For each spanning tree edge, randomly select exactly ONE orbifold edge to mark as solid
  const selectedOrbifoldEdges = new Set<OrbifoldEdgeId>();
  for (const edgePairKey of spanningTreeEdgeSet) {
    const orbifoldEdgesForPair = edgePairToOrbifoldEdges.get(edgePairKey);
    if (orbifoldEdgesForPair && orbifoldEdgesForPair.length > 0) {
      // Randomly select exactly one orbifold edge from this group
      const randomIndex = Math.floor(Math.random() * orbifoldEdgesForPair.length);
      selectedOrbifoldEdges.add(orbifoldEdgesForPair[randomIndex]);
    }
  }

  // Update edge linestyles: solid only if selected, dashed otherwise
  const newEdges = new Map(grid.edges);
  for (const [edgeId, edge] of newEdges) {
    const linestyle: EdgeLinestyle = selectedOrbifoldEdges.has(edgeId) ? "solid" : "dashed";
    newEdges.set(edgeId, { ...edge, data: { linestyle } });
  }

  return { nodes: grid.nodes, edges: newEdges, adjacency: grid.adjacency };
}
