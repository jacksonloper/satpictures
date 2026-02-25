/**
 * Solution Graph View - renders the tree graph structure for non-P3 wallpaper groups
 */

import type { TiledGraph, TiledNode } from "./TiledGraph";
import { getRootColor, findEquivalentNodes } from "./TiledGraph";
import { DIRECTION_DELTA } from "./WallpaperGroups";
import type { MazeSolution } from "./types";

interface SolutionGraphViewProps {
  tiledGraph: TiledGraph;
  solution: MazeSolution;
  graphSelectedNode: TiledNode | null;
  onNodeSelect: (node: TiledNode | null) => void;
}

export function SolutionGraphView({
  tiledGraph,
  solution,
  graphSelectedNode,
  onNodeSelect,
}: SolutionGraphViewProps) {
  const dotRadius = 4;
  const graphCellSize = 30;
  const graphPadding = 20;

  const totalSize = tiledGraph.totalSize * graphCellSize + graphPadding * 2;

  const dots: React.ReactNode[] = [];
  const edges: React.ReactNode[] = [];
  const highlights: React.ReactNode[] = [];
  const gridLines: React.ReactNode[] = [];

  // Find equivalent nodes if one is selected
  const equivalentNodes = graphSelectedNode ? findEquivalentNodes(tiledGraph, graphSelectedNode) : [];

  // Draw faint grid lines
  for (let i = 0; i <= tiledGraph.totalSize; i++) {
    gridLines.push(
      <line
        key={`vline-${i}`}
        x1={graphPadding + i * graphCellSize}
        y1={graphPadding}
        x2={graphPadding + i * graphCellSize}
        y2={totalSize - graphPadding}
        stroke="#eee"
        strokeWidth={1}
      />
    );
    gridLines.push(
      <line
        key={`hline-${i}`}
        x1={graphPadding}
        y1={graphPadding + i * graphCellSize}
        x2={totalSize - graphPadding}
        y2={graphPadding + i * graphCellSize}
        stroke="#eee"
        strokeWidth={1}
      />
    );
  }

  // Draw edges (from each node to its parent) - skip edges involving vacant cells
  for (const edge of tiledGraph.edges) {
    const fromNode = tiledGraph.nodes[edge.fromId];
    const toNode = tiledGraph.nodes[edge.toId];

    // Skip edges involving vacant cells
    const fromKey = `${fromNode.fundamentalRow},${fromNode.fundamentalCol}`;
    const toKey = `${toNode.fundamentalRow},${toNode.fundamentalCol}`;
    if (solution.vacantCells.has(fromKey) || solution.vacantCells.has(toKey)) {
      continue;
    }

    const x1 = graphPadding + fromNode.absCol * graphCellSize + graphCellSize / 2;
    const y1 = graphPadding + fromNode.absRow * graphCellSize + graphCellSize / 2;
    const x2 = graphPadding + toNode.absCol * graphCellSize + graphCellSize / 2;
    const y2 = graphPadding + toNode.absRow * graphCellSize + graphCellSize / 2;

    edges.push(
      <line
        key={`edge-${edge.fromId}-${edge.toId}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={getRootColor(fromNode.rootIndex)}
        strokeWidth={2}
      />
    );
  }

  // Draw dots for each node - skip vacant cells (they are "empty squares" - no dot)
  for (const node of tiledGraph.nodes) {
    const cellKey = `${node.fundamentalRow},${node.fundamentalCol}`;
    if (solution.vacantCells.has(cellKey)) {
      continue; // Skip vacant cells - they render as empty (no dot)
    }

    const cx = graphPadding + node.absCol * graphCellSize + graphCellSize / 2;
    const cy = graphPadding + node.absRow * graphCellSize + graphCellSize / 2;

    dots.push(
      <circle
        key={`dot-${node.id}`}
        cx={cx}
        cy={cy}
        r={node.isRoot ? dotRadius * 1.5 : dotRadius}
        fill={getRootColor(node.rootIndex)}
        stroke={node.isRoot ? "#000" : "none"}
        strokeWidth={node.isRoot ? 2 : 0}
        style={{ cursor: "pointer" }}
        onClick={() => {
          if (graphSelectedNode?.id === node.id) {
            onNodeSelect(null);
          } else {
            onNodeSelect(node);
          }
        }}
      />
    );
  }

  // Highlight equivalent nodes and draw parent arrows
  if (graphSelectedNode) {
    for (const node of equivalentNodes) {
      const cx = graphPadding + node.absCol * graphCellSize + graphCellSize / 2;
      const cy = graphPadding + node.absRow * graphCellSize + graphCellSize / 2;

      // Highlight circle
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

      // Parent arrow
      if (node.visualParentDirection && !node.isRoot) {
        const delta = DIRECTION_DELTA[node.visualParentDirection];
        const arrowLen = graphCellSize * 0.6;
        const ax2 = cx + delta.dCol * arrowLen;
        const ay2 = cy + delta.dRow * arrowLen;

        highlights.push(
          <line
            key={`arrow-${node.id}`}
            x1={cx}
            y1={cy}
            x2={ax2}
            y2={ay2}
            stroke="#ff00ff"
            strokeWidth={2}
            markerEnd="url(#arrowhead)"
          />
        );
      }
    }
  }

  return (
    <svg width={totalSize} height={totalSize}>
      <defs>
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 6 3, 0 6" fill="#ff00ff" />
        </marker>
      </defs>
      {gridLines}
      {edges}
      {dots}
      {highlights}
    </svg>
  );
}
