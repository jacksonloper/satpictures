import React from "react";
import type { EdgeState } from "./grids/types";

export type TriangleGridMode = 'cell' | 'edge';

/** Triangle grid for polyiamond */
interface TriangleGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
  /** Editor mode: 'cell' to toggle cells, 'edge' to toggle edges */
  mode?: TriangleGridMode;
  /** Edge state for rendering marked edges */
  edgeState?: EdgeState;
  /** Callback when an edge is clicked (in edge mode) */
  onEdgeClick?: (row: number, col: number, edgeIndex: number) => void;
}

export const TriangleGrid: React.FC<TriangleGridProps> = ({ 
  cells, 
  onCellClick, 
  cellSize = 40,
  mode = 'cell',
  edgeState,
  onEdgeClick,
}) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Triangle geometry:
  // - triWidth: base of the equilateral triangle = cellSize
  // - triHeight: height = base * sqrt(3)/2 (standard equilateral triangle ratio)
  // - Triangles overlap horizontally by half their width (tessellation)
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  
  const svgWidth = (width + 1) * (triWidth / 2) + 10;
  const svgHeight = height * triHeight + 10;
  
  // Get triangle vertices based on orientation
  const getTriangleVertices = (row: number, col: number) => {
    const isUp = (row + col) % 2 === 0;
    const x = col * (triWidth / 2) + 5;
    const y = row * triHeight + 5;
    
    if (isUp) {
      // Up-pointing triangle: apex at top
      return [
        { x: x + triWidth / 2, y: y },        // apex (top)
        { x: x, y: y + triHeight },            // bottom-left
        { x: x + triWidth, y: y + triHeight }, // bottom-right
      ];
    } else {
      // Down-pointing triangle: apex at bottom
      return [
        { x: x, y: y },                        // top-left
        { x: x + triWidth, y: y },             // top-right
        { x: x + triWidth / 2, y: y + triHeight }, // apex (bottom)
      ];
    }
  };
  
  // Create triangle path (up-pointing or down-pointing)
  // Orientation alternates based on (row + col) % 2 for tessellation
  const createTriPath = (row: number, col: number): string => {
    const vertices = getTriangleVertices(row, col);
    return `M ${vertices[0].x},${vertices[0].y} L ${vertices[1].x},${vertices[1].y} L ${vertices[2].x},${vertices[2].y} Z`;
  };
  
  // Get edge coordinates for triangle (3 edges, 0-2)
  // Edge i goes from vertex i to vertex (i+1) % 3
  const getEdgeCoords = (row: number, col: number, edgeIndex: number) => {
    const vertices = getTriangleVertices(row, col);
    const v1 = vertices[edgeIndex];
    const v2 = vertices[(edgeIndex + 1) % 3];
    return { x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y };
  };
  
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: "block" }}
    >
      {/* Layer 1: Cell fills */}
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <path
            key={`cell-${rowIdx}-${colIdx}`}
            d={createTriPath(rowIdx, colIdx)}
            fill={filled ? "#e74c3c" : "#ecf0f1"}
            stroke="#bdc3c7"
            strokeWidth={1}
            style={{ cursor: mode === 'cell' ? "pointer" : "default" }}
            onClick={() => mode === 'cell' && onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
      
      {/* Layer 2: Edge highlights (marked edges) as inset circles
       * Triangle grid vertices go clockwise, so interior is to the right.
       */}
      {edgeState && cells.map((row, rowIdx) =>
        row.map((_, colIdx) => {
          const cellEdges = edgeState[rowIdx]?.[colIdx];
          if (!cellEdges) return null;
          
          // Circle radius and inset distance as fractions of cell size
          // Slightly smaller for triangles since the cells are smaller
          const circleRadius = cellSize * 0.10;
          const insetDistance = cellSize * 0.12;
          
          return cellEdges.map((isMarked, edgeIdx) => {
            if (!isMarked) return null;
            
            const { x1, y1, x2, y2 } = getEdgeCoords(rowIdx, colIdx, edgeIdx);
            
            // Edge midpoint
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            
            // Edge direction vector
            const edgeDx = x2 - x1;
            const edgeDy = y2 - y1;
            const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
            
            // Perpendicular direction (90° clockwise = into cell interior)
            const perpX = edgeDy / edgeLen;
            const perpY = -edgeDx / edgeLen;
            
            // Circle center: offset inward from edge midpoint
            const cx = midX + perpX * insetDistance;
            const cy = midY + perpY * insetDistance;
            
            return (
              <circle
                key={`edge-highlight-${rowIdx}-${colIdx}-${edgeIdx}`}
                cx={cx}
                cy={cy}
                r={circleRadius}
                fill="#f39c12"
                stroke="#c0392b"
                strokeWidth={1}
              />
            );
          });
        })
      )}
      
      {/* Layer 3: Edge click targets (in edge mode) */}
      {mode === 'edge' && cells.map((row, rowIdx) =>
        row.map((_, colIdx) => (
          [0, 1, 2].map(edgeIdx => {
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
