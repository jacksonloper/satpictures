import React, { useMemo, useCallback } from "react";
import type { HexWall } from "./hexMazeGenerator";

/** HexMazeViewer - displays the hex maze with only the remaining walls */
export interface HexMazeViewerProps {
  /** Width of the tiling grid */
  width: number;
  /** Height of the tiling grid */
  height: number;
  /** Remaining walls after maze generation */
  walls: HexWall[];
  /** Cell size in pixels */
  cellSize?: number;
  /** SVG ref for download functionality */
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

export const HexMazeViewer: React.FC<HexMazeViewerProps> = ({
  width,
  height,
  walls,
  cellSize = 30,
  svgRef,
}) => {
  // Hex geometry for POINTY-TOP orientation (matching HexTilingViewer)
  const hexSize = cellSize * 0.5;
  
  // Calculate the outer bounds from wall coordinates (including overhangs)
  const { offsetX, offsetY, svgWidth, svgHeight } = useMemo(() => {
    // Start with inner grid bounds (convert offset to axial)
    let minQ = 0, maxQ = width - 1;
    let minR = 0, maxR = height - 1;
    
    // Add inner grid cells (convert offset bounds to axial bounds)
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        // Convert offset to axial: q = col - floor(row/2)
        const q = c - Math.floor(r / 2);
        minQ = Math.min(minQ, q);
        maxQ = Math.max(maxQ, q);
      }
    }
    
    // Scan all walls to find actual bounds
    for (const wall of walls) {
      const { q, r } = wall.cell1;
      minQ = Math.min(minQ, q);
      maxQ = Math.max(maxQ, q);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    
    // Calculate pixel bounds using axial to pixel conversion
    // x = size * sqrt(3) * (q + r/2)
    // y = size * 3/2 * r
    const axialToPixel = (q: number, r: number) => ({
      x: hexSize * Math.sqrt(3) * (q + r / 2),
      y: hexSize * 1.5 * r,
    });
    
    const minPixel = axialToPixel(minQ, minR);
    
    // Calculate offset to ensure all content is visible
    const oX = -minPixel.x + hexSize * Math.sqrt(3) / 2 + 5;
    const oY = -minPixel.y + hexSize + 5;
    
    const maxPixel = axialToPixel(maxQ, maxR);
    const w = maxPixel.x - minPixel.x + hexSize * Math.sqrt(3) + 15;
    const h = maxPixel.y - minPixel.y + hexSize * 2 + 15;
    
    return {
      offsetX: oX,
      offsetY: oY,
      svgWidth: w,
      svgHeight: h,
    };
  }, [walls, width, height, hexSize]);
  
  // Calculate pixel position from axial coordinates (pointy-top)
  const axialToPixel = useCallback((q: number, r: number) => {
    const x = hexSize * Math.sqrt(3) * (q + r / 2);
    const y = hexSize * 1.5 * r;
    return { x: x + offsetX, y: y + offsetY };
  }, [hexSize, offsetX, offsetY]);
  
  // Get hex vertices for a given center
  // Must match hexGridDef.ts: start at TOP and go CLOCKWISE
  // v0=top, v1=upper-right, v2=lower-right, v3=bottom, v4=lower-left, v5=upper-left
  const getHexVertices = useCallback((cx: number, cy: number): Array<{ x: number; y: number }> => {
    const vertices: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      // Start at -90° (top) and go clockwise in 60° increments
      const angle = -Math.PI / 2 + (Math.PI / 3) * i;
      vertices.push({
        x: cx + hexSize * Math.cos(angle),
        y: cy + hexSize * Math.sin(angle),
      });
    }
    return vertices;
  }, [hexSize]);
  
  // Convert walls to line segments
  const lineSegments = useMemo(() => {
    return walls.map((wall, index) => {
      const { q, r } = wall.cell1;
      const pixel = axialToPixel(q, r);
      const vertices = getHexVertices(pixel.x, pixel.y);
      
      // Get the two vertices that form this edge
      const v1 = vertices[wall.edgeIndex];
      const v2 = vertices[(wall.edgeIndex + 1) % 6];
      
      return {
        x1: v1.x,
        y1: v1.y,
        x2: v2.x,
        y2: v2.y,
        key: `wall-${index}`,
      };
    });
  }, [walls, axialToPixel, getHexVertices]);
  
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
        aria-label={`Hex maze showing ${walls.length} walls on a ${width}×${height} grid`}
      >
        <title>Hex Maze Visualization</title>
        
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
