/**
 * SubManifoldViewer component
 *
 * Displays the sub-manifold with all its edges:
 * - Included edges (spanning tree) shown as solid lines
 * - Excluded edges shown as dotted lines (only when a node is selected)
 * - Stubs for edges that wrap to distant coordinates
 * - Edge labels (1), (2), etc. based on edge index in the data structure
 * 
 * IMPORTANT: This viewer uses the explicitly stored edges from the manifold
 * data structure, not hardcoded directions like N/S/E/W.
 */

import { useMemo, useCallback } from "react";
import type { SubManifold, ManifoldNode, ManifoldEdge } from "../manifold/types";

export interface SubManifoldViewerProps {
  /** The sub-manifold to display */
  subManifold: SubManifold;
  /** Currently selected node */
  selectedNode: ManifoldNode | null;
  /** Cell size for rendering */
  cellSize?: number;
  /** Padding around the grid */
  padding?: number;
  /** Callback when a node is clicked */
  onNodeClick?: (node: ManifoldNode) => void;
  /** Set of highlighted node keys (from orbifold lift selection) */
  highlightedNodes?: Set<string>;
  /** Show all edges or just included ones */
  showAllEdges?: boolean;
}

/**
 * Get color for an edge based on whether it's included
 */
function getEdgeColor(isIncluded: boolean): string {
  return isIncluded ? "#2196f3" : "#999";
}

/**
 * Get color for a node based on whether it's blocked
 */
function getNodeColor(isBlocked: boolean, isRoot: boolean): string {
  if (isBlocked) return "#000";
  if (isRoot) return "#ffa726";
  return "#4caf50";
}

/**
 * Determine the visual direction to render an edge from a node
 * This is purely for rendering purposes - determines which quadrant the edge points to
 */
function getEdgeRenderDirection(from: ManifoldNode, to: ManifoldNode): { dx: number; dy: number } {
  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  
  // For wrapping edges (large differences), infer direction from sign
  // For normal edges, use actual difference
  let dx = 0, dy = 0;
  
  if (colDiff > 0 || colDiff < -1) {
    dx = 1; // East or wrapping west->east
  } else if (colDiff < 0 || colDiff > 1) {
    dx = -1; // West or wrapping east->west
  }
  
  if (rowDiff > 0 || rowDiff < -1) {
    dy = 1; // South or wrapping north->south
  } else if (rowDiff < 0 || rowDiff > 1) {
    dy = -1; // North or wrapping south->north
  }
  
  // Handle the normal case where differences are -1, 0, or 1
  if (Math.abs(colDiff) <= 1) dx = colDiff;
  if (Math.abs(rowDiff) <= 1) dy = rowDiff;
  
  return { dx, dy };
}

/**
 * SubManifoldViewer component
 */
export function SubManifoldViewer({
  subManifold,
  selectedNode,
  cellSize = 40,
  padding = 30,
  onNodeClick,
  highlightedNodes = new Set(),
  showAllEdges = true,
}: SubManifoldViewerProps) {
  const { manifold, blockedNodes, root } = subManifold;

  // Handle node click
  const handleClick = useCallback(
    (node: ManifoldNode) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  // Calculate grid size
  const gridSize = manifold.size * cellSize + padding * 2;

  // Classify edges into internal (adjacent coordinates) and wrapping (distant coordinates)
  const { internalEdges, wrappingEdges } = useMemo(() => {
    const internal: Array<{ edge: ManifoldEdge; isIncluded: boolean }> = [];
    const wrapping: Array<{
      edge: ManifoldEdge;
      isIncluded: boolean;
      renderDir: { dx: number; dy: number };
    }> = [];

    for (const edge of manifold.getEdges()) {
      const isIncluded = subManifold.hasEdge(edge);
      if (!showAllEdges && !isIncluded) continue;

      // Check if this is an internal edge or wrapping edge
      const rowDiff = Math.abs(edge.from.row - edge.to.row);
      const colDiff = Math.abs(edge.from.col - edge.to.col);

      // Internal edges have adjacent coordinates
      if (rowDiff <= 1 && colDiff <= 1 && rowDiff + colDiff === 1) {
        internal.push({ edge, isIncluded });
      } else {
        // Wrapping edge - determine render direction from the stored edge data
        const renderDir = getEdgeRenderDirection(edge.from, edge.to);
        wrapping.push({ edge, isIncluded, renderDir });
      }
    }

    return { internalEdges: internal, wrappingEdges: wrapping };
  }, [manifold, subManifold, showAllEdges]);

  // Build index of edges by node key for quick lookup
  const edgesByNodeKey = useMemo(() => {
    const edgeIndex = new Map<string, Array<{ edge: ManifoldEdge; edgeIdx: number; isIncluded: boolean }>>();
    
    const allEdges = manifold.getEdges();
    for (let edgeIdx = 0; edgeIdx < allEdges.length; edgeIdx++) {
      const edge = allEdges[edgeIdx];
      const isIncluded = subManifold.hasEdge(edge);
      
      // Index by both endpoints
      const fromKey = manifold.nodeKey(edge.from);
      const toKey = manifold.nodeKey(edge.to);
      
      if (!edgeIndex.has(fromKey)) edgeIndex.set(fromKey, []);
      if (!edgeIndex.has(toKey)) edgeIndex.set(toKey, []);
      
      edgeIndex.get(fromKey)!.push({ edge, edgeIdx, isIncluded });
      edgeIndex.get(toKey)!.push({ edge, edgeIdx, isIncluded });
    }
    
    return edgeIndex;
  }, [manifold, subManifold]);

  // Get edges for the selected node directly from the stored data structure
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return null;
    
    const nodeKey = manifold.nodeKey(selectedNode);
    const nodeEdges = edgesByNodeKey.get(nodeKey) || [];
    
    // Build result with edge index labels
    const edges: Array<{
      edgeIdx: number;
      label: string;
      edge: ManifoldEdge;
      neighbor: ManifoldNode;
      isIncluded: boolean;
      isWrapping: boolean;
      renderDir: { dx: number; dy: number };
    }> = [];
    
    for (const { edge, edgeIdx, isIncluded } of nodeEdges) {
      // Determine which end is the neighbor
      const neighbor = (edge.from.row === selectedNode.row && edge.from.col === selectedNode.col)
        ? edge.to
        : edge.from;
      
      // Check if wrapping (not adjacent)
      const rowDiff = Math.abs(selectedNode.row - neighbor.row);
      const colDiff = Math.abs(selectedNode.col - neighbor.col);
      const isWrapping = !(rowDiff <= 1 && colDiff <= 1 && rowDiff + colDiff === 1);
      
      // Get render direction from selected node to neighbor
      const renderDir = getEdgeRenderDirection(selectedNode, neighbor);
      
      edges.push({
        edgeIdx,
        label: `(${edgeIdx + 1})`, // 1-indexed label based on edge index
        edge,
        neighbor,
        isIncluded,
        isWrapping,
        renderDir,
      });
    }
    
    return edges;
  }, [selectedNode, manifold, edgesByNodeKey]);

  // Render edges - only show non-selected edges normally, selected edges are highlighted separately
  const edgeElements = useMemo(() => {
    const elements: React.ReactNode[] = [];

    // When a node is selected, we'll render its edges separately with labels
    // So we need to filter them out here
    const selectedNodeKey = selectedNode ? manifold.nodeKey(selectedNode) : null;

    // Internal edges as lines
    for (const { edge, isIncluded } of internalEdges) {
      // Skip edges connected to selected node (they'll be rendered with labels)
      const fromKey = manifold.nodeKey(edge.from);
      const toKey = manifold.nodeKey(edge.to);
      if (selectedNodeKey && (fromKey === selectedNodeKey || toKey === selectedNodeKey)) {
        continue;
      }

      const x1 = padding + edge.from.col * cellSize + cellSize / 2;
      const y1 = padding + edge.from.row * cellSize + cellSize / 2;
      const x2 = padding + edge.to.col * cellSize + cellSize / 2;
      const y2 = padding + edge.to.row * cellSize + cellSize / 2;

      elements.push(
        <line
          key={`edge-${manifold.edgeKey(edge)}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={getEdgeColor(isIncluded)}
          strokeWidth={isIncluded ? 3 : 1}
          strokeLinecap="round"
          strokeDasharray={isIncluded ? undefined : "4,2"}
        />
      );
    }

    // Wrapping edges as stubs
    const stubLength = cellSize * 0.3;
    for (const { edge, isIncluded, renderDir } of wrappingEdges) {
      // Skip edges connected to selected node (they'll be rendered with labels)
      const fromKey = manifold.nodeKey(edge.from);
      const toKey = manifold.nodeKey(edge.to);
      if (selectedNodeKey && (fromKey === selectedNodeKey || toKey === selectedNodeKey)) {
        continue;
      }

      const x = padding + edge.from.col * cellSize + cellSize / 2;
      const y = padding + edge.from.row * cellSize + cellSize / 2;

      // Use render direction from stored edge data
      const dx = renderDir.dx * stubLength;
      const dy = renderDir.dy * stubLength;

      elements.push(
        <line
          key={`stub-${manifold.edgeKey(edge)}-from`}
          x1={x}
          y1={y}
          x2={x + dx}
          y2={y + dy}
          stroke={getEdgeColor(isIncluded)}
          strokeWidth={isIncluded ? 3 : 1}
          strokeLinecap="round"
          strokeDasharray={isIncluded ? undefined : "4,2"}
        />
      );

      // Draw stub at the other end too
      const x2 = padding + edge.to.col * cellSize + cellSize / 2;
      const y2 = padding + edge.to.row * cellSize + cellSize / 2;

      // Reverse direction for the other end
      const dx2 = -dx;
      const dy2 = -dy;

      elements.push(
        <line
          key={`stub-${manifold.edgeKey(edge)}-to`}
          x1={x2}
          y1={y2}
          x2={x2 + dx2}
          y2={y2 + dy2}
          stroke={getEdgeColor(isIncluded)}
          strokeWidth={isIncluded ? 3 : 1}
          strokeLinecap="round"
          strokeDasharray={isIncluded ? undefined : "4,2"}
        />
      );
    }

    return elements;
  }, [internalEdges, wrappingEdges, manifold, cellSize, padding, selectedNode]);

  // Render selected node's edges with labels (using data from stored edges)
  const selectedEdgeElements = useMemo(() => {
    if (!selectedNode || !selectedNodeEdges) return null;
    
    const elements: React.ReactNode[] = [];
    const x = padding + selectedNode.col * cellSize + cellSize / 2;
    const y = padding + selectedNode.row * cellSize + cellSize / 2;
    const stubLength = cellSize * 0.35;
    const labelOffset = cellSize * 0.5;
    
    for (const { edgeIdx, label, neighbor, isIncluded, isWrapping, renderDir } of selectedNodeEdges) {
      // Skip edges to blocked nodes
      if (blockedNodes.has(manifold.nodeKey(neighbor))) {
        continue;
      }
      
      // Use render direction from stored edge data
      const dx = renderDir.dx;
      const dy = renderDir.dy;
      
      const edgeColor = isIncluded ? "#e91e63" : "#999"; // Pink for included, gray for excluded
      const strokeDash = isIncluded ? undefined : "4,2";
      
      if (isWrapping) {
        // Draw stub for wrapping edge
        elements.push(
          <line
            key={`selected-edge-${edgeIdx}`}
            x1={x}
            y1={y}
            x2={x + dx * stubLength}
            y2={y + dy * stubLength}
            stroke={edgeColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={strokeDash}
          />
        );
      } else {
        // Draw full edge to neighbor
        const nx = padding + neighbor.col * cellSize + cellSize / 2;
        const ny = padding + neighbor.row * cellSize + cellSize / 2;
        elements.push(
          <line
            key={`selected-edge-${edgeIdx}`}
            x1={x}
            y1={y}
            x2={nx}
            y2={ny}
            stroke={edgeColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={strokeDash}
          />
        );
      }
      
      // Draw label (using edge index from data structure)
      const labelX = x + dx * labelOffset;
      const labelY = y + dy * labelOffset;
      elements.push(
        <text
          key={`label-${edgeIdx}`}
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={12}
          fontWeight="bold"
          fill="#333"
        >
          {label}
        </text>
      );
    }
    
    return elements;
  }, [selectedNode, selectedNodeEdges, manifold, blockedNodes, cellSize, padding]);

  // Render nodes
  const nodeElements = useMemo(() => {
    const elements: React.ReactNode[] = [];

    for (const node of manifold.getNodes()) {
      const nodeKey = manifold.nodeKey(node);
      const x = padding + node.col * cellSize + cellSize / 2;
      const y = padding + node.row * cellSize + cellSize / 2;

      const isBlocked = blockedNodes.has(nodeKey);
      const isRoot = root && root.row === node.row && root.col === node.col;
      const isSelected =
        selectedNode &&
        selectedNode.row === node.row &&
        selectedNode.col === node.col;
      const isHighlighted = highlightedNodes.has(nodeKey);

      // Skip blocked nodes
      if (isBlocked) continue;

      const nodeRadius = cellSize / 5;

      elements.push(
        <circle
          key={`node-${nodeKey}`}
          cx={x}
          cy={y}
          r={isRoot ? nodeRadius * 1.3 : nodeRadius}
          fill={getNodeColor(isBlocked, !!isRoot)}
          stroke={isRoot ? "#000" : "none"}
          strokeWidth={isRoot ? 2 : 0}
          style={{ cursor: "pointer" }}
          onClick={() => handleClick(node)}
        />
      );

      // Selected highlight
      if (isSelected || isHighlighted) {
        elements.push(
          <circle
            key={`highlight-${nodeKey}`}
            cx={x}
            cy={y}
            r={nodeRadius * 1.8}
            fill="none"
            stroke={isSelected ? "#000" : "#ff00ff"}
            strokeWidth={2}
          />
        );
      }
    }

    return elements;
  }, [
    manifold,
    blockedNodes,
    root,
    selectedNode,
    highlightedNodes,
    cellSize,
    padding,
    handleClick,
  ]);

  return (
    <svg width={gridSize} height={gridSize} style={{ border: "1px solid #ccc" }}>
      {/* Background edges first */}
      {edgeElements}
      {/* Selected node edges with labels (on top of regular edges) */}
      {selectedEdgeElements}
      {/* Nodes on top of everything */}
      {nodeElements}
    </svg>
  );
}
