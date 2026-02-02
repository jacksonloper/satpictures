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
import type { GridDefinition, EdgeState, Coord } from "./types";

/**
 * Create an SVG path for a semicircle centered at (cx, cy) with given radius.
 * The semicircle faces the direction specified by the angle (in radians).
 * angle=0 faces right, angle=PI/2 faces down, etc.
 */
function createSemicirclePath(cx: number, cy: number, radius: number, angle: number): string {
  // Start and end points of the semicircle arc
  // The semicircle spans 180 degrees centered on the given angle
  const startAngle = angle - Math.PI / 2;
  const endAngle = angle + Math.PI / 2;
  
  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(endAngle);
  const y2 = cy + radius * Math.sin(endAngle);
  
  // SVG arc: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
  return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
}

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
    // Note: cells[r][q] so r is row and q is column
    const corners: Coord[] = [
      { q: 0, r: 0 },
      { q: width - 1, r: 0 },
      { q: 0, r: height - 1 },
      { q: width - 1, r: height - 1 },
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
    const midR = Math.floor(height / 2);
    const midQ = Math.floor(width / 2);
    const midVertices = grid.getCellVertices({ q: midQ, r: midR }, cellSize);
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
  // Note: cells array is indexed as cells[r][q], so row=r, col=q
  const createCellPath = useCallback((r: number, q: number): string => {
    const vertices = grid.getCellVertices({ q, r }, cellSize);
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
  const getCellVertices = useCallback((r: number, q: number) => {
    const vertices = grid.getCellVertices({ q, r }, cellSize);
    return vertices.map(v => ({
      x: v.x + svgDimensions.offsetX,
      y: v.y + svgDimensions.offsetY,
    }));
  }, [grid, cellSize, svgDimensions]);
  
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
      
      {/* Layer 2: Edge half-circles
       * 
       * With vertices listed clockwise, the cell interior is to the RIGHT
       * of each edge. We render half-circles facing into the cell.
       * 
       * IMPORTANT: Edge half-circles are only shown/editable on filled cells.
       * In edge mode, all half-circles on filled cells are shown (hollow or filled).
       * In cell mode, only marked half-circles on filled cells are shown.
       */}
      {edgeState && cells.flatMap((row, rowIdx) =>
        row.flatMap((filled, colIdx) => {
          // Only show edge half-circles on filled cells
          if (!filled) return [];
          
          const cellEdges = edgeState[rowIdx]?.[colIdx];
          if (!cellEdges) return [];
          
          const vertices = getCellVertices(rowIdx, colIdx);
          const numEdges = vertices.length;
          
          // Larger radius for better visibility and easier clicking
          const semicircleRadius = cellSize * 0.18;
          
          return cellEdges.map((isMarked, edgeIdx) => {
            // In cell mode, only show marked edges
            if (mode !== 'edge' && !isMarked) return null;
            
            const v1 = vertices[edgeIdx];
            const v2 = vertices[(edgeIdx + 1) % numEdges];
            
            // Edge midpoint
            const midX = (v1.x + v2.x) / 2;
            const midY = (v1.y + v2.y) / 2;
            
            // Edge direction for perpendicular calculation
            const edgeDx = v2.x - v1.x;
            const edgeDy = v2.y - v1.y;
            
            // Perpendicular direction (90° clockwise = into cell interior)
            // Rotating (dx, dy) by 90° CW gives (dy, -dx)
            const perpAngle = Math.atan2(edgeDy, edgeDx) + Math.PI / 2;
            
            // Semicircle path - facing into the cell
            const path = createSemicirclePath(midX, midY, semicircleRadius, perpAngle);
            
            return (
              <path
                key={`edge-half-${rowIdx}-${colIdx}-${edgeIdx}`}
                d={path}
                fill={isMarked ? edgeHighlightColor : "white"}
                stroke={isMarked ? "#c0392b" : "#bdc3c7"}
                strokeWidth={1}
                style={{ cursor: mode === 'edge' ? "pointer" : "default" }}
                onClick={(e) => {
                  if (mode === 'edge') {
                    e.stopPropagation();
                    onEdgeClick?.(rowIdx, colIdx, edgeIdx);
                  }
                }}
              />
            );
          });
        })
      )}
    </svg>
  );
};
