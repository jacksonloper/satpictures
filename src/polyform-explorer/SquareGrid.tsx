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
      
      {/* Layer 2: Half-circle edge markers on both sides of each edge
       * Each edge has a half circle facing into the cell (this cell's marker)
       * showing filled if marked, hollow outline if not (in edge mode)
       */}
      {cells.flatMap((row, rowIdx) =>
        row.flatMap((_, colIdx) => {
          const cellEdges = edgeState?.[rowIdx]?.[colIdx];
          // Larger radius for better visibility and easier clicking
          const semicircleRadius = cellSize * 0.18;
          
          return [0, 1, 2, 3].map(edgeIdx => {
            const { x1, y1, x2, y2 } = getEdgeCoords(rowIdx, colIdx, edgeIdx);
            const isMarked = cellEdges?.[edgeIdx] ?? false;
            
            // Edge midpoint
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            
            // Edge direction for angle calculation
            const edgeDx = x2 - x1;
            const edgeDy = y2 - y1;
            
            // Perpendicular direction pointing INTO the cell (90° clockwise)
            // For vertices going clockwise, interior is to the right
            const perpAngle = Math.atan2(edgeDy, edgeDx) + Math.PI / 2;
            
            // Semicircle path - facing into the cell
            const path = createSemicirclePath(midX, midY, semicircleRadius, perpAngle);
            
            // In edge mode, always show the half circle (filled or outline)
            // In cell mode, only show if marked
            if (mode !== 'edge' && !isMarked) return null;
            
            return (
              <path
                key={`edge-half-${rowIdx}-${colIdx}-${edgeIdx}`}
                d={path}
                fill={isMarked ? "#f39c12" : "white"}
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
