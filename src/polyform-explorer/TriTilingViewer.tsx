import React, { useMemo, useCallback } from "react";
import type { TriPlacement } from "../problem/polyiamond-tiling";
import { getPlacementColor } from "./placementColors";

/** TriTilingViewer - displays the solved triangle tiling */
export interface TriTilingViewerProps {
  width: number;
  height: number;
  placements: TriPlacement[];
  cellSize?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  highlightedPlacement?: number | null;
}

export const TriTilingViewer: React.FC<TriTilingViewerProps> = ({ 
  width, 
  height, 
  placements, 
  cellSize = 40,
  svgRef,
  highlightedPlacement 
}) => {
  // Triangle geometry (matches TriangleGrid.tsx):
  // - triWidth: base of the equilateral triangle = cellSize
  // - triHeight: height = base * sqrt(3)/2 (standard equilateral triangle ratio)
  // - Triangles overlap horizontally by half their width (tessellation)
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  
  // Build cell-to-placement map and find bounds
  const { bounds, cellToPlacement, allCells } = useMemo(() => {
    const map = new Map<string, number>();
    const cells: Array<{ row: number; col: number; placementIndex: number }> = [];
    
    // Find bounds
    let minRow = 0, maxRow = height - 1;
    let minCol = 0, maxCol = width - 1;
    
    placements.forEach((p, index) => {
      for (const cell of p.cells) {
        const key = `${cell.row},${cell.col}`;
        map.set(key, index);
        cells.push({ row: cell.row, col: cell.col, placementIndex: index });
        minRow = Math.min(minRow, cell.row);
        maxRow = Math.max(maxRow, cell.row);
        minCol = Math.min(minCol, cell.col);
        maxCol = Math.max(maxCol, cell.col);
      }
    });
    
    return {
      bounds: { minRow, maxRow, minCol, maxCol },
      cellToPlacement: map,
      allCells: cells,
    };
  }, [placements, width, height]);
  
  // Offset to convert from logical coordinates to SVG coordinates
  const offsetCol = -bounds.minCol;
  const offsetRow = -bounds.minRow;
  
  const outerWidth = bounds.maxCol - bounds.minCol + 1;
  const outerHeight = bounds.maxRow - bounds.minRow + 1;
  
  // Calculate SVG dimensions
  const svgWidth = (outerWidth + 1) * (triWidth / 2) + 10;
  const svgHeight = outerHeight * triHeight + 10;
  
  // Create triangle path (up-pointing or down-pointing)
  // Orientation alternates based on (row + col) % 2 for tessellation
  const createTriPath = useCallback((row: number, col: number): string => {
    // Convert to SVG coordinates
    const svgCol = col + offsetCol;
    const svgRow = row + offsetRow;
    
    const isUp = (row + col) % 2 === 0;
    const x = svgCol * (triWidth / 2) + 5;
    const y = svgRow * triHeight + 5;
    
    if (isUp) {
      // Up-pointing triangle: apex at top
      const p1 = `${x + triWidth / 2},${y}`;
      const p2 = `${x},${y + triHeight}`;
      const p3 = `${x + triWidth},${y + triHeight}`;
      return `M ${p1} L ${p2} L ${p3} Z`;
    } else {
      // Down-pointing triangle: apex at bottom
      const p1 = `${x},${y}`;
      const p2 = `${x + triWidth},${y}`;
      const p3 = `${x + triWidth / 2},${y + triHeight}`;
      return `M ${p1} L ${p2} L ${p3} Z`;
    }
  }, [triWidth, triHeight, offsetCol, offsetRow]);
  
  // Get triangle vertices for border drawing
  const getTriVertices = useCallback((row: number, col: number): Array<{ x: number; y: number }> => {
    const svgCol = col + offsetCol;
    const svgRow = row + offsetRow;
    
    const isUp = (row + col) % 2 === 0;
    const x = svgCol * (triWidth / 2) + 5;
    const y = svgRow * triHeight + 5;
    
    if (isUp) {
      return [
        { x: x + triWidth / 2, y: y },           // Top (apex)
        { x: x, y: y + triHeight },               // Bottom-left
        { x: x + triWidth, y: y + triHeight },    // Bottom-right
      ];
    } else {
      return [
        { x: x, y: y },                           // Top-left
        { x: x + triWidth, y: y },                // Top-right
        { x: x + triWidth / 2, y: y + triHeight }, // Bottom (apex)
      ];
    }
  }, [triWidth, triHeight, offsetCol, offsetRow]);
  
  // Check if cell is in inner grid
  const isInInnerGrid = useCallback((row: number, col: number): boolean => {
    return row >= 0 && row < height && col >= 0 && col < width;
  }, [width, height]);
  
  // Generate cells to render (including empty inner cells)
  const cellsToRender = useMemo(() => {
    const result: Array<{ row: number; col: number; placementIndex: number | undefined; isInner: boolean }> = [];
    const seen = new Set<string>();
    
    // Add all placement cells
    for (const { row, col, placementIndex } of allCells) {
      const key = `${row},${col}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ row, col, placementIndex, isInner: isInInnerGrid(row, col) });
      }
    }
    
    // Add empty inner grid cells
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const key = `${row},${col}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ row, col, placementIndex: undefined, isInner: true });
        }
      }
    }
    
    return result;
  }, [allCells, width, height, isInInnerGrid]);
  
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
        aria-label={`Triangle tiling solution showing ${placements.length} tile placements on a ${width}×${height} grid`}
      >
        <title>Triangle Tiling Solution Visualization</title>
        
        {/* Layer 1: Draw all triangle cell fills */}
        {cellsToRender.map(({ row, col, placementIndex, isInner }) => {
          let fill: string;
          if (placementIndex !== undefined) {
            fill = getPlacementColor(placementIndex, highlightedPlacement);
          } else if (isInner) {
            fill = "#ecf0f1"; // Empty inner cell
          } else {
            fill = "#f8f9fa"; // Empty outer cell
          }
          
          return (
            <path
              key={`fill-${row},${col}`}
              d={createTriPath(row, col)}
              fill={fill}
              stroke={fill}
              strokeWidth={0.5}
            />
          );
        })}
        
        {/* Layer 1.5: Draw overlay on cells outside the inner grid */}
        {cellsToRender
          .filter(({ isInner }) => !isInner)
          .map(({ row, col }) => (
            <path
              key={`overlay-${row},${col}`}
              d={createTriPath(row, col)}
              fill="rgba(255, 255, 255, 0.35)"
            />
          ))}
        
        {/* Layer 2: Draw interior edges (thin gray lines between cells in same tile) */}
        {(() => {
          const seenEdges = new Set<string>();
          const interiorEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
          
          for (const { row, col, placementIndex } of allCells) {
            if (placementIndex === undefined) continue;
            
            // Check neighbors
            const neighbors = [
              { row, col: col - 1 },
              { row, col: col + 1 },
              { row: ((row + col) % 2 === 0) ? row - 1 : row + 1, col },
            ];
            
            const vertices = getTriVertices(row, col);
            // Map edges to vertex pairs based on triangle orientation
            const isUp = (row + col) % 2 === 0;
            // For up tri: edge 0 = v0-v1 (left), edge 1 = v1-v2 (bottom), edge 2 = v2-v0 (right)
            // For down tri: edge 0 = v0-v1 (top), edge 1 = v1-v2 (right), edge 2 = v2-v0 (left)
            
            const edgeVertexPairs = isUp
              ? [[0, 1], [1, 2], [2, 0]]  // left, bottom, right
              : [[0, 1], [1, 2], [2, 0]]; // top, right, left
            
            for (let i = 0; i < neighbors.length; i++) {
              const neighbor = neighbors[i];
              const neighborKey = `${neighbor.row},${neighbor.col}`;
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              if (neighborPlacement === placementIndex) {
                // Interior edge - between two cells of same tile
                const a = `${row},${col}`;
                const b = neighborKey;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const [v1Idx, v2Idx] = edgeVertexPairs[i];
                  const v1 = vertices[v1Idx];
                  const v2 = vertices[v2Idx];
                  
                  // Shorten the line by 10% on each end for visual separation
                  const dx = v2.x - v1.x;
                  const dy = v2.y - v1.y;
                  interiorEdges.push({
                    x1: v1.x + dx * 0.1,
                    y1: v1.y + dy * 0.1,
                    x2: v2.x - dx * 0.1,
                    y2: v2.y - dy * 0.1,
                  });
                }
              }
            }
          }
          
          return interiorEdges.map((edge, idx) => (
            <line
              key={`interior-${idx}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#bdc3c7"
              strokeWidth={0.5}
            />
          ));
        })()}
        
        {/* Layer 3: Draw inner grid boundary */}
        {cellsToRender
          .filter(({ isInner }) => isInner)
          .map(({ row, col }) => {
            const vertices = getTriVertices(row, col);
            const isUp = (row + col) % 2 === 0;
            
            // Check each neighbor to see if it's outside inner grid
            const neighbors = [
              { row, col: col - 1 },
              { row, col: col + 1 },
              { row: isUp ? row - 1 : row + 1, col },
            ];
            
            const edgeVertexPairs = isUp
              ? [[0, 1], [1, 2], [2, 0]]
              : [[0, 1], [1, 2], [2, 0]];
            
            const boundaryEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
            
            for (let i = 0; i < neighbors.length; i++) {
              const neighbor = neighbors[i];
              if (!isInInnerGrid(neighbor.row, neighbor.col)) {
                const [v1Idx, v2Idx] = edgeVertexPairs[i];
                const v1 = vertices[v1Idx];
                const v2 = vertices[v2Idx];
                boundaryEdges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
              }
            }
            
            return boundaryEdges.map((edge, edgeIndex) => (
              <line
                key={`boundary-${row},${col}-${edgeIndex}`}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke="#e74c3c"
                strokeWidth={3}
              />
            ));
          })}
        
        {/* Layer 4: Draw tile boundaries (thick black lines between different tiles) */}
        {(() => {
          const seenEdges = new Set<string>();
          const exteriorEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
          
          for (const { row, col, placementIndex } of allCells) {
            if (placementIndex === undefined) continue;
            
            const vertices = getTriVertices(row, col);
            const isUp = (row + col) % 2 === 0;
            
            const neighbors = [
              { row, col: col - 1 },
              { row, col: col + 1 },
              { row: isUp ? row - 1 : row + 1, col },
            ];
            
            const edgeVertexPairs = isUp
              ? [[0, 1], [1, 2], [2, 0]]
              : [[0, 1], [1, 2], [2, 0]];
            
            for (let i = 0; i < neighbors.length; i++) {
              const neighbor = neighbors[i];
              const neighborKey = `${neighbor.row},${neighbor.col}`;
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              // Draw boundary if neighbor is different tile or empty
              if (neighborPlacement !== placementIndex) {
                const a = `${row},${col}`;
                const b = neighborKey;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const [v1Idx, v2Idx] = edgeVertexPairs[i];
                  const v1 = vertices[v1Idx];
                  const v2 = vertices[v2Idx];
                  exteriorEdges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
                }
              }
            }
          }
          
          return exteriorEdges.map((edge, idx) => (
            <line
              key={`tileBoundary-${idx}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#2c3e50"
              strokeWidth={2}
            />
          ));
        })()}
      </svg>
    </div>
  );
};
