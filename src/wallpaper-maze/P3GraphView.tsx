/**
 * P3 Graph View - renders the tree graph structure for P3 wallpaper group
 */

import type { P3TiledGraph, P3TiledNode } from "./P3TiledGraph";
import { getP3RootColor } from "./P3TiledGraph";
import type { MazeSolution } from "./types";

interface P3GraphViewProps {
  p3TiledGraph: P3TiledGraph;
  solution: MazeSolution;
  length: number;
  multiplier: number;
  cellSize: number;
  p3GraphSelectedNode: P3TiledNode | null;
  onNodeSelect: (node: P3TiledNode | null) => void;
}

export function P3GraphView({
  p3TiledGraph,
  solution,
  length,
  multiplier,
  cellSize,
  p3GraphSelectedNode,
  onNodeSelect,
}: P3GraphViewProps) {
  const dotRadius = 4;
  // Use the SAME padding as the maze view for consistent positioning
  const graphPadding = 60;

  // Use the same dimensions as P3RhombusRenderer
  const SHEAR_X = 0.5;
  const SHEAR_Y = Math.sqrt(3) / 2;
  const rhombusWidth = length * cellSize * (1 + SHEAR_X);
  const rhombusHeight = length * cellSize * SHEAR_Y;
  const totalWidth = (multiplier + 1) * rhombusWidth;
  const totalHeight = (multiplier + 1) * (2 * rhombusHeight);

  const svgWidth = totalWidth + graphPadding * 2;
  const svgHeight = totalHeight + graphPadding * 2;
  // Use the same offset as the maze (just the padding, no bounds-based offset)
  const offsetX = graphPadding;
  const offsetY = graphPadding;

  const dots: React.ReactNode[] = [];
  const edges: React.ReactNode[] = [];
  const highlights: React.ReactNode[] = [];

  // Draw edges (from each node to its parent) - skip edges involving vacant cells
  for (const edge of p3TiledGraph.edges) {
    const fromNode = p3TiledGraph.nodes[edge.fromId];
    const toNode = p3TiledGraph.nodes[edge.toId];

    const fromKey = `${fromNode.fundamentalRow},${fromNode.fundamentalCol}`;
    const toKey = `${toNode.fundamentalRow},${toNode.fundamentalCol}`;
    if (solution.vacantCells.has(fromKey) || solution.vacantCells.has(toKey)) {
      continue;
    }

    const x1 = fromNode.x + offsetX;
    const y1 = fromNode.y + offsetY;
    const x2 = toNode.x + offsetX;
    const y2 = toNode.y + offsetY;

    edges.push(
      <line
        key={`edge-${edge.fromId}-${edge.toId}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={getP3RootColor(fromNode.rootIndex)}
        strokeWidth={2}
      />
    );
  }

  // Draw dots for each node - skip vacant cells
  for (const node of p3TiledGraph.nodes) {
    const cellKey = `${node.fundamentalRow},${node.fundamentalCol}`;
    if (solution.vacantCells.has(cellKey)) {
      continue;
    }

    const cx = node.x + offsetX;
    const cy = node.y + offsetY;

    dots.push(
      <circle
        key={`dot-${node.id}`}
        cx={cx}
        cy={cy}
        r={node.isRoot ? dotRadius * 1.5 : dotRadius}
        fill={getP3RootColor(node.rootIndex)}
        stroke={node.isRoot ? "#000" : "none"}
        strokeWidth={node.isRoot ? 2 : 0}
        style={{ cursor: "pointer" }}
        onClick={() => {
          if (p3GraphSelectedNode?.id === node.id) {
            onNodeSelect(null);
          } else {
            onNodeSelect(node);
          }
        }}
      />
    );
  }

  // Highlight equivalent nodes (same fundamental coordinates)
  if (p3GraphSelectedNode) {
    const equivalentNodes = p3TiledGraph.nodes.filter(
      n => n.fundamentalRow === p3GraphSelectedNode.fundamentalRow &&
           n.fundamentalCol === p3GraphSelectedNode.fundamentalCol
    );

    for (const node of equivalentNodes) {
      const cx = node.x + offsetX;
      const cy = node.y + offsetY;

      highlights.push(
        <circle
          key={`highlight-${node.id}`}
          cx={cx}
          cy={cy}
          r={dotRadius * 2}
          fill="none"
          stroke="#ff00ff"
          strokeWidth={2}
        />
      );
    }
  }

  return (
    <svg width={svgWidth} height={svgHeight}>
      {edges}
      {dots}
      {highlights}
    </svg>
  );
}
