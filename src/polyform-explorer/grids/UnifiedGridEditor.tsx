/**
 * Unified Grid Editor Component
 * 
 * Allows users to draw polyforms on any grid type (square, hex, triangle)
 * using the grid definitions without special casing.
 */

import React, { useCallback, useMemo } from "react";
import type { GridDefinition } from "./types";

export interface UnifiedGridEditorProps {
  /** The grid definition to use for rendering */
  grid: GridDefinition;
  /** The current cell state (filled/empty) */
  cells: boolean[][];
  /** Callback when a cell is clicked */
  onCellClick: (row: number, col: number) => void;
  /** Size of each cell in pixels */
  cellSize?: number;
}

/**
 * Get the default fill color based on grid type.
 */
function getDefaultFillColor(gridName: string): string {
  switch (gridName) {
    case 'square':
      return '#3498db';  // Blue
    case 'hex':
      return '#27ae60';  // Green
    case 'triangle':
      return '#e74c3c';  // Red
    default:
      return '#3498db';
  }
}

export const UnifiedGridEditor: React.FC<UnifiedGridEditorProps> = ({
  grid,
  cells,
  onCellClick,
  cellSize = 40,
}) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Calculate SVG dimensions based on grid type
  const svgDimensions = useMemo(() => {
    if (width === 0 || height === 0) {
      return { width: 100, height: 100, offsetX: 5, offsetY: 5 };
    }
    
    // Get cell vertices for corner cells to determine actual bounds
    const corners = [
      { row: 0, col: 0 },
      { row: 0, col: width - 1 },
      { row: height - 1, col: 0 },
      { row: height - 1, col: width - 1 },
    ];
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const corner of corners) {
      const vertices = grid.getCellVertices(corner, cellSize);
      for (const v of vertices) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }
    }
    
    // Also check middle cells for non-rectangular grids
    const midRow = Math.floor(height / 2);
    const midCol = Math.floor(width / 2);
    const midVertices = grid.getCellVertices({ row: midRow, col: midCol }, cellSize);
    for (const v of midVertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    
    // Add padding
    const padding = 10;
    
    return {
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      offsetX: -minX + padding,
      offsetY: -minY + padding,
    };
  }, [grid, cellSize, width, height]);
  
  // Create SVG path for a cell
  const createCellPath = useCallback((row: number, col: number): string => {
    const vertices = grid.getCellVertices({ row, col }, cellSize);
    const translatedVertices = vertices.map(v => ({
      x: v.x + svgDimensions.offsetX,
      y: v.y + svgDimensions.offsetY,
    }));
    
    if (translatedVertices.length === 0) return "";
    
    const points = translatedVertices.map((v, i) =>
      `${i === 0 ? 'M' : 'L'} ${v.x},${v.y}`
    ).join(' ');
    
    return `${points} Z`;
  }, [grid, cellSize, svgDimensions]);
  
  const fillColor = getDefaultFillColor(grid.name);
  
  return (
    <svg
      width={svgDimensions.width}
      height={svgDimensions.height}
      style={{ display: "block" }}
    >
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <path
            key={`${rowIdx}-${colIdx}`}
            d={createCellPath(rowIdx, colIdx)}
            fill={filled ? fillColor : "#ecf0f1"}
            stroke="#bdc3c7"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={() => onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
    </svg>
  );
};
