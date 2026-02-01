/**
 * Unified Grid Editor Component
 * 
 * Allows users to draw polyforms on any grid type (square, hex, triangle)
 * using the grid definitions without special casing.
 * 
 * Supports two modes:
 * - Cell mode: click cells to toggle filled/empty
 * - Edge mode: click edges to toggle marked/unmarked
 */

import React, { useCallback, useMemo } from "react";
import type { GridDefinition, EdgeState } from "./types";

export type EditorMode = 'cell' | 'edge';

export interface UnifiedGridEditorProps {
  /** The grid definition to use for rendering */
  grid: GridDefinition;
  /** The current cell state (filled/empty) */
  cells: boolean[][];
  /** Callback when a cell is clicked (in cell mode) */
  onCellClick: (row: number, col: number) => void;
  /** Size of each cell in pixels */
  cellSize?: number;
  /** Current editor mode */
  mode?: EditorMode;
  /** Edge state for each cell (array of booleans per cell, one per edge) */
  edgeState?: EdgeState;
  /** Callback when an edge is clicked (in edge mode) */
  onEdgeClick?: (row: number, col: number, edgeIndex: number) => void;
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
  mode = 'cell',
  edgeState,
  onEdgeClick,
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
  
  // Get vertices for a cell (with offset applied)
  const getCellVertices = useCallback((row: number, col: number) => {
    const vertices = grid.getCellVertices({ row, col }, cellSize);
    return vertices.map(v => ({
      x: v.x + svgDimensions.offsetX,
      y: v.y + svgDimensions.offsetY,
    }));
  }, [grid, cellSize, svgDimensions]);
  
  // Get the midpoint and normal direction for an edge (for click detection)
  const getEdgeInfo = useCallback((row: number, col: number, edgeIndex: number) => {
    const vertices = getCellVertices(row, col);
    const numEdges = vertices.length;
    const v1 = vertices[edgeIndex];
    const v2 = vertices[(edgeIndex + 1) % numEdges];
    
    // Midpoint
    const midX = (v1.x + v2.x) / 2;
    const midY = (v1.y + v2.y) / 2;
    
    return { v1, v2, midX, midY };
  }, [getCellVertices]);
  
  const fillColor = getDefaultFillColor(grid.name);
  const edgeHighlightColor = '#f39c12';  // Orange for marked edges
  
  return (
    <svg
      width={svgDimensions.width}
      height={svgDimensions.height}
      style={{ display: "block" }}
    >
      {/* Layer 1: Cell fills */}
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <path
            key={`cell-${rowIdx}-${colIdx}`}
            d={createCellPath(rowIdx, colIdx)}
            fill={filled ? fillColor : "#ecf0f1"}
            stroke="#bdc3c7"
            strokeWidth={1}
            style={{ cursor: mode === 'cell' ? "pointer" : "default" }}
            onClick={() => mode === 'cell' && onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
      
      {/* Layer 2: Edge highlights (marked edges) */}
      {edgeState && cells.flatMap((row, rowIdx) =>
        row.flatMap((_, colIdx) => {
          const cellEdges = edgeState[rowIdx]?.[colIdx];
          if (!cellEdges) return [];
          
          const vertices = getCellVertices(rowIdx, colIdx);
          const numEdges = vertices.length;
          
          return cellEdges
            .map((isMarked, edgeIdx) => ({ isMarked, edgeIdx }))
            .filter(({ isMarked }) => isMarked)
            .map(({ edgeIdx }) => {
              const v1 = vertices[edgeIdx];
              const v2 = vertices[(edgeIdx + 1) % numEdges];
              
              return (
                <line
                  key={`edge-highlight-${rowIdx}-${colIdx}-${edgeIdx}`}
                  x1={v1.x}
                  y1={v1.y}
                  x2={v2.x}
                  y2={v2.y}
                  stroke={edgeHighlightColor}
                  strokeWidth={4}
                  strokeLinecap="round"
                />
              );
            });
        })
      )}
      
      {/* Layer 3: Edge click targets (in edge mode) */}
      {mode === 'edge' && cells.map((row, rowIdx) =>
        row.map((_, colIdx) => {
          const cellType = grid.getCellType({ row: rowIdx, col: colIdx });
          const numEdges = grid.neighbors[cellType].length;
          
          return Array.from({ length: numEdges }, (_, edgeIdx) => {
            const { v1, v2 } = getEdgeInfo(rowIdx, colIdx, edgeIdx);
            
            return (
              <line
                key={`edge-click-${rowIdx}-${colIdx}-${edgeIdx}`}
                x1={v1.x}
                y1={v1.y}
                x2={v2.x}
                y2={v2.y}
                stroke="transparent"
                strokeWidth={10}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdgeClick?.(rowIdx, colIdx, edgeIdx);
                }}
              />
            );
          });
        })
      )}
    </svg>
  );
};
