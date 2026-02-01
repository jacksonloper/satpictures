import React from "react";
import { type EdgeKey, makeEdgeKey } from "../utils/edgeKey";

/** Square grid for polyomino */
interface SquareGridProps {
  cells: boolean[][];
  roads: Set<EdgeKey>;
  onCellClick: (row: number, col: number) => void;
  onEdgeClick: (row1: number, col1: number, row2: number, col2: number) => void;
  cellSize?: number;
}

export const SquareGrid: React.FC<SquareGridProps> = ({ cells, roads, onCellClick, onEdgeClick, cellSize = 40 }) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Generate edges for all 4 sides of each filled cell.
  // For external edges (edges on the boundary of the tile), we use virtual neighbor
  // coordinates that may be negative or outside the grid bounds. This is intentional -
  // the coordinates are only used for edge key generation and click handling.
  // For example, the top edge of a cell at row 0 uses row -1 as the neighbor coordinate.
  const edges: Array<{
    key: string;
    hasRoad: boolean;
    row1: number; col1: number;
    row2: number; col2: number;
    direction: 'top' | 'bottom' | 'left' | 'right';
  }> = [];
  
  // Use a Set to avoid duplicate edges (when two adjacent filled cells share an edge)
  const seenEdgeKeys = new Set<string>();
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;
      
      // Top edge (neighbor at row - 1, may be -1 for external edge)
      const topEdgeKey = makeEdgeKey(row - 1, col, row, col);
      if (!seenEdgeKeys.has(topEdgeKey)) {
        seenEdgeKeys.add(topEdgeKey);
        edges.push({
          key: topEdgeKey,
          hasRoad: roads.has(topEdgeKey),
          row1: row - 1, col1: col,
          row2: row, col2: col,
          direction: 'top',
        });
      }
      
      // Bottom edge (neighbor at row + 1, may be >= height for external edge)
      const bottomEdgeKey = makeEdgeKey(row, col, row + 1, col);
      if (!seenEdgeKeys.has(bottomEdgeKey)) {
        seenEdgeKeys.add(bottomEdgeKey);
        edges.push({
          key: bottomEdgeKey,
          hasRoad: roads.has(bottomEdgeKey),
          row1: row, col1: col,
          row2: row + 1, col2: col,
          direction: 'bottom',
        });
      }
      
      // Left edge (neighbor at col - 1, may be -1 for external edge)
      const leftEdgeKey = makeEdgeKey(row, col - 1, row, col);
      if (!seenEdgeKeys.has(leftEdgeKey)) {
        seenEdgeKeys.add(leftEdgeKey);
        edges.push({
          key: leftEdgeKey,
          hasRoad: roads.has(leftEdgeKey),
          row1: row, col1: col - 1,
          row2: row, col2: col,
          direction: 'left',
        });
      }
      
      // Right edge (neighbor at col + 1, may be >= width for external edge)
      const rightEdgeKey = makeEdgeKey(row, col, row, col + 1);
      if (!seenEdgeKeys.has(rightEdgeKey)) {
        seenEdgeKeys.add(rightEdgeKey);
        edges.push({
          key: rightEdgeKey,
          hasRoad: roads.has(rightEdgeKey),
          row1: row, col1: col,
          row2: row, col2: col + 1,
          direction: 'right',
        });
      }
    }
  }
  
  return (
    <svg
      width={width * cellSize + 2}
      height={height * cellSize + 2}
      style={{ display: "block" }}
    >
      {/* Draw cells */}
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <rect
            key={`${rowIdx}-${colIdx}`}
            x={colIdx * cellSize + 1}
            y={rowIdx * cellSize + 1}
            width={cellSize - 1}
            height={cellSize - 1}
            fill={filled ? "#3498db" : "#ecf0f1"}
            stroke="#bdc3c7"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={() => onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
      
      {/* Draw edge toggle buttons for all edges of filled cells */}
      {edges.map((edge) => {
        const isHorizontal = edge.direction === 'left' || edge.direction === 'right';
        // Calculate center position on the edge
        let cx: number, cy: number;
        
        if (edge.direction === 'top') {
          // Top edge: center of top edge of the lower cell
          cx = edge.col2 * cellSize + cellSize / 2 + 1;
          cy = edge.row2 * cellSize + 1;
        } else if (edge.direction === 'bottom') {
          // Bottom edge: center of bottom edge of the upper cell
          cx = edge.col1 * cellSize + cellSize / 2 + 1;
          cy = (edge.row1 + 1) * cellSize + 1;
        } else if (edge.direction === 'left') {
          // Left edge: center of left edge of the right cell
          cx = edge.col2 * cellSize + 1;
          cy = edge.row2 * cellSize + cellSize / 2 + 1;
        } else {
          // Right edge: center of right edge of the left cell
          cx = (edge.col1 + 1) * cellSize + 1;
          cy = edge.row1 * cellSize + cellSize / 2 + 1;
        }
        
        return (
          <g key={edge.key}>
            {/* Road indicator line */}
            {edge.hasRoad && (
              <line
                x1={isHorizontal ? cx - cellSize / 3 : cx}
                y1={isHorizontal ? cy : cy - cellSize / 3}
                x2={isHorizontal ? cx + cellSize / 3 : cx}
                y2={isHorizontal ? cy : cy + cellSize / 3}
                stroke="#e67e22"
                strokeWidth={4}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}
            {/* Clickable area for toggling road */}
            <circle
              cx={cx}
              cy={cy}
              r={8}
              fill={edge.hasRoad ? "#e67e22" : "rgba(0,0,0,0.1)"}
              stroke={edge.hasRoad ? "#d35400" : "#999"}
              strokeWidth={2}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onEdgeClick(edge.row1, edge.col1, edge.row2, edge.col2);
              }}
            />
          </g>
        );
      })}
    </svg>
  );
};
