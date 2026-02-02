import React, { useMemo, useCallback, useEffect, useRef } from "react";
import type { HexPlacement, EdgeColorInfo } from "../problem/polyhex-tiling";
import { getCanonicalEdgeKey } from "../problem/polyhex-tiling";
import { getPlacementColor } from "./placementColors";

/** HexTilingViewer - displays the solved hex tiling */
export interface HexTilingViewerProps {
  width: number;
  height: number;
  placements: HexPlacement[];
  cellSize?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  highlightedPlacement?: number | null;
  highlightedEdge?: number | null;
  onEdgeInfo?: (info: EdgeInfo | null) => void;
  hideFills?: boolean;  // Hide filled hexes to see edges only
  edgeColorInfo?: EdgeColorInfo;  // Edge coloring data from SAT solver
  showEdgeColors?: boolean;  // Whether to show edge color half-circles
}

// Info about a highlighted edge
export interface EdgeInfo {
  cellIndex: number;
  edgeIndex: number;
  isInternal: boolean;
  coord1: { q: number; r: number };
  coord2: { q: number; r: number } | null;  // null if external
  direction: string;
}

export const HexTilingViewer: React.FC<HexTilingViewerProps> = ({ 
  width, 
  height, 
  placements, 
  cellSize = 30,
  svgRef,
  highlightedPlacement,
  highlightedEdge,
  onEdgeInfo,
  hideFills = false,
  edgeColorInfo,
  showEdgeColors = false
}) => {
  // Hex geometry for POINTY-TOP orientation
  // Using standard axial → pixel conversion:
  // x = size * sqrt(3) * (q + r/2)
  // y = size * 3/2 * r
  const hexSize = cellSize * 0.5;
  
  // Build axial coordinate maps and find bounds
  const { axialBounds, cellToPlacement, allAxialCells } = useMemo(() => {
    // Track all axial coordinates and which placement owns them
    const map = new Map<string, number>();
    const cells: Array<{ placementIndex: number; q: number; r: number }> = [];
    
    // Find bounds in axial space
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
    
    // Process placements - these are already in axial coordinates
    placements.forEach((p, index) => {
      for (const cell of p.cells) {
        const key = `${cell.q},${cell.r}`;
        map.set(key, index);
        cells.push({ placementIndex: index, q: cell.q, r: cell.r });
        minQ = Math.min(minQ, cell.q);
        maxQ = Math.max(maxQ, cell.q);
        minR = Math.min(minR, cell.r);
        maxR = Math.max(maxR, cell.r);
      }
    });
    
    return {
      axialBounds: { minQ, maxQ, minR, maxR },
      cellToPlacement: map,
      allAxialCells: cells,
    };
  }, [placements, width, height]);
  
  // Calculate pixel position from axial coordinates (pointy-top)
  const axialToPixel = useCallback((q: number, r: number) => {
    // Standard pointy-top conversion:
    // x = size * sqrt(3) * (q + r/2)
    // y = size * 3/2 * r
    const x = hexSize * Math.sqrt(3) * (q + r / 2);
    const y = hexSize * 1.5 * r;
    return { x, y };
  }, [hexSize]);
  
  // Calculate SVG offset to center everything with padding
  const svgOffset = useMemo(() => {
    const minPixel = axialToPixel(axialBounds.minQ, axialBounds.minR);
    return {
      x: -minPixel.x + hexSize * Math.sqrt(3) / 2 + 5,
      y: -minPixel.y + hexSize + 5,
    };
  }, [axialBounds, axialToPixel, hexSize]);
  
  // Calculate SVG dimensions
  const svgDimensions = useMemo(() => {
    const minPixel = axialToPixel(axialBounds.minQ, axialBounds.minR);
    const maxPixel = axialToPixel(axialBounds.maxQ, axialBounds.maxR);
    return {
      width: maxPixel.x - minPixel.x + hexSize * Math.sqrt(3) + 15,
      height: maxPixel.y - minPixel.y + hexSize * 2 + 15,
    };
  }, [axialBounds, axialToPixel, hexSize]);
  
  // Create hexagon path for pointy-top orientation
  const createHexPath = useCallback((cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Pointy-top: first vertex at top (90°)
      const angle = (Math.PI / 3) * i + Math.PI / 2;
      const x = cx + hexSize * Math.cos(angle);
      const y = cy + hexSize * Math.sin(angle);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(" L ")} Z`;
  }, [hexSize]);
  
  // Get hex center in SVG coordinates from axial
  const getHexCenter = useCallback((q: number, r: number): { cx: number; cy: number } => {
    const pixel = axialToPixel(q, r);
    return {
      cx: pixel.x + svgOffset.x,
      cy: pixel.y + svgOffset.y,
    };
  }, [axialToPixel, svgOffset]);
  
  // Get hex vertices for border drawing
  const getHexVertices = useCallback((cx: number, cy: number): Array<{ x: number; y: number }> => {
    const vertices: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 2;
      vertices.push({
        x: cx + hexSize * Math.cos(angle),
        y: cy + hexSize * Math.sin(angle),
      });
    }
    return vertices;
  }, [hexSize]);
  
  // Get 6 axial neighbors with edge indices for border drawing
  // In SVG coordinates (Y increases downward), with angle starting at 90°:
  //   v0: 90° → BOTTOM (sin(90°)=1 means +Y), v1: 150° → lower-left, v2: 210° → upper-left
  //   v3: 270° → TOP (sin(270°)=-1 means -Y), v4: 330° → upper-right, v5: 30° → lower-right
  // Edge i connects vertex i to vertex (i+1)%6:
  //   edge 0: v0→v1 (faces SW), edge 1: v1→v2 (faces W), edge 2: v2→v3 (faces NW)
  //   edge 3: v3→v4 (faces NE), edge 4: v4→v5 (faces E), edge 5: v5→v0 (faces SE)
  const getAxialNeighbors = useCallback((q: number, r: number): Array<{ q: number; r: number; edgeIndex: number }> => {
    return [
      { q: q + 1, r: r - 1, edgeIndex: 3 }, // Upper-right (NE) → edge 3 (v3→v4)
      { q: q + 1, r: r, edgeIndex: 4 },     // Right (E) → edge 4 (v4→v5)
      { q: q, r: r + 1, edgeIndex: 5 },     // Lower-right (SE) → edge 5 (v5→v0)
      { q: q - 1, r: r + 1, edgeIndex: 0 }, // Lower-left (SW) → edge 0 (v0→v1)
      { q: q - 1, r: r, edgeIndex: 1 },     // Left (W) → edge 1 (v1→v2)
      { q: q, r: r - 1, edgeIndex: 2 },     // Upper-left (NW) → edge 2 (v2→v3)
    ];
  }, []);
  
  // Check if axial coord is in inner grid (need to convert to offset and check bounds)
  const isInInnerGrid = useCallback((q: number, r: number): boolean => {
    // Convert axial to offset: row = r, col = q + floor(r/2)
    const row = r;
    const col = q + Math.floor(r / 2);
    return row >= 0 && row < height && col >= 0 && col < width;
  }, [width, height]);
  
  // Generate all cells to render
  const allCells = useMemo(() => {
    const cells: Array<{ q: number; r: number; placementIndex: number | undefined; isInner: boolean }> = [];
    const seen = new Set<string>();
    
    // Add all placement cells
    for (const { q, r, placementIndex } of allAxialCells) {
      const key = `${q},${r}`;
      if (!seen.has(key)) {
        seen.add(key);
        cells.push({ q, r, placementIndex, isInner: isInInnerGrid(q, r) });
      }
    }
    
    // Add empty inner grid cells
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const q = col - Math.floor(row / 2);
        const r = row;
        const key = `${q},${r}`;
        if (!seen.has(key)) {
          seen.add(key);
          const placementIndex = cellToPlacement.get(key);
          cells.push({ q, r, placementIndex, isInner: true });
        }
      }
    }
    
    return cells;
  }, [allAxialCells, cellToPlacement, width, height, isInInnerGrid]);
  
  // Compute edge info for highlighted edge
  const highlightedEdgeInfo = useMemo(() => {
    if (highlightedPlacement === null || highlightedPlacement === undefined || highlightedEdge === null || highlightedEdge === undefined) {
      return null;
    }
    
    const placement = placements[highlightedPlacement];
    if (!placement) return null;
    
    const numCells = placement.cells.length;
    if (numCells === 0) return null;
    
    const cellIndex = Math.floor(highlightedEdge / 6);
    const edgeIndex = highlightedEdge % 6;
    
    if (cellIndex >= numCells) return null;
    
    const cell = placement.cells[cellIndex];
    const neighbors = [
      { q: cell.q + 1, r: cell.r - 1, edgeIndex: 3, direction: 'NE' },
      { q: cell.q + 1, r: cell.r, edgeIndex: 4, direction: 'E' },
      { q: cell.q, r: cell.r + 1, edgeIndex: 5, direction: 'SE' },
      { q: cell.q - 1, r: cell.r + 1, edgeIndex: 0, direction: 'SW' },
      { q: cell.q - 1, r: cell.r, edgeIndex: 1, direction: 'W' },
      { q: cell.q, r: cell.r - 1, edgeIndex: 2, direction: 'NW' },
    ];
    
    // Find which neighbor corresponds to this edge
    const neighbor = neighbors.find(n => n.edgeIndex === edgeIndex);
    if (!neighbor) return null;
    
    // Check if neighbor cell is in same placement
    const neighborKey = `${neighbor.q},${neighbor.r}`;
    const neighborPlacement = cellToPlacement.get(neighborKey);
    const isInternal = neighborPlacement === highlightedPlacement;
    
    // Direction names for each edge
    const edgeDirections = ['SW', 'W', 'NW', 'NE', 'E', 'SE'];
    
    return {
      cellIndex,
      edgeIndex,
      isInternal,
      coord1: { q: cell.q, r: cell.r },
      coord2: isInternal ? { q: neighbor.q, r: neighbor.r } : null,
      direction: edgeDirections[edgeIndex],
    } as EdgeInfo;
  }, [highlightedPlacement, highlightedEdge, placements, cellToPlacement]);
  
  // Notify parent of edge info changes
  const prevEdgeInfoRef = useRef<string | null>(null);
  useEffect(() => {
    if (onEdgeInfo) {
      const infoStr = JSON.stringify(highlightedEdgeInfo);
      if (prevEdgeInfoRef.current !== infoStr) {
        prevEdgeInfoRef.current = infoStr;
        onEdgeInfo(highlightedEdgeInfo);
      }
    }
  }, [highlightedEdgeInfo, onEdgeInfo]);
  
  // Calculate highlighted edge geometry
  const highlightedEdgeGeometry = useMemo(() => {
    if (!highlightedEdgeInfo || highlightedPlacement === null || highlightedPlacement === undefined) return null;
    
    const placement = placements[highlightedPlacement];
    if (!placement) return null;
    
    const cell = placement.cells[highlightedEdgeInfo.cellIndex];
    if (!cell) return null;
    
    const { cx, cy } = getHexCenter(cell.q, cell.r);
    const vertices = getHexVertices(cx, cy);
    const v1 = vertices[highlightedEdgeInfo.edgeIndex];
    const v2 = vertices[(highlightedEdgeInfo.edgeIndex + 1) % 6];
    
    return { x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y };
  }, [highlightedEdgeInfo, highlightedPlacement, placements, getHexCenter, getHexVertices]);
  
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
        aria-label={`Hex tiling solution showing ${placements.length} tile placements on a ${width}×${height} grid`}
      >
        <title>Hex Tiling Solution Visualization</title>
        
        {/* Layer 1: Draw all hex cell fills (skip if hideFills is true) */}
        {!hideFills && allCells.map(({ q, r, placementIndex, isInner }) => {
          const { cx, cy } = getHexCenter(q, r);
          
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
              key={`fill-${q},${r}`}
              d={createHexPath(cx, cy)}
              fill={fill}
              stroke={fill}
              strokeWidth={0.5}
            />
          );
        })}
        
        {/* Layer 1.5: Draw overlay on cells outside the inner grid (skip if hideFills is true) */}
        {!hideFills && allCells
          .filter(({ isInner }) => !isInner)
          .map(({ q, r }) => {
            const { cx, cy } = getHexCenter(q, r);
            return (
              <path
                key={`overlay-${q},${r}`}
                d={createHexPath(cx, cy)}
                fill="rgba(255, 255, 255, 0.35)"
              />
            );
          })}
        
        {/* Layer 2: Draw interior edges (thin gray lines between cells in same tile) */}
        {/* Use edge deduplication: edge (A,B) is same as (B,A) */}
        {(() => {
          const seenEdges = new Set<string>();
          const interiorEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
          
          for (const { placementIndex, q, r } of allAxialCells) {
            const { cx, cy } = getHexCenter(q, r);
            const vertices = getHexVertices(cx, cy);
            const neighbors = getAxialNeighbors(q, r);
            
            for (const neighbor of neighbors) {
              const neighborKey = `${neighbor.q},${neighbor.r}`;
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              if (neighborPlacement === placementIndex) {
                // Interior edge - between two cells of same tile
                // Normalize edge key for deduplication (sort coordinate-pair strings)
                const a = `${q},${r}`;
                const b = `${neighbor.q},${neighbor.r}`;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const v1 = vertices[neighbor.edgeIndex];
                  const v2 = vertices[(neighbor.edgeIndex + 1) % 6];
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
        {allCells
          .filter(({ isInner }) => isInner)
          .map(({ q, r }) => {
            const { cx, cy } = getHexCenter(q, r);
            const vertices = getHexVertices(cx, cy);
            const neighbors = getAxialNeighbors(q, r);
            
            const boundaryEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
            
            for (const neighbor of neighbors) {
              if (!isInInnerGrid(neighbor.q, neighbor.r)) {
                // This edge is on the boundary
                const v1 = vertices[neighbor.edgeIndex];
                const v2 = vertices[(neighbor.edgeIndex + 1) % 6];
                boundaryEdges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
              }
            }
            
            return boundaryEdges.map((edge, edgeIndex) => (
              <line
                key={`boundary-${q},${r}-${edgeIndex}`}
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
          
          for (const { placementIndex, q, r } of allAxialCells) {
            const { cx, cy } = getHexCenter(q, r);
            const vertices = getHexVertices(cx, cy);
            const neighbors = getAxialNeighbors(q, r);
            
            for (const neighbor of neighbors) {
              const neighborKey = `${neighbor.q},${neighbor.r}`;
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              // Draw boundary if neighbor is different tile or empty
              if (neighborPlacement !== placementIndex) {
                // Normalize edge key for deduplication (sort coordinate-pair strings)
                const a = `${q},${r}`;
                const b = `${neighbor.q},${neighbor.r}`;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const v1 = vertices[neighbor.edgeIndex];
                  const v2 = vertices[(neighbor.edgeIndex + 1) % 6];
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
        
        {/* Layer 4.5: Draw edge colors as half-circles poking into each cell */}
        {showEdgeColors && edgeColorInfo && (() => {
          const halfCircles: Array<{
            cx: number;
            cy: number;
            radius: number;
            startAngle: number;
            endAngle: number;
            filled: boolean;
            key: string;
          }> = [];
          
          // For each cell, draw half-circles for each edge
          for (const { q, r } of allAxialCells) {
            const { cx, cy } = getHexCenter(q, r);
            const vertices = getHexVertices(cx, cy);
            
            // Draw a half-circle on each edge, from the cell's perspective
            for (let edgeIdx = 0; edgeIdx < 6; edgeIdx++) {
              const v1 = vertices[edgeIdx];
              const v2 = vertices[(edgeIdx + 1) % 6];
              
              // Get the canonical edge key and color
              const { canonicalKey } = getCanonicalEdgeKey({ q, r }, edgeIdx);
              const edgeColor = edgeColorInfo.edgeColors.get(canonicalKey);
              
              if (edgeColor === undefined) continue;  // Edge not in solution (shouldn't happen)
              
              // Calculate the midpoint of the edge
              const midX = (v1.x + v2.x) / 2;
              const midY = (v1.y + v2.y) / 2;
              
              // Calculate direction from cell center to edge midpoint (for half-circle orientation)
              const dirX = midX - cx;
              const dirY = midY - cy;
              const angle = Math.atan2(dirY, dirX);
              
              // Half-circle radius (smaller than hex size for visual clarity)
              const radius = hexSize * 0.25;
              
              halfCircles.push({
                cx: midX,
                cy: midY,
                radius,
                startAngle: angle - Math.PI / 2,
                endAngle: angle + Math.PI / 2,
                filled: edgeColor,
                key: `${q},${r},${edgeIdx}`,
              });
            }
          }
          
          return halfCircles.map(({ cx, cy, radius, startAngle, endAngle, filled, key }) => {
            // Create SVG arc path for half-circle
            // The half-circle "pokes into" the cell from the edge
            const x1 = cx + radius * Math.cos(startAngle);
            const y1 = cy + radius * Math.sin(startAngle);
            const x2 = cx + radius * Math.cos(endAngle);
            const y2 = cy + radius * Math.sin(endAngle);
            
            // Arc path: move to start, arc to end
            const path = `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
            
            return (
              <path
                key={`edgeColor-${key}`}
                d={path}
                fill="none"
                stroke={filled ? "#e74c3c" : "#3498db"}  // Red for filled, blue for empty
                strokeWidth={2}
              />
            );
          });
        })()}
        
        {/* Layer 5: Highlighted edge (bright cyan, thick) */}
        {highlightedEdgeGeometry && (
          <line
            x1={highlightedEdgeGeometry.x1}
            y1={highlightedEdgeGeometry.y1}
            x2={highlightedEdgeGeometry.x2}
            y2={highlightedEdgeGeometry.y2}
            stroke="#00ffff"
            strokeWidth={4}
          />
        )}
      </svg>
    </div>
  );
};
