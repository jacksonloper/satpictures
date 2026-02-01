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
  
  // Generate edges between adjacent filled cells
  const edges: Array<{
    key: string;
    x1: number; y1: number;
    x2: number; y2: number;
    hasRoad: boolean;
    row1: number; col1: number;
    row2: number; col2: number;
  }> = [];
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;
      
      // Check right neighbor
      if (col + 1 < width && cells[row][col + 1]) {
        const edgeKey = makeEdgeKey(row, col, row, col + 1);
        edges.push({
          key: edgeKey,
          x1: (col + 1) * cellSize + 1,
          y1: row * cellSize + 1 + cellSize / 2,
          x2: (col + 1) * cellSize + 1,
          y2: row * cellSize + 1 + cellSize / 2,
          hasRoad: roads.has(edgeKey),
          row1: row, col1: col,
          row2: row, col2: col + 1,
        });
      }
      
      // Check bottom neighbor
      if (row + 1 < height && cells[row + 1][col]) {
        const edgeKey = makeEdgeKey(row, col, row + 1, col);
        edges.push({
          key: edgeKey,
          x1: col * cellSize + 1 + cellSize / 2,
          y1: (row + 1) * cellSize + 1,
          x2: col * cellSize + 1 + cellSize / 2,
          y2: (row + 1) * cellSize + 1,
          hasRoad: roads.has(edgeKey),
          row1: row, col1: col,
          row2: row + 1, col2: col,
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
      
      {/* Draw edge toggle buttons for adjacent filled cells */}
      {edges.map((edge) => {
        const isHorizontal = edge.row1 === edge.row2;
        const cx = isHorizontal 
          ? edge.col1 * cellSize + cellSize + 1
          : edge.col1 * cellSize + cellSize / 2 + 1;
        const cy = isHorizontal
          ? edge.row1 * cellSize + cellSize / 2 + 1
          : edge.row1 * cellSize + cellSize + 1;
        
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
