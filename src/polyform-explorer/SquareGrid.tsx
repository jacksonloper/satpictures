import React from "react";
import type { EdgeState } from "./grids/types";

export type SquareGridMode = 'cell' | 'edge';

/** Square grid for polyomino */
interface SquareGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
  /** Editor mode: 'cell' to toggle cells, 'edge' to toggle edges */
  mode?: SquareGridMode;
  /** Edge state for rendering marked edges */
  edgeState?: EdgeState;
  /** Callback when an edge is clicked (in edge mode) */
  onEdgeClick?: (row: number, col: number, edgeIndex: number) => void;
}

export const SquareGrid: React.FC<SquareGridProps> = ({ 
  cells, 
  onCellClick, 
  cellSize = 40,
  mode = 'cell',
  edgeState,
  onEdgeClick,
}) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Square grid has 4 edges per cell: [up, right, down, left]
  // Edge i goes from vertex i to vertex (i+1) % 4
  // Vertices: [top-left, top-right, bottom-right, bottom-left]
  const getEdgeCoords = (row: number, col: number, edgeIndex: number) => {
    const x = col * cellSize + 1;
    const y = row * cellSize + 1;
    const w = cellSize - 1;
    const h = cellSize - 1;
    
    // Edges: 0=top, 1=right, 2=bottom, 3=left
    switch (edgeIndex) {
      case 0: // top
        return { x1: x, y1: y, x2: x + w, y2: y };
      case 1: // right
        return { x1: x + w, y1: y, x2: x + w, y2: y + h };
      case 2: // bottom
        return { x1: x + w, y1: y + h, x2: x, y2: y + h };
      case 3: // left
        return { x1: x, y1: y + h, x2: x, y2: y };
      default:
        return { x1: 0, y1: 0, x2: 0, y2: 0 };
    }
  };
  
  return (
    <svg
      width={width * cellSize + 2}
      height={height * cellSize + 2}
      style={{ display: "block" }}
    >
      {/* Layer 1: Cell fills */}
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
            style={{ cursor: mode === 'cell' ? "pointer" : "default" }}
            onClick={() => mode === 'cell' && onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
      
      {/* Layer 2: Edge highlights (marked edges) */}
      {edgeState && cells.map((row, rowIdx) =>
        row.map((_, colIdx) => {
          const cellEdges = edgeState[rowIdx]?.[colIdx];
          if (!cellEdges) return null;
          
          return cellEdges.map((isMarked, edgeIdx) => {
            if (!isMarked) return null;
            
            const { x1, y1, x2, y2 } = getEdgeCoords(rowIdx, colIdx, edgeIdx);
            
            return (
              <line
                key={`edge-highlight-${rowIdx}-${colIdx}-${edgeIdx}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#f39c12"
                strokeWidth={4}
                strokeLinecap="round"
              />
            );
          });
        })
      )}
      
      {/* Layer 3: Edge click targets (in edge mode) */}
      {mode === 'edge' && cells.map((row, rowIdx) =>
        row.map((_, colIdx) => (
          [0, 1, 2, 3].map(edgeIdx => {
            const { x1, y1, x2, y2 } = getEdgeCoords(rowIdx, colIdx, edgeIdx);
            
            return (
              <line
                key={`edge-click-${rowIdx}-${colIdx}-${edgeIdx}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={10}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdgeClick?.(rowIdx, colIdx, edgeIdx);
                }}
              />
            );
          })
        ))
      )}
    </svg>
  );
};
