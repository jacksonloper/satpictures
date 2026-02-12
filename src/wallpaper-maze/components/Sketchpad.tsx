/**
 * Sketchpad component for blocking nodes in the manifold
 *
 * Allows users to:
 * - Set the root node
 * - Block/unblock nodes
 * - View neighborhood relationships
 */

import { useMemo, useCallback } from "react";
import type { Manifold, ManifoldNode } from "../manifold/types";

export interface SketchpadProps {
  /** The manifold to display */
  manifold: Manifold;
  /** Currently blocked nodes (set of node keys) */
  blockedNodes: Set<string>;
  /** The root node */
  root: ManifoldNode | null;
  /** Currently selected node for neighborhood viewing */
  selectedNode: ManifoldNode | null;
  /** Active tool */
  activeTool: "rootSetter" | "neighborhoodViewer" | "blockSetter";
  /** Cell size for rendering */
  cellSize?: number;
  /** Padding around the grid */
  padding?: number;
  /** Callback when a node is clicked */
  onNodeClick?: (node: ManifoldNode) => void;
}

/**
 * Sketchpad component for editing the sub-manifold
 */
export function Sketchpad({
  manifold,
  blockedNodes,
  root,
  selectedNode,
  activeTool,
  cellSize = 40,
  padding = 20,
  onNodeClick,
}: SketchpadProps) {
  // Get neighbor keys for highlighting
  const neighborKeys = useMemo(() => {
    if (activeTool !== "neighborhoodViewer" || !selectedNode) {
      return new Set<string>();
    }
    const neighbors = manifold.getNeighbors(selectedNode);
    return new Set([
      manifold.nodeKey(neighbors.N),
      manifold.nodeKey(neighbors.S),
      manifold.nodeKey(neighbors.E),
      manifold.nodeKey(neighbors.W),
    ]);
  }, [activeTool, selectedNode, manifold]);

  // Handle node click
  const handleClick = useCallback(
    (node: ManifoldNode) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  // Calculate grid size
  const gridSize = manifold.size * cellSize + padding * 2;

  // Render nodes
  const cells = useMemo(() => {
    const elements: React.ReactNode[] = [];

    for (const node of manifold.getNodes()) {
      const nodeKey = manifold.nodeKey(node);
      const x = padding + node.col * cellSize;
      const y = padding + node.row * cellSize;

      const isBlocked = blockedNodes.has(nodeKey);
      const isRoot = root && root.row === node.row && root.col === node.col;
      const isSelected =
        activeTool === "neighborhoodViewer" &&
        selectedNode &&
        selectedNode.row === node.row &&
        selectedNode.col === node.col;
      const isNeighbor = neighborKeys.has(nodeKey);

      // Determine fill color
      let fillColor = "#e0e0e0";
      if (isBlocked) {
        fillColor = "#000";
      } else if (isRoot) {
        fillColor = "#ffa726";
      }

      elements.push(
        <rect
          key={`cell-${nodeKey}`}
          x={x}
          y={y}
          width={cellSize}
          height={cellSize}
          fill={fillColor}
          stroke="#ccc"
          strokeWidth={1}
          style={{ cursor: "pointer" }}
          onClick={() => handleClick(node)}
        />
      );

      // Selected highlight
      if (isSelected) {
        elements.push(
          <rect
            key={`selected-${nodeKey}`}
            x={x + 2}
            y={y + 2}
            width={cellSize - 4}
            height={cellSize - 4}
            fill="none"
            stroke="#000"
            strokeWidth={3}
          />
        );
      }

      // Neighbor highlight
      if (isNeighbor && !isSelected) {
        elements.push(
          <rect
            key={`neighbor-${nodeKey}`}
            x={x + 2}
            y={y + 2}
            width={cellSize - 4}
            height={cellSize - 4}
            fill="none"
            stroke="#ff4081"
            strokeWidth={3}
            strokeDasharray="4,2"
          />
        );
      }

      // Root indicator
      if (isRoot && !isBlocked) {
        elements.push(
          <circle
            key={`root-${nodeKey}`}
            cx={x + cellSize / 2}
            cy={y + cellSize / 2}
            r={cellSize / 6}
            fill="#000"
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
    activeTool,
    neighborKeys,
    cellSize,
    padding,
    handleClick,
  ]);

  return (
    <svg width={gridSize} height={gridSize}>
      {cells}
    </svg>
  );
}
