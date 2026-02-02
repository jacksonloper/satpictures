import React from "react";
import type { EdgeState } from "./grids/types";

export type HexGridMode = 'cell' | 'edge';

/** Hex grid for polyhex */
interface HexGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
  /** Editor mode: 'cell' to toggle cells, 'edge' to toggle edges */
  mode?: HexGridMode;
  /** Edge state for rendering marked edges */
  edgeState?: EdgeState;
  /** Callback when an edge is clicked (in edge mode) */
  onEdgeClick?: (row: number, col: number, edgeIndex: number) => void;
}

export const HexGrid: React.FC<HexGridProps> = ({ 
  cells, 
  onCellClick, 
  cellSize = 40,
  mode = 'cell',
  edgeState,
  onEdgeClick,
}) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Hex geometry calculations for POINTY-TOP orientation:
  // - hexSize: radius from center to vertex (0.5 * cellSize for spacing)
  // - For pointy-top: hexWidth = sqrt(3) * size, hexHeight = 2 * size
  // - Pointy-top axial → pixel: x = size * sqrt(3) * (q + r/2), y = size * 3/2 * r
  const hexSize = cellSize * 0.5;
  const hexWidth = Math.sqrt(3) * hexSize;
  const horizSpacing = hexWidth;
  const vertSpacing = hexSize * 1.5; // 3/2 * size for pointy-top
  
  const svgWidth = width * horizSpacing + horizSpacing / 2 + 10;
  const svgHeight = height * vertSpacing + hexSize + 10;
  
  // Get hex center position
  const getHexCenter = (row: number, col: number) => {
    const isOddRow = row % 2 === 1;
    const cx = col * horizSpacing + horizSpacing / 2 + (isOddRow ? horizSpacing / 2 : 0) + 5;
    const cy = row * vertSpacing + hexSize + 5;
    return { cx, cy };
  };
  
  // Create hexagon path - POINTY-TOP orientation
  // Vertices must match hexGridDef.ts: start at TOP and go CLOCKWISE
  // In screen coords (Y-down): top is (0, -1), clockwise means increasing angle
  // v0=top, v1=upper-right, v2=lower-right, v3=bottom, v4=lower-left, v5=upper-left
  const createHexPath = (cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Start at -90° (top) and go clockwise in 60° increments
      const angle = -Math.PI / 2 + (Math.PI / 3) * i;
      const x = cx + hexSize * Math.cos(angle);
      const y = cy + hexSize * Math.sin(angle);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(" L ")} Z`;
  };
  
  // Get edge coordinates for hex (6 edges, 0-5)
  // Edges go from vertex i to vertex (i+1) % 6
  // Must match createHexPath vertex ordering (start at top, go clockwise)
  const getEdgeCoords = (row: number, col: number, edgeIndex: number) => {
    const { cx, cy } = getHexCenter(row, col);

    // Same angle formula as createHexPath: start at -90° (top), go CW in 60° steps
    const angle1 = -Math.PI / 2 + (Math.PI / 3) * edgeIndex;
    const angle2 = -Math.PI / 2 + (Math.PI / 3) * ((edgeIndex + 1) % 6);

    return {
      x1: cx + hexSize * Math.cos(angle1),
      y1: cy + hexSize * Math.sin(angle1),
      x2: cx + hexSize * Math.cos(angle2),
      y2: cy + hexSize * Math.sin(angle2),
    };
  };
  
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: "block" }}
    >
      {/* Layer 1: Cell fills */}
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => {
          const { cx, cy } = getHexCenter(rowIdx, colIdx);
          
          return (
            <path
              key={`cell-${rowIdx}-${colIdx}`}
              d={createHexPath(cx, cy)}
              fill={filled ? "#27ae60" : "#ecf0f1"}
              stroke="#bdc3c7"
              strokeWidth={1}
              style={{ cursor: mode === 'cell' ? "pointer" : "default" }}
              onClick={() => mode === 'cell' && onCellClick(rowIdx, colIdx)}
            />
          );
        })
      )}
      
      {/* Layer 2: Edge highlights (marked edges) as inset circles
       * Hex grid vertices go clockwise, so interior is to the right.
       */}
      {edgeState && cells.map((row, rowIdx) =>
        row.map((_, colIdx) => {
          const cellEdges = edgeState[rowIdx]?.[colIdx];
          if (!cellEdges) return null;
          
          // Circle radius and inset distance as fractions of cell size
          const circleRadius = cellSize * 0.12;
          const insetDistance = cellSize * 0.15;
          
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
          [0, 1, 2, 3, 4, 5].map(edgeIdx => {
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
