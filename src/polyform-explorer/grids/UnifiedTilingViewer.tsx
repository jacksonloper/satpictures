/**
 * Unified Tiling Viewer Component
 * 
 * Displays tiling solutions for any grid type (square, hex, triangle)
 * using the grid definitions without special casing.
 */

import React, { useMemo, useCallback } from "react";
import type { GridDefinition, Coord, EdgeState } from "./types";
import type { UnifiedPlacement } from "./unifiedTiling";
import { getPlacementColor } from "../placementColors";

export interface UnifiedTilingViewerProps {
  /** The grid definition to use for rendering */
  grid: GridDefinition;
  /** Width of the tiling grid (in cells) */
  width: number;
  /** Height of the tiling grid (in cells) */
  height: number;
  /** Placements to render */
  placements: UnifiedPlacement[];
  /** Size of each cell in pixels */
  cellSize?: number;
  /** Ref to the SVG element for downloading */
  svgRef?: React.RefObject<SVGSVGElement | null>;
  /** Index of the highlighted placement (or null for none) */
  highlightedPlacement?: number | null;
  /** Edge state to render (optional) */
  edgeState?: EdgeState;
}

/**
 * Get a unique key for a coordinate.
 */
function coordKey(coord: Coord): string {
  return `${coord.q},${coord.r}`;
}

export const UnifiedTilingViewer: React.FC<UnifiedTilingViewerProps> = ({
  grid,
  width,
  height,
  placements,
  cellSize = 30,
  svgRef,
  highlightedPlacement,
  edgeState,
}) => {
  // Build cell-to-placement map and find bounds (including overhangs)
  const { bounds, cellToPlacement, allCells } = useMemo(() => {
    const map = new Map<string, number>();
    const cells: Array<{ coord: Coord; placementIndex: number }> = [];
    
    // Start with inner grid bounds
    let minR = 0, maxR = height - 1;
    let minQ = 0, maxQ = width - 1;
    
    // Process placements
    placements.forEach((p, index) => {
      for (const cell of p.cells) {
        const key = coordKey(cell);
        map.set(key, index);
        cells.push({ coord: cell, placementIndex: index });
        minR = Math.min(minR, cell.r);
        maxR = Math.max(maxR, cell.r);
        minQ = Math.min(minQ, cell.q);
        maxQ = Math.max(maxQ, cell.q);
      }
    });
    
    return {
      bounds: { minR, maxR, minQ, maxQ },
      cellToPlacement: map,
      allCells: cells,
    };
  }, [placements, width, height]);
  
  // Check if a cell is in the inner grid
  const isInInnerGrid = useCallback((q: number, r: number): boolean => {
    return r >= 0 && r < height && q >= 0 && q < width;
  }, [width, height]);
  
  // Get neighbors for a cell
  const getCellNeighbors = useCallback((coord: Coord): Coord[] => {
    const cellType = grid.getCellType(coord);
    const neighborInfos = grid.neighbors[cellType];
    return neighborInfos.map(n => ({
      q: coord.q + n.dq,
      r: coord.r + n.dr,
    }));
  }, [grid]);
  
  // Calculate SVG dimensions based on grid type
  const svgDimensions = useMemo(() => {
    // Get cell vertices for corner cells to determine actual bounds
    const topLeft = grid.getCellVertices({ q: bounds.minQ, r: bounds.minR }, cellSize);
    const bottomRight = grid.getCellVertices({ q: bounds.maxQ, r: bounds.maxR }, cellSize);
    
    // Find actual pixel bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of [...topLeft, ...bottomRight]) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    
    // Add some padding
    const padding = cellSize * 0.2;
    
    return {
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      offsetX: -minX + padding,
      offsetY: -minY + padding,
    };
  }, [grid, bounds, cellSize]);
  
  // Generate cells to render (placement cells + empty inner grid cells)
  const cellsToRender = useMemo(() => {
    const result: Array<{ coord: Coord; placementIndex: number | undefined; isInner: boolean }> = [];
    const seen = new Set<string>();
    
    // Add all placement cells
    for (const { coord, placementIndex } of allCells) {
      const key = coordKey(coord);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ 
          coord, 
          placementIndex, 
          isInner: isInInnerGrid(coord.q, coord.r) 
        });
      }
    }
    
    // Add empty inner grid cells
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        const key = coordKey({ q, r });
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ 
            coord: { q, r }, 
            placementIndex: undefined, 
            isInner: true 
          });
        }
      }
    }
    
    return result;
  }, [allCells, height, width, isInInnerGrid]);
  
  // Create SVG path for a cell using grid definition
  const createCellPath = useCallback((coord: Coord): string => {
    const vertices = grid.getCellVertices(coord, cellSize);
    const translatedVertices = vertices.map(v => ({
      x: v.x + svgDimensions.offsetX,
      y: v.y + svgDimensions.offsetY,
    }));
    
    if (translatedVertices.length === 0) return "";
    
    const points = translatedVertices.map((v, i) => 
      `${i === 0 ? 'M' : 'L'} ${v.x},${v.y}`
    ).join(' ');
    
    return `${points} Z`;
  }, [grid, cellSize, svgDimensions]);
  
  // Get vertices for edge drawing
  const getCellVerticesForEdge = useCallback((coord: Coord): Array<{ x: number; y: number }> => {
    const vertices = grid.getCellVertices(coord, cellSize);
    return vertices.map(v => ({
      x: v.x + svgDimensions.offsetX,
      y: v.y + svgDimensions.offsetY,
    }));
  }, [grid, cellSize, svgDimensions]);
  
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
        width={svgDimensions.width}
        height={svgDimensions.height}
        style={{ display: "block" }}
        role="img"
        aria-label={`${grid.name} tiling solution showing ${placements.length} tile placements on a ${width}×${height} grid`}
      >
        <title>{grid.name} Tiling Solution Visualization</title>
        
        {/* Layer 1: Draw all cell fills */}
        {cellsToRender.map(({ coord, placementIndex, isInner }) => {
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
              key={`fill-${coordKey(coord)}`}
              d={createCellPath(coord)}
              fill={fill}
              stroke={fill}
              strokeWidth={0.5}
            />
          );
        })}
        
        {/* Layer 1.5: Draw overlay on cells outside the inner grid */}
        {cellsToRender
          .filter(({ isInner }) => !isInner)
          .map(({ coord }) => (
            <path
              key={`overlay-${coordKey(coord)}`}
              d={createCellPath(coord)}
              fill="rgba(255, 255, 255, 0.35)"
            />
          ))}
        
        {/* Layer 2: Draw interior edges (thin gray lines between cells in same tile) */}
        {(() => {
          const seenEdges = new Set<string>();
          const interiorEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
          
          for (const { coord, placementIndex } of allCells) {
            if (placementIndex === undefined) continue;
            
            const vertices = getCellVerticesForEdge(coord);
            const neighbors = getCellNeighbors(coord);
            const numEdges = vertices.length;
            
            for (let edgeIndex = 0; edgeIndex < numEdges; edgeIndex++) {
              const neighbor = neighbors[edgeIndex];
              const neighborKey = coordKey(neighbor);
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              if (neighborPlacement === placementIndex) {
                // Interior edge - deduplicate
                const a = coordKey(coord);
                const b = neighborKey;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const v1 = vertices[edgeIndex];
                  const v2 = vertices[(edgeIndex + 1) % numEdges];
                  
                  // Shorten the line by 10% on each end
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
          .map(({ coord }) => {
            const vertices = getCellVerticesForEdge(coord);
            const neighbors = getCellNeighbors(coord);
            const numEdges = vertices.length;
            
            const boundaryEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
            
            for (let edgeIndex = 0; edgeIndex < numEdges; edgeIndex++) {
              const neighbor = neighbors[edgeIndex];
              if (!isInInnerGrid(neighbor.q, neighbor.r)) {
                const v1 = vertices[edgeIndex];
                const v2 = vertices[(edgeIndex + 1) % numEdges];
                boundaryEdges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
              }
            }
            
            return boundaryEdges.map((edge, edgeIndex) => (
              <line
                key={`boundary-${coordKey(coord)}-${edgeIndex}`}
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
          
          for (const { coord, placementIndex } of allCells) {
            if (placementIndex === undefined) continue;
            
            const vertices = getCellVerticesForEdge(coord);
            const neighbors = getCellNeighbors(coord);
            const numEdges = vertices.length;
            
            for (let edgeIndex = 0; edgeIndex < numEdges; edgeIndex++) {
              const neighbor = neighbors[edgeIndex];
              const neighborKey = coordKey(neighbor);
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              // Draw boundary if neighbor is different tile or empty
              if (neighborPlacement !== placementIndex) {
                const a = coordKey(coord);
                const b = neighborKey;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const v1 = vertices[edgeIndex];
                  const v2 = vertices[(edgeIndex + 1) % numEdges];
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
        
        {/* Layer 5: Edge markings as inset circles
         * 
         * Since neighboring cells may have different edge values, we render
         * the marker as a circle that protrudes into this cell's interior.
         * 
         * With vertices listed clockwise, the cell interior is to the RIGHT
         * of each edge (when going from vertex[i] to vertex[i+1]).
         * 
         * For each marked edge:
         * 1. Find the edge midpoint
         * 2. Calculate the perpendicular direction (90° CW = into cell interior)
         * 3. Offset the circle center inward from the edge
         * 4. Draw a filled circle to indicate the edge is marked
         */}
        {edgeState && cellsToRender.flatMap(({ coord }) => {
          const cellEdges = edgeState[coord.r]?.[coord.q];
          if (!cellEdges) return [];
          
          const vertices = getCellVerticesForEdge(coord);
          const numEdges = vertices.length;
          
          // Circle radius as a fraction of cell size
          const circleRadius = cellSize * 0.12;
          // How far to inset the circle from the edge (center distance)
          const insetDistance = cellSize * 0.15;
          
          return cellEdges
            .map((isMarked, edgeIdx) => ({ isMarked, edgeIdx }))
            .filter(({ isMarked }) => isMarked)
            .map(({ edgeIdx }) => {
              const v1 = vertices[edgeIdx];
              const v2 = vertices[(edgeIdx + 1) % numEdges];
              
              // Edge midpoint
              const midX = (v1.x + v2.x) / 2;
              const midY = (v1.y + v2.y) / 2;
              
              // Edge direction vector
              const edgeDx = v2.x - v1.x;
              const edgeDy = v2.y - v1.y;
              const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
              
              // Perpendicular direction (90° clockwise = into cell interior)
              // Rotating (dx, dy) by 90° CW gives (dy, -dx)
              const perpX = edgeDy / edgeLen;
              const perpY = -edgeDx / edgeLen;
              
              // Circle center: offset inward from edge midpoint
              const cx = midX + perpX * insetDistance;
              const cy = midY + perpY * insetDistance;
              
              return (
                <circle
                  key={`edge-mark-${coordKey(coord)}-${edgeIdx}`}
                  cx={cx}
                  cy={cy}
                  r={circleRadius}
                  fill="#f39c12"
                  stroke="#c0392b"
                  strokeWidth={1}
                />
              );
            });
        })}
      </svg>
    </div>
  );
};
