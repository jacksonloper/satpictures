/**
 * OrbifoldLiftViewer component
 *
 * Displays the lifted graph from an orbifold lift operation.
 * Nodes are colored by their root connection, edges show the spanning tree.
 */

import { useMemo, useCallback } from "react";
import type { OrbifoldLiftGraph, LiftedNode, ManifoldNode } from "../manifold/types";
import type { SubManifold } from "../manifold/types";

export interface OrbifoldLiftViewerProps {
  /** The lifted graph to display */
  graph: OrbifoldLiftGraph;
  /** The sub-manifold (for correspondence lookups) */
  subManifold: SubManifold;
  /** Currently selected node ID */
  selectedNodeId: number | null;
  /** Node radius */
  nodeRadius?: number;
  /** Padding around the graph */
  padding?: number;
  /** Callback when a node is clicked */
  onNodeClick?: (node: LiftedNode) => void;
  /** Set of original manifold node keys to highlight */
  highlightedOriginalNodes?: Set<string>;
  /** SVG ref for downloading */
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

/**
 * Golden ratio for evenly spreading colors
 */
const GOLDEN_RATIO = 0.618033988749895;

/**
 * Get a color for a root index
 */
function getRootColor(rootIndex: number): string {
  if (rootIndex < 0) {
    return "#d0d0d0"; // Gray for unconnected
  }
  const hue = ((rootIndex * GOLDEN_RATIO) % 1) * 360;
  const saturation = 65;
  const lightness = 50;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Compute root index for each node using BFS from roots
 */
function computeRootIndices(
  graph: OrbifoldLiftGraph,
  subManifold: SubManifold
): Map<number, number> {
  const rootIndices = new Map<number, number>();
  const manifold = subManifold.manifold;
  const rootNode = subManifold.root;

  if (!rootNode) {
    // No root - all nodes are unconnected
    for (const node of graph.nodes) {
      rootIndices.set(node.id, -1);
    }
    return rootIndices;
  }

  // Find all nodes that correspond to the root
  const rootKey = manifold.nodeKey(rootNode);
  const rootLiftedNodes = graph.nodesByOriginal.get(rootKey) || [];

  // Build adjacency list from edges
  const adjacency = new Map<number, number[]>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, []);
    if (!adjacency.has(edge.toId)) adjacency.set(edge.toId, []);
    adjacency.get(edge.fromId)!.push(edge.toId);
    adjacency.get(edge.toId)!.push(edge.fromId);
  }

  // BFS from each root
  for (let rootIdx = 0; rootIdx < rootLiftedNodes.length; rootIdx++) {
    const startNode = rootLiftedNodes[rootIdx];
    rootIndices.set(startNode.id, rootIdx);

    const visited = new Set<number>([startNode.id]);
    const queue = [startNode.id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacency.get(current) || [];

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          rootIndices.set(neighbor, rootIdx);
          queue.push(neighbor);
        }
      }
    }
  }

  // Mark any unvisited nodes as unconnected
  for (const node of graph.nodes) {
    if (!rootIndices.has(node.id)) {
      rootIndices.set(node.id, -1);
    }
  }

  return rootIndices;
}

/**
 * OrbifoldLiftViewer component
 */
export function OrbifoldLiftViewer({
  graph,
  subManifold,
  selectedNodeId,
  nodeRadius = 5,
  padding = 40,
  onNodeClick,
  highlightedOriginalNodes = new Set(),
  svgRef,
}: OrbifoldLiftViewerProps) {
  const manifold = subManifold.manifold;

  // Compute root indices
  const rootIndices = useMemo(
    () => computeRootIndices(graph, subManifold),
    [graph, subManifold]
  );

  // Handle node click
  const handleClick = useCallback(
    (node: LiftedNode) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  // Calculate dimensions
  const { width, height, offsetX, offsetY } = useMemo(() => {
    const w = graph.bounds.maxX - graph.bounds.minX + padding * 2;
    const h = graph.bounds.maxY - graph.bounds.minY + padding * 2;
    return {
      width: Math.max(w, 100),
      height: Math.max(h, 100),
      offsetX: padding - graph.bounds.minX,
      offsetY: padding - graph.bounds.minY,
    };
  }, [graph.bounds, padding]);

  // Render edges
  const edgeElements = useMemo(() => {
    const elements: React.ReactNode[] = [];

    for (const edge of graph.edges) {
      const fromNode = graph.nodeById.get(edge.fromId);
      const toNode = graph.nodeById.get(edge.toId);
      if (!fromNode || !toNode) continue;

      const x1 = fromNode.x + offsetX;
      const y1 = fromNode.y + offsetY;
      const x2 = toNode.x + offsetX;
      const y2 = toNode.y + offsetY;

      const rootIdx = rootIndices.get(fromNode.id) ?? -1;
      const color = getRootColor(rootIdx);

      elements.push(
        <line
          key={`edge-${edge.fromId}-${edge.toId}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={color}
          strokeWidth={2}
        />
      );
    }

    return elements;
  }, [graph.edges, graph.nodeById, offsetX, offsetY, rootIndices]);

  // Render nodes
  const nodeElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    const root = subManifold.root;

    for (const node of graph.nodes) {
      const x = node.x + offsetX;
      const y = node.y + offsetY;

      const rootIdx = rootIndices.get(node.id) ?? -1;
      const color = getRootColor(rootIdx);

      const isRoot =
        root &&
        node.originalNode.row === root.row &&
        node.originalNode.col === root.col;

      const isSelected = node.id === selectedNodeId;
      const originalKey = manifold.nodeKey(node.originalNode);
      const isHighlighted = highlightedOriginalNodes.has(originalKey);

      elements.push(
        <circle
          key={`node-${node.id}`}
          cx={x}
          cy={y}
          r={isRoot ? nodeRadius * 1.5 : nodeRadius}
          fill={color}
          stroke={isRoot ? "#000" : "none"}
          strokeWidth={isRoot ? 2 : 0}
          style={{ cursor: "pointer" }}
          onClick={() => handleClick(node)}
        />
      );

      // Selection/highlight ring
      if (isSelected || isHighlighted) {
        elements.push(
          <circle
            key={`highlight-${node.id}`}
            cx={x}
            cy={y}
            r={nodeRadius * 2}
            fill="none"
            stroke={isSelected ? "#000" : "#ff00ff"}
            strokeWidth={2}
          />
        );
      }
    }

    return elements;
  }, [
    graph.nodes,
    offsetX,
    offsetY,
    rootIndices,
    subManifold.root,
    selectedNodeId,
    highlightedOriginalNodes,
    nodeRadius,
    handleClick,
    manifold,
  ]);

  // Find selected node for info display
  const selectedNode = selectedNodeId !== null ? graph.nodeById.get(selectedNodeId) : null;

  return (
    <div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ border: "1px solid #ccc" }}
      >
        {edgeElements}
        {nodeElements}
      </svg>
      {selectedNode && (
        <div
          style={{
            marginTop: "10px",
            padding: "10px",
            backgroundColor: "#f5f5f5",
            borderRadius: "4px",
            fontSize: "12px",
          }}
        >
          <strong>Selected Node</strong>
          <br />
          Original: ({selectedNode.originalNode.row}, {selectedNode.originalNode.col})
          <br />
          Copy Index: {selectedNode.copyIndex}
        </div>
      )}
    </div>
  );
}

/**
 * Find the 4 neighbors of a node in the original manifold
 */
export function getOriginalNeighbors(
  node: LiftedNode,
  manifold: SubManifold["manifold"]
): ManifoldNode[] {
  const neighbors = manifold.getNeighbors(node.originalNode);
  return [neighbors.N, neighbors.S, neighbors.E, neighbors.W];
}
