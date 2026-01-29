import React, { useMemo, useCallback } from "react";
import type { TriWall } from "./triMazeGenerator";

/** TriMazeViewer - displays the triangle maze with only the remaining walls */
export interface TriMazeViewerProps {
  /** Width of the tiling grid */
  width: number;
  /** Height of the tiling grid */
  height: number;
  /** Remaining walls after maze generation */
  walls: TriWall[];
  /** Cell size in pixels */
  cellSize?: number;
  /** SVG ref for download functionality */
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

export const TriMazeViewer: React.FC<TriMazeViewerProps> = ({
  width,
  height,
  walls,
  cellSize = 40,
  svgRef,
}) => {
  // Triangle geometry (matches TriTilingViewer.tsx):
  // - triWidth: base of the equilateral triangle = cellSize
  // - triHeight: height = base * sqrt(3)/2 (standard equilateral triangle ratio)
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  
  // Calculate the outer bounds from wall coordinates (including overhangs)
  const { offsetCol, offsetRow, outerWidth, outerHeight } = useMemo(() => {
    // Start with inner grid bounds
    let minRow = 0, maxRow = height - 1;
    let minCol = 0, maxCol = width - 1;
    
    // Scan all walls to find actual bounds
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
  
  // Calculate SVG dimensions
  const svgWidth = (outerWidth + 1) * (triWidth / 2) + 10;
  const svgHeight = outerHeight * triHeight + 10;
  
  // Get triangle vertices for a given cell
  const getTriVertices = useCallback((row: number, col: number): Array<{ x: number; y: number }> => {
    const svgCol = col + offsetCol;
    const svgRow = row + offsetRow;
    
    const isUp = (row + col) % 2 === 0;
    const x = svgCol * (triWidth / 2) + 5;
    const y = svgRow * triHeight + 5;
    
    if (isUp) {
      // Up-pointing triangle: apex at top
      // Vertices: 0=apex-top, 1=bottom-left, 2=bottom-right
      return [
        { x: x + triWidth / 2, y: y },           // Top (apex)
        { x: x, y: y + triHeight },               // Bottom-left
        { x: x + triWidth, y: y + triHeight },    // Bottom-right
      ];
    } else {
      // Down-pointing triangle: apex at bottom
      // Vertices: 0=top-left, 1=top-right, 2=apex-bottom
      return [
        { x: x, y: y },                           // Top-left
        { x: x + triWidth, y: y },                // Top-right
        { x: x + triWidth / 2, y: y + triHeight }, // Bottom (apex)
      ];
    }
  }, [triWidth, triHeight, offsetCol, offsetRow]);
  
  // Convert walls to line segments
  const lineSegments = useMemo(() => {
    return walls.map((wall, index) => {
      const { row, col } = wall.cell1;
      const vertices = getTriVertices(row, col);
      const isUp = (row + col) % 2 === 0;
      
      // Map edge index to vertex pairs based on triangle orientation
      // Edge 0: left edge, Edge 1: right edge, Edge 2: vertical edge
      // For UP tri (vertices: 0=apex-top, 1=bottom-left, 2=bottom-right):
      //   - left edge (edge 0): v0→v1
      //   - right edge (edge 1): v2→v0
      //   - bottom edge (edge 2): v1→v2
      // For DOWN tri (vertices: 0=top-left, 1=top-right, 2=apex-bottom):
      //   - left edge (edge 0): v2→v0
      //   - right edge (edge 1): v1→v2
      //   - top edge (edge 2): v0→v1
      const edgeVertexPairs = isUp
        ? [[0, 1], [2, 0], [1, 2]]  // left, right, bottom
        : [[2, 0], [1, 2], [0, 1]]; // left, right, top
      
      const [v1Idx, v2Idx] = edgeVertexPairs[wall.edgeIndex];
      const v1 = vertices[v1Idx];
      const v2 = vertices[v2Idx];
      
      return {
        x1: v1.x,
        y1: v1.y,
        x2: v2.x,
        y2: v2.y,
        key: `wall-${index}`,
      };
    });
  }, [walls, getTriVertices]);
  
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
        aria-label={`Triangle maze showing ${walls.length} walls on a ${width}×${height} grid`}
      >
        <title>Triangle Maze Visualization</title>
        
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
