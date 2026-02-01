import React, { useMemo } from "react";
import type { EdgeColoredPlacement, EdgeColor } from "../problem/edge-colored-polyomino-tiling";
import { getEdgeKey } from "../problem/edge-colored-polyomino-tiling";
import { getPlacementColor } from "./placementColors";

/** Color palette for edge colors (matching SquareGridEdges) */
const EDGE_COLORS: Record<EdgeColor, string> = {
  0: "#2c3e50", // Default dark
  1: "#e74c3c", // Red
  2: "#27ae60", // Green  
  3: "#3498db", // Blue
};

/** EdgeColoredTilingViewer - displays the solved tiling with edge colors */
export interface EdgeColoredTilingViewerProps {
  width: number;
  height: number;
  placements: EdgeColoredPlacement[];
  edgeColors: Map<string, EdgeColor>;
  cellSize?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  highlightedPlacement?: number | null;
  /** Whether to show cell fill colors (false = white background with colored edges only) */
  showFills?: boolean;
}

export const EdgeColoredTilingViewer: React.FC<EdgeColoredTilingViewerProps> = ({ 
  width, 
  height, 
  placements,
  edgeColors, 
  cellSize = 30,
  svgRef,
  highlightedPlacement,
  showFills = false,
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
  
  // Collect all edges that need to be drawn
  const edges = useMemo(() => {
    const edgesList: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: EdgeColor;
      isTileBoundary: boolean;
    }[] = [];
    
    // For each placement, draw boundary edges with their colors
    for (let pIndex = 0; pIndex < placements.length; pIndex++) {
      const p = placements[pIndex];
      
      for (const cellEdge of p.cellEdges) {
        const { row, col, edges: cellColors } = cellEdge;
        const svgCol = col + offsetCol;
        const svgRow = row + offsetRow;
        const x = svgCol * cellSize;
        const y = svgRow * cellSize;
        
        // Check each edge direction
        // Top edge
        const topNeighborKey = `${row - 1},${col}`;
        const topNeighborPlacement = cellToPlacement.get(topNeighborKey);
        if (topNeighborPlacement !== pIndex) {
          // External edge - use edge color
          const edgeKey = getEdgeKey(row - 1, col, row, col);
          const color = edgeColors.get(edgeKey) ?? cellColors.top;
          edgesList.push({
            x1: x, y1: y, x2: x + cellSize, y2: y,
            color,
            isTileBoundary: topNeighborPlacement !== undefined,
          });
        }
        
        // Right edge
        const rightNeighborKey = `${row},${col + 1}`;
        const rightNeighborPlacement = cellToPlacement.get(rightNeighborKey);
        if (rightNeighborPlacement !== pIndex) {
          const edgeKey = getEdgeKey(row, col, row, col + 1);
          const color = edgeColors.get(edgeKey) ?? cellColors.right;
          edgesList.push({
            x1: x + cellSize, y1: y, x2: x + cellSize, y2: y + cellSize,
            color,
            isTileBoundary: rightNeighborPlacement !== undefined,
          });
        }
        
        // Bottom edge
        const bottomNeighborKey = `${row + 1},${col}`;
        const bottomNeighborPlacement = cellToPlacement.get(bottomNeighborKey);
        if (bottomNeighborPlacement !== pIndex) {
          const edgeKey = getEdgeKey(row, col, row + 1, col);
          const color = edgeColors.get(edgeKey) ?? cellColors.bottom;
          edgesList.push({
            x1: x, y1: y + cellSize, x2: x + cellSize, y2: y + cellSize,
            color,
            isTileBoundary: bottomNeighborPlacement !== undefined,
          });
        }
        
        // Left edge
        const leftNeighborKey = `${row},${col - 1}`;
        const leftNeighborPlacement = cellToPlacement.get(leftNeighborKey);
        if (leftNeighborPlacement !== pIndex) {
          const edgeKey = getEdgeKey(row, col - 1, row, col);
          const color = edgeColors.get(edgeKey) ?? cellColors.left;
          edgesList.push({
            x1: x, y1: y, x2: x, y2: y + cellSize,
            color,
            isTileBoundary: leftNeighborPlacement !== undefined,
          });
        }
      }
    }
    
    return edgesList;
  }, [placements, edgeColors, cellToPlacement, offsetCol, offsetRow, cellSize]);
  
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
        aria-label={`Edge-colored tiling solution showing ${placements.length} tile placements`}
      >
        <title>Edge-Colored Tiling Solution</title>
        
        {/* Layer 1: Draw all cell fills */}
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
              if (showFills) {
                fill = getPlacementColor(placementIndex, highlightedPlacement);
              } else {
                fill = "#ffffff"; // White when edge-color mode
              }
            } else if (isInnerGrid) {
              fill = "#ecf0f1"; // Empty inner cell
            } else {
              fill = "#f8f9fa"; // Empty outer cell
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
        {placements.map((p, pIndex) => {
          const interiorEdges: { x1: number; y1: number; x2: number; y2: number }[] = [];
          
          for (const cell of p.cells) {
            const svgCol = cell.col + offsetCol;
            const svgRow = cell.row + offsetRow;
            const x = svgCol * cellSize;
            const y = svgRow * cellSize;
            
            // Right edge - only if neighbor to the right is same tile
            const rightKey = `${cell.row},${cell.col + 1}`;
            if (cellToPlacement.get(rightKey) === pIndex) {
              const startY = y + cellSize * 0.1;
              const endY = y + cellSize * 0.9;
              interiorEdges.push({ x1: x + cellSize, y1: startY, x2: x + cellSize, y2: endY });
            }
            // Bottom edge - only if neighbor below is same tile
            const bottomKey = `${cell.row + 1},${cell.col}`;
            if (cellToPlacement.get(bottomKey) === pIndex) {
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
        
        {/* Layer 3: Draw inner grid boundary */}
        <rect
          x={offsetCol * cellSize}
          y={offsetRow * cellSize}
          width={width * cellSize}
          height={height * cellSize}
          fill="none"
          stroke="#e74c3c"
          strokeWidth={3}
        />
        
        {/* Layer 4: Draw tile boundary edges with colors */}
        {edges.map((edge, edgeIndex) => (
          <line
            key={`edge-${edgeIndex}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={EDGE_COLORS[edge.color]}
            strokeWidth={3}
            strokeLinecap="square"
          />
        ))}
      </svg>
    </div>
  );
};

export { EDGE_COLORS };
