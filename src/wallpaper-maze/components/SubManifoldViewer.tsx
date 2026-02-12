/**
 * SubManifoldViewer component
 *
 * Displays the sub-manifold with all its edges:
 * - Included edges (spanning tree) shown as solid lines
 * - Stubs for edges that wrap to distant coordinates
 * - Self-edges displayed appropriately
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
  return isIncluded ? "#2196f3" : "#e0e0e0";
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

  // Classify edges into internal and wrapping
  const { internalEdges, wrappingEdges } = useMemo(() => {
    const internal: Array<{ edge: ManifoldEdge; isIncluded: boolean }> = [];
    const wrapping: Array<{
      edge: ManifoldEdge;
      isIncluded: boolean;
      fromDir: "N" | "S" | "E" | "W";
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
        // Wrapping edge - determine direction from 'from' node
        let fromDir: "N" | "S" | "E" | "W" = "N";
        const neighbors = manifold.getNeighbors(edge.from);
        if (
          neighbors.N.row === edge.to.row &&
          neighbors.N.col === edge.to.col
        ) {
          fromDir = "N";
        } else if (
          neighbors.S.row === edge.to.row &&
          neighbors.S.col === edge.to.col
        ) {
          fromDir = "S";
        } else if (
          neighbors.E.row === edge.to.row &&
          neighbors.E.col === edge.to.col
        ) {
          fromDir = "E";
        } else if (
          neighbors.W.row === edge.to.row &&
          neighbors.W.col === edge.to.col
        ) {
          fromDir = "W";
        }

        wrapping.push({ edge, isIncluded, fromDir });
      }
    }

    return { internalEdges: internal, wrappingEdges: wrapping };
  }, [manifold, subManifold, showAllEdges]);

  // Render edges
  const edgeElements = useMemo(() => {
    const elements: React.ReactNode[] = [];

    // Internal edges as lines
    for (const { edge, isIncluded } of internalEdges) {
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
        />
      );
    }

    // Wrapping edges as stubs
    const stubLength = cellSize * 0.3;
    for (const { edge, isIncluded, fromDir } of wrappingEdges) {
      const x = padding + edge.from.col * cellSize + cellSize / 2;
      const y = padding + edge.from.row * cellSize + cellSize / 2;

      let dx = 0,
        dy = 0;
      switch (fromDir) {
        case "N":
          dy = -stubLength;
          break;
        case "S":
          dy = stubLength;
          break;
        case "E":
          dx = stubLength;
          break;
        case "W":
          dx = -stubLength;
          break;
      }

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
          strokeDasharray={isIncluded ? "none" : "4,2"}
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
          strokeDasharray={isIncluded ? "none" : "4,2"}
        />
      );
    }

    return elements;
  }, [internalEdges, wrappingEdges, manifold, cellSize, padding]);

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
      {/* Edges first, then nodes on top */}
      {edgeElements}
      {nodeElements}
    </svg>
  );
}
