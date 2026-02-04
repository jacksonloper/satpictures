/**
 * P3RhombusRenderer - Renders the P3 wallpaper group solution as sheared rhombi
 * 
 * For P3, we:
 * 1. Shear each square grid into a rhombus (60° parallelogram)
 * 2. Place 3 rhombi rotating around the corner at pre-skew (0, length-1)
 * 3. These 3 rhombi form a hexagon
 * 4. Tile that hexagon in a multiplier × multiplier grid
 */

import { useMemo } from "react";
import type { TiledGraph } from "./TiledGraph";
import { getRootColor } from "./TiledGraph";

interface P3RhombusRendererProps {
  length: number;
  multiplier: number;
  cellSize: number;
  parentOf: Map<string, { row: number; col: number } | null>;
  rootRow: number;
  rootCol: number;
  vacantCells: Set<string>;
  wallpaperGroupName: string;
  tiledGraph: TiledGraph | null;
}

/**
 * For P3, we arrange 3 rhombi around a shared corner to form a hexagon.
 * Each rhombus is a sheared version of the square grid.
 * The shearing transforms a square into a 60° rhombus.
 * 
 * Shear matrix: | 1    cos(60°) |   | 1   0.5 |
 *              | 0    sin(60°) | = | 0   √3/2 |
 * 
 * The rotation point is the corner at pre-skew (0, length-1), which corresponds
 * to post-skew coordinates (length-1 + 0*0.5, 0) = (length-1, 0) times cellSize.
 * Actually, the top-right corner of cell (0, length-1) after shear.
 */

// Helper to get the rhombus path for a cell
function getCellRhombusPath(
  row: number,
  col: number,
  cellSize: number,
): string {
  const shearX = 0.5;
  const shearY = Math.sqrt(3) / 2;
  const baseWidth = cellSize;
  const baseHeight = cellSize * shearY;
  
  // Position of this cell within the rhombus
  const localX = col * baseWidth + row * baseWidth * shearX;
  const localY = row * baseHeight;
  
  // The 4 corners of the cell's rhombus shape
  const corners = [
    { x: 0, y: 0 },
    { x: baseWidth, y: 0 },
    { x: baseWidth + baseWidth * shearX, y: baseHeight },
    { x: baseWidth * shearX, y: baseHeight },
  ];
  
  const offsetCorners = corners.map(c => ({
    x: localX + c.x,
    y: localY + c.y,
  }));
  
  return `M ${offsetCorners[0].x},${offsetCorners[0].y} ` +
    `L ${offsetCorners[1].x},${offsetCorners[1].y} ` +
    `L ${offsetCorners[2].x},${offsetCorners[2].y} ` +
    `L ${offsetCorners[3].x},${offsetCorners[3].y} Z`;
}

/**
 * Calculate the pivot point for P3 rotation.
 * This is the top-right corner of the rhombus (pre-skew coordinate (0, length-1)).
 * After shearing: x = (length-1)*cellSize + 0*cellSize*0.5 + cellSize = length*cellSize
 *                 y = 0
 * Actually, the corner of cell (0, length-1) at its top-right is:
 * x = col*w + row*w*shear + w = (length-1)*w + w = length*w where the shear contribution is 0 for row=0
 * y = 0
 */
function getPivotPoint(length: number, cellSize: number): { x: number; y: number } {
  // Top-right corner of cell (0, length-1) in the fundamental domain.
  // For row=0, col=length-1: 
  //   x = col * cellSize + row * cellSize * shearX + cellSize
  //     = (length-1) * cellSize + 0 + cellSize 
  //     = length * cellSize
  //   y = row * cellSize * shearY = 0
  return { x: length * cellSize, y: 0 };
}

/**
 * Compute the transform for a single rhombus within a hexagon.
 * The hexagon is formed by 3 rhombi rotated 0°, 120°, 240° around the pivot.
 */
function getRhombusTransformInHexagon(
  rhombusIndex: number, // 0, 1, or 2
  length: number,
  cellSize: number,
): string {
  const pivot = getPivotPoint(length, cellSize);
  const rotationAngle = rhombusIndex * 120;
  
  return `rotate(${rotationAngle}, ${pivot.x}, ${pivot.y})`;
}

/**
 * Compute the translation for a hexagon in the tiled grid.
 * Each hexagon is centered at a pivot point and tiles in a hex grid pattern.
 */
function getHexagonTranslation(
  hexRow: number,
  hexCol: number,
  length: number,
  cellSize: number,
): { x: number; y: number } {
  const shearX = 0.5;
  const shearY = Math.sqrt(3) / 2;
  
  // The hexagon has a specific size based on the rhombus dimensions
  // A rhombus spans length*cellSize horizontally (before shear adds more)
  // and length*cellSize*shearY vertically
  
  // For P3, the hexagon formed by 3 rhombi has dimensions:
  // The pivot point is at (length*cellSize, 0)
  // After rotating 3 rhombi around this point, the hexagon's width and height depend on the rhombus shape
  
  // Hexagon spacing: we need to figure out how hexagons tile
  // Each hexagon's center is at the pivot, and hexagons tile in a triangular grid
  
  // For a hexagon tiling, the horizontal spacing is 1.5 * hexagon_width
  // and vertical spacing is sqrt(3) * hexagon_height, with alternating row offset
  
  // Rhombus dimensions: base width + shear offset = length * cellSize * (1 + shearX) = 1.5 * length * cellSize
  const rhombusWidth = length * cellSize * (1 + shearX);
  const rhombusHeight = length * cellSize * shearY;
  
  // Hexagon dimensions (3 rhombi around a point create a hexagon roughly 2x the rhombus extent)
  const hexWidth = 2 * rhombusWidth;
  const hexHeight = 2 * rhombusHeight;
  
  // Hexagonal grid spacing
  const horizSpacing = hexWidth * 0.75;
  const vertSpacing = hexHeight;
  
  const x = hexCol * horizSpacing;
  const y = hexRow * vertSpacing + (hexCol % 2) * (vertSpacing / 2);
  
  return { x, y };
}

export function P3RhombusRenderer({
  length,
  multiplier,
  cellSize,
  parentOf: _parentOf,
  rootRow,
  rootCol,
  vacantCells,
  wallpaperGroupName: _wallpaperGroupName,
  tiledGraph,
}: P3RhombusRendererProps) {
  const shearY = Math.sqrt(3) / 2;
  
  // Calculate pivot point
  const pivot = getPivotPoint(length, cellSize);
  
  // Pre-compute dimensions
  const dimensions = useMemo(() => {
    const rhombusWidth = length * cellSize * 1.5;
    const rhombusHeight = length * cellSize * shearY;
    const hexWidth = 2 * rhombusWidth;
    const hexHeight = 2 * rhombusHeight;
    
    // Total size for the SVG
    const totalWidth = multiplier * hexWidth * 0.75 + hexWidth;
    const totalHeight = multiplier * hexHeight + hexHeight;
    
    return { rhombusWidth, rhombusHeight, hexWidth, hexHeight, totalWidth, totalHeight };
  }, [length, cellSize, multiplier, shearY]);

  // Generate all the cells for each hexagon
  const hexagonElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    
    // For each hexagon in the multiplier × multiplier grid
    for (let hexRow = 0; hexRow < multiplier; hexRow++) {
      for (let hexCol = 0; hexCol < multiplier; hexCol++) {
        const hexIndex = hexRow * multiplier + hexCol;
        const hexTranslation = getHexagonTranslation(hexRow, hexCol, length, cellSize);
        
        // Each hexagon contains 3 rhombi
        const rhombiElements: React.ReactNode[] = [];
        
        for (let rhombusIdx = 0; rhombusIdx < 3; rhombusIdx++) {
          const rhombusTransform = getRhombusTransformInHexagon(rhombusIdx, length, cellSize);
          const cellElements: React.ReactNode[] = [];
          
          // For each cell in the rhombus (fundamental domain)
          for (let row = 0; row < length; row++) {
            for (let col = 0; col < length; col++) {
              const cellKey = `${row},${col}`;
              const isVacant = vacantCells.has(cellKey);
              const isRoot = row === rootRow && col === rootCol;
              
              // Determine color based on hexagon and rhombus position
              // Each hexagon contains 3 rhombi (rhombusIdx 0, 1, 2)
              // Use unique color per rhombus for visual distinction
              const rhombusColorIndex = hexIndex * 3 + rhombusIdx;
              
              let fillColor = "#e0e0e0";
              if (isVacant) {
                fillColor = "#000";
              } else if (tiledGraph) {
                // Try to find matching node in tiled graph
                // Note: The tiled graph structure may not directly map to hexagon/rhombus indices
                // For now, use rhombus color index as primary coloring
                fillColor = getRootColor(rhombusColorIndex);
              } else {
                // Color by rhombus index when no tiled graph
                fillColor = getRootColor(rhombusColorIndex);
              }
              
              const path = getCellRhombusPath(row, col, cellSize);
              
              cellElements.push(
                <path
                  key={`cell-${hexIndex}-${rhombusIdx}-${row}-${col}`}
                  d={path}
                  fill={fillColor}
                  stroke="#888"
                  strokeWidth={0.5}
                />
              );
              
              // Root indicator
              if (isRoot && !isVacant) {
                const shearX = 0.5;
                const cx = col * cellSize + row * cellSize * shearX + cellSize * 0.75;
                const cy = row * cellSize * shearY + cellSize * shearY / 2;
                
                cellElements.push(
                  <circle
                    key={`root-${hexIndex}-${rhombusIdx}-${row}-${col}`}
                    cx={cx}
                    cy={cy}
                    r={cellSize / 6}
                    fill="#000"
                  />
                );
              }
            }
          }
          
          // Wrap cells in a group with the rhombus rotation transform
          rhombiElements.push(
            <g key={`rhombus-${hexIndex}-${rhombusIdx}`} transform={rhombusTransform}>
              {cellElements}
            </g>
          );
        }
        
        // Wrap all 3 rhombi in a group with the hexagon translation
        elements.push(
          <g 
            key={`hexagon-${hexIndex}`} 
            transform={`translate(${hexTranslation.x}, ${hexTranslation.y})`}
          >
            {rhombiElements}
          </g>
        );
      }
    }
    
    return elements;
  }, [length, multiplier, cellSize, rootRow, rootCol, vacantCells, tiledGraph, shearY, pivot]);

  const padding = 40;

  return (
    <svg 
      width={dimensions.totalWidth + padding * 2} 
      height={dimensions.totalHeight + padding * 2}
      style={{ border: "1px solid #ccc" }}
    >
      <g transform={`translate(${padding}, ${padding})`}>
        {hexagonElements}
      </g>
    </svg>
  );
}
