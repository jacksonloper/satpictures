import React, { useMemo } from "react";
import type { Wall } from "./mazeGenerator";

/** MazeViewer - displays the maze with only the remaining walls */
export interface MazeViewerProps {
  /** Width of the tiling grid */
  width: number;
  /** Height of the tiling grid */
  height: number;
  /** Remaining walls after maze generation */
  walls: Wall[];
  /** Cell size in pixels */
  cellSize?: number;
  /** SVG ref for download functionality */
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

export const MazeViewer: React.FC<MazeViewerProps> = ({
  width,
  height,
  walls,
  cellSize = 30,
  svgRef,
}) => {
  // Calculate the outer bounds from wall coordinates (including overhangs)
  const { offsetCol, offsetRow, outerWidth, outerHeight } = useMemo(() => {
    let minRow = 0, maxRow = height - 1;
    let minCol = 0, maxCol = width - 1;
    
    // Scan all walls to find the actual bounds
    for (const wall of walls) {
      const { row, col } = wall.cell1;
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    }
    
    return {
      offsetCol: -minCol,
      offsetRow: -minRow,
      outerWidth: maxCol - minCol + 1,
      outerHeight: maxRow - minRow + 1,
    };
  }, [walls, width, height]);
  
  // Calculate SVG dimensions based on outer bounds
  const svgWidth = outerWidth * cellSize;
  const svgHeight = outerHeight * cellSize;
  
  // Convert walls to line segments with offset applied
  const lineSegments = walls.map((wall, index) => {
    // Apply offset to convert logical coordinates to SVG coordinates
    const x = (wall.cell1.col + offsetCol) * cellSize;
    const y = (wall.cell1.row + offsetRow) * cellSize;
    
    let x1: number, y1: number, x2: number, y2: number;
    
    switch (wall.direction) {
      case "top":
        x1 = x;
        y1 = y;
        x2 = x + cellSize;
        y2 = y;
        break;
      case "bottom":
        x1 = x;
        y1 = y + cellSize;
        x2 = x + cellSize;
        y2 = y + cellSize;
        break;
      case "left":
        x1 = x;
        y1 = y;
        x2 = x;
        y2 = y + cellSize;
        break;
      case "right":
        x1 = x + cellSize;
        y1 = y;
        x2 = x + cellSize;
        y2 = y + cellSize;
        break;
    }
    
    return { x1, y1, x2, y2, key: `wall-${index}` };
  });
  
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
        aria-label={`Maze showing ${walls.length} walls on a ${width}×${height} grid`}
      >
        <title>Maze Visualization</title>
        
        {/* Background */}
        <rect
          x={0}
          y={0}
          width={svgWidth}
          height={svgHeight}
          fill="#f8f9fa"
        />
        
        {/* Inner grid boundary (red border to show the original grid area) */}
        <rect
          x={offsetCol * cellSize}
          y={offsetRow * cellSize}
          width={width * cellSize}
          height={height * cellSize}
          fill="none"
          stroke="#e74c3c"
          strokeWidth={3}
        />
        
        {/* Draw walls */}
        {lineSegments.map(({ x1, y1, x2, y2, key }) => (
          <line
            key={key}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#2c3e50"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
};
