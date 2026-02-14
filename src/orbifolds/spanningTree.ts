/**
 * Spanning tree utilities for orbifold graphs.
 * 
 * Provides functions for generating random spanning trees on orbifold grids,
 * used for maze generation in wallpaper patterns.
 */

import { Graph, kruskalMST } from "@graphty/algorithms";
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

  // Build a graph for Kruskal's algorithm using @graphty/algorithms
  const kruskalGraph = new Graph({ directed: false });
  
  // Add white nodes
  for (const nodeId of whiteNodeIds) {
    kruskalGraph.addNode(nodeId);
  }
  
  // Track edges we've already added to avoid duplicates (parallel edges)
  const addedEdgePairs = new Set<string>();
  
  // Group orbifold edges by their normalized edge pair key (for later random selection)
  // Key: "nodeA-nodeB" (sorted), Value: array of orbifold edge IDs connecting those nodes
  const edgePairToOrbifoldEdges = new Map<string, OrbifoldEdgeId[]>();
  
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
      kruskalGraph.addEdge(source, target, randomWeight);
    }
  }

  // Run Kruskal's algorithm to get the minimum spanning tree (with random weights = random tree)
  let spanningTreeEdgeSet: Set<string>;
  try {
    const mstResult = kruskalMST(kruskalGraph);
    // Create a set of edges in the spanning tree (as "source-target" strings, sorted)
    spanningTreeEdgeSet = new Set(
      mstResult.edges.map(e => {
        const s = String(e.source);
        const t = String(e.target);
        return s < t ? `${s}-${t}` : `${t}-${s}`;
      })
    );
  } catch {
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
