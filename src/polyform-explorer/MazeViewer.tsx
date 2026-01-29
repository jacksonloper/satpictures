import React from "react";
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
  // Calculate SVG dimensions
  const svgWidth = width * cellSize;
  const svgHeight = height * cellSize;
  
  // Convert walls to line segments
  const lineSegments = walls.map((wall, index) => {
    const x = wall.cell1.col * cellSize;
    const y = wall.cell1.row * cellSize;
    
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
