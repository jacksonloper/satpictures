import React from "react";
import { EDGE_COLORS } from "./edgeColorConstants";

type EdgeDirection = "top" | "right" | "bottom" | "left";

interface EdgeColoringGridProps {
  cells: boolean[][];
  edgeColors: Map<string, number>; // "row,col,direction" -> color
  selectedColor: number;
  onCellClick: (row: number, col: number) => void;
  onEdgeClick: (row: number, col: number, direction: EdgeDirection) => void;
  cellSize?: number;
}

export const EdgeColoringGrid: React.FC<EdgeColoringGridProps> = ({ 
  cells, 
  edgeColors,
  selectedColor,
  onCellClick, 
  onEdgeClick,
  cellSize = 50,
}) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Find which cells are filled and compute their edges
  const filledCells = new Set<string>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (cells[row][col]) {
        filledCells.add(`${row},${col}`);
      }
    }
  }
  
  // Determine which edges are external (boundary of the polyomino)
  const getExternalEdges = (row: number, col: number): EdgeDirection[] => {
    if (!cells[row]?.[col]) return [];
    
    const edges: EdgeDirection[] = [];
    
    // Top edge is external if no filled cell above
    if (!filledCells.has(`${row - 1},${col}`)) edges.push("top");
    // Bottom edge is external if no filled cell below
    if (!filledCells.has(`${row + 1},${col}`)) edges.push("bottom");
    // Left edge is external if no filled cell to the left
    if (!filledCells.has(`${row},${col - 1}`)) edges.push("left");
    // Right edge is external if no filled cell to the right
    if (!filledCells.has(`${row},${col + 1}`)) edges.push("right");
    
    return edges;
  };
  
  // Calculate edge line coordinates
  const getEdgeCoords = (svgX: number, svgY: number, direction: EdgeDirection) => {
    const edgeOffset = 4; // Offset from cell boundary
    switch (direction) {
      case "top":
        return { x1: svgX + edgeOffset, y1: svgY, x2: svgX + cellSize - edgeOffset, y2: svgY };
      case "bottom":
        return { x1: svgX + edgeOffset, y1: svgY + cellSize, x2: svgX + cellSize - edgeOffset, y2: svgY + cellSize };
      case "left":
        return { x1: svgX, y1: svgY + edgeOffset, x2: svgX, y2: svgY + cellSize - edgeOffset };
      case "right":
        return { x1: svgX + cellSize, y1: svgY + edgeOffset, x2: svgX + cellSize, y2: svgY + cellSize - edgeOffset };
    }
  };
  
  // Clickable hit area for edges
  const getEdgeHitArea = (svgX: number, svgY: number, direction: EdgeDirection) => {
    const hitPadding = 8;
    switch (direction) {
      case "top":
        return { x: svgX, y: svgY - hitPadding, width: cellSize, height: hitPadding * 2 };
      case "bottom":
        return { x: svgX, y: svgY + cellSize - hitPadding, width: cellSize, height: hitPadding * 2 };
      case "left":
        return { x: svgX - hitPadding, y: svgY, width: hitPadding * 2, height: cellSize };
      case "right":
        return { x: svgX + cellSize - hitPadding, y: svgY, width: hitPadding * 2, height: cellSize };
    }
  };
  
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
            key={`cell-${rowIdx}-${colIdx}`}
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
      
      {/* Draw external edges with colors */}
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => {
          if (!filled) return null;
          
          const externalEdges = getExternalEdges(rowIdx, colIdx);
          const svgX = colIdx * cellSize + 1;
          const svgY = rowIdx * cellSize + 1;
          
          return externalEdges.map(direction => {
            const edgeKey = `${rowIdx},${colIdx},${direction}`;
            const colorIndex = edgeColors.get(edgeKey) ?? 0;
            const coords = getEdgeCoords(svgX, svgY, direction);
            const hitArea = getEdgeHitArea(svgX, svgY, direction);
            
            return (
              <g key={`edge-${edgeKey}`}>
                {/* Visible edge line */}
                <line
                  x1={coords.x1}
                  y1={coords.y1}
                  x2={coords.x2}
                  y2={coords.y2}
                  stroke={EDGE_COLORS[colorIndex % EDGE_COLORS.length]}
                  strokeWidth={6}
                  strokeLinecap="round"
                />
                {/* Invisible hit area for clicking */}
                <rect
                  x={hitArea.x}
                  y={hitArea.y}
                  width={hitArea.width}
                  height={hitArea.height}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdgeClick(rowIdx, colIdx, direction);
                  }}
                />
              </g>
            );
          });
        })
      )}
      
      {/* Current color indicator overlay */}
      <rect
        x={width * cellSize - 25}
        y={5}
        width={20}
        height={20}
        fill={EDGE_COLORS[selectedColor % EDGE_COLORS.length]}
        stroke="#2c3e50"
        strokeWidth={2}
        rx={4}
      />
    </svg>
  );
};

export { EDGE_COLORS } from "./edgeColorConstants";
export type { EdgeDirection };
