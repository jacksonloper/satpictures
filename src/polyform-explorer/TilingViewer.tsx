import React, { useMemo } from "react";
import type { Placement } from "../problem/polyomino-tiling";
import { getPlacementColor } from "./placementColors";
import type { EdgeState } from "./grids/types";

/**
 * Get the edge permutation for a given square grid transform.
 * transformIndex: 0-3 are rotations (0°, 90°, 180°, 270° CW)
 *                 4-7 are flip + rotations
 * 
 * Returns the permutation mapping: newEdgeIdx -> originalEdgeIdx
 * (i.e., the INVERSE permutation for looking up original edge states)
 */
function getSquareEdgePermutationInverse(transformIndex: number): number[] {
  // Forward permutations: originalEdgeIdx -> newEdgeIdx
  // Edge indices: 0=top, 1=right, 2=bottom, 3=left
  const forwardPerms: number[][] = [
    [0, 1, 2, 3],  // 0: identity
    [1, 2, 3, 0],  // 1: 90° CW rotation
    [2, 3, 0, 1],  // 2: 180° rotation
    [3, 0, 1, 2],  // 3: 270° CW rotation
    [0, 3, 2, 1],  // 4: horizontal flip
    [3, 2, 1, 0],  // 5: flip + 90° CW
    [2, 1, 0, 3],  // 6: flip + 180°
    [1, 0, 3, 2],  // 7: flip + 270° CW
  ];
  
  const forward = forwardPerms[transformIndex] || [0, 1, 2, 3];
  
  // Compute inverse: inverse[forward[i]] = i
  const inverse = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    inverse[forward[i]] = i;
  }
  return inverse;
}

/**
 * Create an SVG path for a semicircle centered at (cx, cy) with given radius.
 * The semicircle faces the direction specified by the angle (in radians).
 */
function createSemicirclePath(cx: number, cy: number, radius: number, angle: number): string {
  const startAngle = angle - Math.PI / 2;
  const endAngle = angle + Math.PI / 2;
  
  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(endAngle);
  const y2 = cy + radius * Math.sin(endAngle);
  
  return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
}

/** TilingViewer - displays the solved tiling */
export interface TilingViewerProps {
  width: number;
  height: number;
  placements: Placement[];
  cellSize?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  highlightedPlacement?: number | null;
  /** Edge state from the original tile definition (will be transformed per placement) */
  edgeState?: EdgeState;
}

export const TilingViewer: React.FC<TilingViewerProps> = ({ 
  width, 
  height, 
  placements, 
  cellSize = 30,
  svgRef,
  highlightedPlacement,
  edgeState,
}) => {
  // Calculate the bounds of the outer grid (including all tile overhangs)
  const { outerBounds, cellToPlacement } = useMemo(() => {
    let minRow = 0, maxRow = height - 1;
    let minCol = 0, maxCol = width - 1;
    
    const map = new Map<string, number>();
    
    placements.forEach((p, index) => {
      for (const cell of p.cells) {
        map.set(`${cell.row},${cell.col}`, index);
        minRow = Math.min(minRow, cell.row);
        maxRow = Math.max(maxRow, cell.row);
        minCol = Math.min(minCol, cell.col);
        maxCol = Math.max(maxCol, cell.col);
      }
    });
    
    return {
      outerBounds: { minRow, maxRow, minCol, maxCol },
      cellToPlacement: map,
    };
  }, [placements, width, height]);
  
  const outerWidth = outerBounds.maxCol - outerBounds.minCol + 1;
  const outerHeight = outerBounds.maxRow - outerBounds.minRow + 1;
  
  // Offset to convert from logical coordinates to SVG coordinates
  const offsetCol = -outerBounds.minCol;
  const offsetRow = -outerBounds.minRow;
  
  return (
    <div style={{ 
      padding: "16px", 
      backgroundColor: "white", 
      borderRadius: "8px",
      border: "1px solid #dee2e6",
      display: "inline-block",
    }}>
      <svg
        ref={svgRef}
        width={outerWidth * cellSize}
        height={outerHeight * cellSize}
        style={{ display: "block" }}
        role="img"
        aria-label={`Tiling solution showing ${placements.length} tile placements on a ${width}×${height} grid with overhangs`}
      >
        <title>Tiling Solution Visualization</title>
        
        {/* Layer 1: Draw all cell fills - cells fully tile with no gaps */}
        {Array.from({ length: outerHeight }, (_, svgRowIdx) =>
          Array.from({ length: outerWidth }, (_, svgColIdx) => {
            // Convert SVG coordinates back to logical coordinates
            const logicalRow = svgRowIdx - offsetRow;
            const logicalCol = svgColIdx - offsetCol;
            const key = `${logicalRow},${logicalCol}`;
            const placementIndex = cellToPlacement.get(key);
            
            // Determine if this cell is in the inner grid
            const isInnerGrid = logicalRow >= 0 && logicalRow < height && 
                               logicalCol >= 0 && logicalCol < width;
            
            // Determine fill color
            let fill: string;
            if (placementIndex !== undefined) {
              fill = getPlacementColor(placementIndex, highlightedPlacement);
            } else if (isInnerGrid) {
              fill = "#ecf0f1"; // Empty inner cell (shouldn't happen in valid solution)
            } else {
              fill = "#f8f9fa"; // Empty outer cell (overhang area background)
            }
            
            return (
              <rect
                key={key}
                x={svgColIdx * cellSize}
                y={svgRowIdx * cellSize}
                width={cellSize}
                height={cellSize}
                fill={fill}
                stroke={fill}
                strokeWidth={0.5}
              />
            );
          })
        )}
        
        {/* Layer 1.5: Draw low-contrast overlay on cells outside the inner grid */}
        {Array.from({ length: outerHeight }, (_, svgRowIdx) =>
          Array.from({ length: outerWidth }, (_, svgColIdx) => {
            const logicalRow = svgRowIdx - offsetRow;
            const logicalCol = svgColIdx - offsetCol;
            const isInnerGrid = logicalRow >= 0 && logicalRow < height && 
                               logicalCol >= 0 && logicalCol < width;
            
            // Only draw overlay for outer cells
            if (isInnerGrid) return null;
            
            return (
              <rect
                key={`overlay-${logicalRow},${logicalCol}`}
                x={svgColIdx * cellSize}
                y={svgRowIdx * cellSize}
                width={cellSize}
                height={cellSize}
                fill="rgba(255, 255, 255, 0.35)"
              />
            );
          })
        )}
        
        {/* Layer 2: Draw interior grid lines (thin gray lines between cells within same tile) */}
        {/* Draw only the inner 80% of each line (10% to 90%) to avoid connecting across tile boundaries */}
        {placements.map((p, pIndex) => {
          const interiorEdges: { x1: number; y1: number; x2: number; y2: number }[] = [];
          
          for (const cell of p.cells) {
            const svgCol = cell.col + offsetCol;
            const svgRow = cell.row + offsetRow;
            const x = svgCol * cellSize;
            const y = svgRow * cellSize;
            
            // Only draw interior edges (where neighbor is same placement)
            // Right edge - only if neighbor to the right is same tile
            const rightKey = `${cell.row},${cell.col + 1}`;
            if (cellToPlacement.get(rightKey) === pIndex) {
              // Vertical line: shorten by 10% on each end
              const startY = y + cellSize * 0.1;
              const endY = y + cellSize * 0.9;
              interiorEdges.push({ x1: x + cellSize, y1: startY, x2: x + cellSize, y2: endY });
            }
            // Bottom edge - only if neighbor below is same tile
            const bottomKey = `${cell.row + 1},${cell.col}`;
            if (cellToPlacement.get(bottomKey) === pIndex) {
              // Horizontal line: shorten by 10% on each end
              const startX = x + cellSize * 0.1;
              const endX = x + cellSize * 0.9;
              interiorEdges.push({ x1: startX, y1: y + cellSize, x2: endX, y2: y + cellSize });
            }
          }
          
          return interiorEdges.map((edge, edgeIndex) => (
            <line
              key={`interior-${pIndex}-${edgeIndex}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#95a5a6"
              strokeWidth={0.5}
            />
          ));
        })}
        
        {/* Layer 3: Draw inner grid boundary (thick red border to distinguish from tile boundaries) */}
        <rect
          x={offsetCol * cellSize}
          y={offsetRow * cellSize}
          width={width * cellSize}
          height={height * cellSize}
          fill="none"
          stroke="#e74c3c"
          strokeWidth={3}
        />
        
        {/* Layer 4: Draw tile boundaries (thicker lines between different tiles - on top) */}
        {placements.map((p, pIndex) => {
          const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
          
          for (const cell of p.cells) {
            const svgCol = cell.col + offsetCol;
            const svgRow = cell.row + offsetRow;
            const x = svgCol * cellSize;
            const y = svgRow * cellSize;
            
            // Check each edge - draw if neighbor is different placement or empty
            // Top edge
            const topKey = `${cell.row - 1},${cell.col}`;
            if (cellToPlacement.get(topKey) !== pIndex) {
              edges.push({ x1: x, y1: y, x2: x + cellSize, y2: y });
            }
            // Bottom edge
            const bottomKey = `${cell.row + 1},${cell.col}`;
            if (cellToPlacement.get(bottomKey) !== pIndex) {
              edges.push({ x1: x, y1: y + cellSize, x2: x + cellSize, y2: y + cellSize });
            }
            // Left edge
            const leftKey = `${cell.row},${cell.col - 1}`;
            if (cellToPlacement.get(leftKey) !== pIndex) {
              edges.push({ x1: x, y1: y, x2: x, y2: y + cellSize });
            }
            // Right edge
            const rightKey = `${cell.row},${cell.col + 1}`;
            if (cellToPlacement.get(rightKey) !== pIndex) {
              edges.push({ x1: x + cellSize, y1: y, x2: x + cellSize, y2: y + cellSize });
            }
          }
          
          return edges.map((edge, edgeIndex) => (
            <line
              key={`${pIndex}-${edgeIndex}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#2c3e50"
              strokeWidth={2}
            />
          ));
        })}
        
        {/* Layer 5: Edge markings as half circles for each placement
         * Transform the edge state according to each placement's transformIndex
         */}
        {edgeState && (() => {
          // Pre-compute the original cells once (cells with edge state defined)
          const originalCells: { row: number; col: number }[] = [];
          for (let r = 0; r < edgeState.length; r++) {
            for (let c = 0; c < (edgeState[r]?.length || 0); c++) {
              if (edgeState[r]?.[c]) {
                originalCells.push({ row: r, col: c });
              }
            }
          }
          
          const semicircleRadius = cellSize * 0.12;
          
          return placements.flatMap((placement, pIndex) => {
            const inversePerm = getSquareEdgePermutationInverse(placement.transformIndex);
            
            return placement.cells.flatMap((cell, cellIdx) => {
              // The cellIdx maps to the same index in the original cells list
              // because transformations preserve cell count and order
              if (cellIdx >= originalCells.length) return [];
              
              const origCell = originalCells[cellIdx];
              const origEdges = edgeState[origCell.row]?.[origCell.col];
              if (!origEdges) return [];
              
              // Screen position for this cell in the solution view
              const svgCol = cell.col + offsetCol;
              const svgRow = cell.row + offsetRow;
              const x = svgCol * cellSize;
              const y = svgRow * cellSize;
              
              // Edge coordinates for square grid
              const edgeCoords = [
                { x1: x, y1: y, x2: x + cellSize, y2: y },                    // top
                { x1: x + cellSize, y1: y, x2: x + cellSize, y2: y + cellSize }, // right
                { x1: x + cellSize, y1: y + cellSize, x2: x, y2: y + cellSize }, // bottom
                { x1: x, y1: y + cellSize, x2: x, y2: y },                    // left
              ];
              
              return [0, 1, 2, 3].map(visualEdgeIdx => {
                // Use inverse permutation to find which original edge corresponds
                // to this visual edge after the transform
                const origEdgeIdx = inversePerm[visualEdgeIdx];
                const isMarked = origEdges[origEdgeIdx] ?? false;
                
                if (!isMarked) return null;
                
                const edge = edgeCoords[visualEdgeIdx];
                
                // Edge midpoint
                const midX = (edge.x1 + edge.x2) / 2;
                const midY = (edge.y1 + edge.y2) / 2;
                
                // Edge direction for perpendicular calculation
                const edgeDx = edge.x2 - edge.x1;
                const edgeDy = edge.y2 - edge.y1;
                
                // Perpendicular angle pointing into cell (90° CW)
                const perpAngle = Math.atan2(edgeDy, edgeDx) + Math.PI / 2;
                
                const path = createSemicirclePath(midX, midY, semicircleRadius, perpAngle);
                
                return (
                  <path
                    key={`edge-mark-${pIndex}-${cellIdx}-${visualEdgeIdx}`}
                    d={path}
                    fill="#f39c12"
                    stroke="#c0392b"
                    strokeWidth={1}
                  />
                );
              });
            });
          });
        })()}
      </svg>
    </div>
  );
};
