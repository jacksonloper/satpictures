/**
 * Solution Maze View - renders the maze with walls for non-P3 wallpaper groups
 */

import type { RefObject } from "react";
import type { TiledGraph } from "./TiledGraph";
import { getRootColor, computeWallSegments } from "./TiledGraph";
import type { MazeSolution, SolutionSelectedNode } from "./types";
import { GRID_PADDING } from "./types";

interface SolutionMazeViewProps {
  tiledGraph: TiledGraph;
  solution: MazeSolution;
  cellSize: number;
  showSolutionNeighbors: boolean;
  solutionSelectedNode: SolutionSelectedNode | null;
  solutionAdjacentNeighbors: {
    N: { copyRow: number; copyCol: number; fundamentalRow: number; fundamentalCol: number };
    S: { copyRow: number; copyCol: number; fundamentalRow: number; fundamentalCol: number };
    E: { copyRow: number; copyCol: number; fundamentalRow: number; fundamentalCol: number };
    W: { copyRow: number; copyCol: number; fundamentalRow: number; fundamentalCol: number };
  } | null;
  onCellClick: (copyRow: number, copyCol: number, fundamentalRow: number, fundamentalCol: number) => void;
  svgRef: RefObject<SVGSVGElement | null>;
}

export function SolutionMazeView({
  tiledGraph,
  solution,
  cellSize,
  showSolutionNeighbors,
  solutionSelectedNode,
  solutionAdjacentNeighbors,
  onCellClick,
  svgRef,
}: SolutionMazeViewProps) {
  const padding = GRID_PADDING;
  const cells: React.ReactNode[] = [];
  const walls: React.ReactNode[] = [];
  const highlights: React.ReactNode[] = [];

  // Create a set of neighbor keys for quick lookup (only the 4 specific adjacent neighbors)
  const neighborNodeKeys = new Set<string>();
  if (showSolutionNeighbors && solutionSelectedNode && solutionAdjacentNeighbors) {
    for (const neighbor of Object.values(solutionAdjacentNeighbors)) {
      neighborNodeKeys.add(`${neighbor.copyRow},${neighbor.copyCol},${neighbor.fundamentalRow},${neighbor.fundamentalCol}`);
    }
  }

  // Render cells from tiled graph
  for (const node of tiledGraph.nodes) {
    const x = padding + node.absCol * cellSize;
    const y = padding + node.absRow * cellSize;

    // Check if this cell was vacant at solve time
    const cellKey = `${node.fundamentalRow},${node.fundamentalCol}`;
    const isVacant = solution.vacantCells.has(cellKey);

    // Check if this specific node is selected (not all copies)
    const isSelected = showSolutionNeighbors && solutionSelectedNode &&
      node.copyRow === solutionSelectedNode.copyRow &&
      node.copyCol === solutionSelectedNode.copyCol &&
      node.fundamentalRow === solutionSelectedNode.fundamentalRow &&
      node.fundamentalCol === solutionSelectedNode.fundamentalCol;

    // Check if this specific node is one of the 4 adjacent neighbors
    const nodeKey = `${node.copyRow},${node.copyCol},${node.fundamentalRow},${node.fundamentalCol}`;
    const isNeighbor = neighborNodeKeys.has(nodeKey);

    // Color: vacant cells are black, others colored by root connection
    const fillColor = isVacant ? "#000" : getRootColor(node.rootIndex);

    cells.push(
      <rect
        key={`cell-${node.id}`}
        x={x}
        y={y}
        width={cellSize}
        height={cellSize}
        fill={fillColor}
        stroke="none"
        style={{ cursor: showSolutionNeighbors ? "pointer" : "default" }}
        onClick={() => onCellClick(node.copyRow, node.copyCol, node.fundamentalRow, node.fundamentalCol)}
      />
    );

    // Highlight selected cell
    if (isSelected) {
      highlights.push(
        <rect
          key={`selected-${node.id}`}
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

    // Highlight neighbor cells
    if (isNeighbor && !isSelected) {
      highlights.push(
        <rect
          key={`neighbor-${node.id}`}
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

    // Root indicator (only for non-vacant cells)
    if (node.isRoot && !isVacant) {
      cells.push(
        <circle
          key={`root-${node.id}`}
          cx={x + cellSize / 2}
          cy={y + cellSize / 2}
          r={cellSize / 6}
          fill="#000"
        />
      );
    }
  }

  // Compute and render walls from precomputed segments
  const wallSegments = computeWallSegments(tiledGraph, cellSize);
  for (let i = 0; i < wallSegments.length; i++) {
    const wall = wallSegments[i];
    walls.push(
      <line
        key={`wall-${i}`}
        x1={padding + wall.x1}
        y1={padding + wall.y1}
        x2={padding + wall.x2}
        y2={padding + wall.y2}
        stroke="#000"
        strokeWidth={3}
        strokeLinecap="round"
      />
    );
  }

  const totalSize = tiledGraph.totalSize * cellSize + padding * 2;

  return (
    <svg ref={svgRef} width={totalSize} height={totalSize}>
      {cells}
      {walls}
      {highlights}
    </svg>
  );
}
