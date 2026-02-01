import React from "react";
import type { EdgeColor, EdgeDirection, CellEdgeColors } from "../problem/edge-colored-polyomino-tiling";
import { EDGE_COLORS } from "../problem/edge-colored-polyomino-tiling";

/** Props for edge color display */
interface EdgeColorInfo {
  /** Whether edge coloring mode is enabled */
  enabled: boolean;
  /** Edge colors for filled cells, keyed by "row,col" */
  edgeColors: Map<string, CellEdgeColors>;
  /** Currently selected color for painting */
  selectedColor: EdgeColor;
  /** Callback when an edge is clicked */
  onEdgeClick?: (row: number, col: number, direction: EdgeDirection) => void;
}

/** Square grid for polyomino with edge coloring support */
interface SquareGridEdgesProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
  edgeColorInfo?: EdgeColorInfo;
}

export const SquareGridEdges: React.FC<SquareGridEdgesProps> = ({ 
  cells, 
  onCellClick, 
  cellSize = 40,
  edgeColorInfo,
}) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const edgeWidth = 4; // Width of edge lines
  const edgeHitArea = 12; // Larger hit area for clicking edges
  
  /**
   * Render edges for a filled cell
   */
  const renderCellEdges = (row: number, col: number) => {
    if (!edgeColorInfo?.enabled) return null;
    
    const key = `${row},${col}`;
    const colors = edgeColorInfo.edgeColors.get(key) || { top: 0, right: 0, bottom: 0, left: 0 };
    const x = col * cellSize + 1;
    const y = row * cellSize + 1;
    const size = cellSize - 1;
    
    const handleEdgeClick = (direction: EdgeDirection) => (e: React.MouseEvent) => {
      e.stopPropagation();
      edgeColorInfo.onEdgeClick?.(row, col, direction);
    };
    
    return (
      <g key={`edges-${key}`}>
        {/* Top edge */}
        <line
          x1={x}
          y1={y}
          x2={x + size}
          y2={y}
          stroke={EDGE_COLORS[colors.top]}
          strokeWidth={edgeWidth}
          strokeLinecap="square"
        />
        {/* Top edge hit area */}
        <line
          x1={x}
          y1={y}
          x2={x + size}
          y2={y}
          stroke="transparent"
          strokeWidth={edgeHitArea}
          style={{ cursor: "pointer" }}
          onClick={handleEdgeClick("top")}
        />
        
        {/* Right edge */}
        <line
          x1={x + size}
          y1={y}
          x2={x + size}
          y2={y + size}
          stroke={EDGE_COLORS[colors.right]}
          strokeWidth={edgeWidth}
          strokeLinecap="square"
        />
        {/* Right edge hit area */}
        <line
          x1={x + size}
          y1={y}
          x2={x + size}
          y2={y + size}
          stroke="transparent"
          strokeWidth={edgeHitArea}
          style={{ cursor: "pointer" }}
          onClick={handleEdgeClick("right")}
        />
        
        {/* Bottom edge */}
        <line
          x1={x}
          y1={y + size}
          x2={x + size}
          y2={y + size}
          stroke={EDGE_COLORS[colors.bottom]}
          strokeWidth={edgeWidth}
          strokeLinecap="square"
        />
        {/* Bottom edge hit area */}
        <line
          x1={x}
          y1={y + size}
          x2={x + size}
          y2={y + size}
          stroke="transparent"
          strokeWidth={edgeHitArea}
          style={{ cursor: "pointer" }}
          onClick={handleEdgeClick("bottom")}
        />
        
        {/* Left edge */}
        <line
          x1={x}
          y1={y}
          x2={x}
          y2={y + size}
          stroke={EDGE_COLORS[colors.left]}
          strokeWidth={edgeWidth}
          strokeLinecap="square"
        />
        {/* Left edge hit area */}
        <line
          x1={x}
          y1={y}
          x2={x}
          y2={y + size}
          stroke="transparent"
          strokeWidth={edgeHitArea}
          style={{ cursor: "pointer" }}
          onClick={handleEdgeClick("left")}
        />
      </g>
    );
  };
  
  return (
    <svg
      width={width * cellSize + 2}
      height={height * cellSize + 2}
      style={{ display: "block" }}
    >
      {/* Cell fills */}
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
      
      {/* Edge colors (only for filled cells when edge coloring is enabled) */}
      {edgeColorInfo?.enabled && cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => 
          filled ? renderCellEdges(rowIdx, colIdx) : null
        )
      )}
    </svg>
  );
};
