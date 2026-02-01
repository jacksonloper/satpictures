import React, { useMemo } from "react";
import type { EdgeColoringPlacement } from "../problem/edge-coloring-tiling";
import { getPlacementColor } from "./placementColors";
import { EDGE_COLORS } from "./edgeColorConstants";

export interface EdgeColoringViewerProps {
  width: number;
  height: number;
  placements: EdgeColoringPlacement[];
  cellSize?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  highlightedPlacement?: number | null;
  showEdgeColors?: boolean;
  numColors?: number;
  /** Number of 90° clockwise rotations (0-3) */
  rotation?: number;
  /** Whether to flip horizontally */
  flipH?: boolean;
}

export const EdgeColoringViewer: React.FC<EdgeColoringViewerProps> = ({ 
  width, 
  height, 
  placements, 
  cellSize = 30,
  svgRef,
  highlightedPlacement,
  showEdgeColors = true,
  numColors = 2,
  rotation = 0,
  flipH = false,
}) => {
  // Calculate the bounds of the outer grid (including all tile overhangs)
  const { outerBounds, cellToPlacement, placementEdgeColors } = useMemo(() => {
    let minRow = 0, maxRow = height - 1;
    let minCol = 0, maxCol = width - 1;
    
    const map = new Map<string, number>();
    const edgeColorMap = new Map<string, number>(); // "row,col,dir" -> color
    
    placements.forEach((p, index) => {
      for (const cell of p.cells) {
        map.set(`${cell.row},${cell.col}`, index);
        minRow = Math.min(minRow, cell.row);
        maxRow = Math.max(maxRow, cell.row);
        minCol = Math.min(minCol, cell.col);
        maxCol = Math.max(maxCol, cell.col);
      }
      
      // Convert edge colors from array format back to Map if needed
      const edgeColors = p.edgeColors instanceof Map 
        ? p.edgeColors 
        : new Map(p.edgeColors as unknown as [string, number][]);
      
      for (const [key, color] of edgeColors) {
        edgeColorMap.set(key, color);
      }
    });
    
    return {
      outerBounds: { minRow, maxRow, minCol, maxCol },
      cellToPlacement: map,
      placementEdgeColors: edgeColorMap,
    };
  }, [placements, width, height]);
  
  const outerWidth = outerBounds.maxCol - outerBounds.minCol + 1;
  const outerHeight = outerBounds.maxRow - outerBounds.minRow + 1;
  
  // Offset to convert from logical coordinates to SVG coordinates
  const offsetCol = -outerBounds.minCol;
  const offsetRow = -outerBounds.minRow;
  
  // Calculate SVG transform based on rotation and flip
  const svgWidth = outerWidth * cellSize;
  const svgHeight = outerHeight * cellSize;
  
  // Build transform string for the group
  const transforms: string[] = [];
  const centerX = svgWidth / 2;
  const centerY = svgHeight / 2;
  
  // Move to center, apply transforms, move back
  transforms.push(`translate(${centerX}, ${centerY})`);
  
  if (flipH) {
    transforms.push("scale(-1, 1)");
  }
  
  if (rotation !== 0) {
    transforms.push(`rotate(${rotation * 90})`);
  }
  
  transforms.push(`translate(${-centerX}, ${-centerY})`);
  
  const groupTransform = transforms.join(" ");
  
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
        width={svgWidth}
        height={svgHeight}
        style={{ display: "block" }}
        role="img"
        aria-label={`Edge coloring tiling solution showing ${placements.length} tile placements on a ${width}×${height} grid`}
      >
        <title>Edge Coloring Tiling Solution</title>
        
        <g transform={groupTransform}>
        {/* Layer 1: Draw all cell fills */}
        {Array.from({ length: outerHeight }, (_, svgRowIdx) =>
          Array.from({ length: outerWidth }, (_, svgColIdx) => {
            const logicalRow = svgRowIdx - offsetRow;
            const logicalCol = svgColIdx - offsetCol;
            const key = `${logicalRow},${logicalCol}`;
            const placementIndex = cellToPlacement.get(key);
            
            const isInnerGrid = logicalRow >= 0 && logicalRow < height && 
                               logicalCol >= 0 && logicalCol < width;
            
            let fill: string;
            if (placementIndex !== undefined) {
              fill = getPlacementColor(placementIndex, highlightedPlacement);
            } else if (isInnerGrid) {
              fill = "#ecf0f1";
            } else {
              fill = "#f8f9fa";
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
        
        {/* Layer 4: Draw tile boundaries with colors if enabled */}
        {placements.map((p, pIndex) => {
          const edges: { x1: number; y1: number; x2: number; y2: number; color?: number }[] = [];
          
          for (const cell of p.cells) {
            const svgCol = cell.col + offsetCol;
            const svgRow = cell.row + offsetRow;
            const x = svgCol * cellSize;
            const y = svgRow * cellSize;
            
            // Top edge
            const topKey = `${cell.row - 1},${cell.col}`;
            if (cellToPlacement.get(topKey) !== pIndex) {
              const edgeColorKey = `${cell.row},${cell.col},top`;
              const color = placementEdgeColors.get(edgeColorKey);
              edges.push({ x1: x, y1: y, x2: x + cellSize, y2: y, color });
            }
            // Bottom edge
            const bottomKey = `${cell.row + 1},${cell.col}`;
            if (cellToPlacement.get(bottomKey) !== pIndex) {
              const edgeColorKey = `${cell.row},${cell.col},bottom`;
              const color = placementEdgeColors.get(edgeColorKey);
              edges.push({ x1: x, y1: y + cellSize, x2: x + cellSize, y2: y + cellSize, color });
            }
            // Left edge
            const leftKey = `${cell.row},${cell.col - 1}`;
            if (cellToPlacement.get(leftKey) !== pIndex) {
              const edgeColorKey = `${cell.row},${cell.col},left`;
              const color = placementEdgeColors.get(edgeColorKey);
              edges.push({ x1: x, y1: y, x2: x, y2: y + cellSize, color });
            }
            // Right edge
            const rightKey = `${cell.row},${cell.col + 1}`;
            if (cellToPlacement.get(rightKey) !== pIndex) {
              const edgeColorKey = `${cell.row},${cell.col},right`;
              const color = placementEdgeColors.get(edgeColorKey);
              edges.push({ x1: x + cellSize, y1: y, x2: x + cellSize, y2: y + cellSize, color });
            }
          }
          
          return edges.map((edge, edgeIndex) => {
            const strokeColor = showEdgeColors && edge.color !== undefined
              ? EDGE_COLORS[edge.color % EDGE_COLORS.length]
              : "#2c3e50";
            
            return (
              <line
                key={`${pIndex}-${edgeIndex}`}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={strokeColor}
                strokeWidth={showEdgeColors && edge.color !== undefined ? 4 : 2}
              />
            );
          });
        })}
        </g>
      </svg>
      
      {/* Color legend */}
      {showEdgeColors && numColors > 0 && (
        <div style={{ marginTop: "12px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {Array.from({ length: Math.min(numColors, EDGE_COLORS.length) }, (_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <div style={{ 
                width: "20px", 
                height: "4px", 
                backgroundColor: EDGE_COLORS[i],
                borderRadius: "2px",
              }} />
              <span style={{ fontSize: "12px", color: "#495057" }}>Color {i + 1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
