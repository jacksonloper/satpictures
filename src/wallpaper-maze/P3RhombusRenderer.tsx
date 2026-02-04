/**
 * P3RhombusRenderer - Renders the P3 wallpaper group solution as sheared rhombi
 * 
 * For P3, we:
 * 1. Shear each square grid into a rhombus (60° parallelogram)
 * 2. Place copies with 0°, 120°, and 240° rotations to tile
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
 * For P3, we arrange copies in a triangular/hexagonal pattern.
 * Each rhombus is a sheared version of the square grid.
 * The shearing transforms a square into a 60° rhombus.
 * 
 * Shear matrix: | 1    cos(60°) |   | 1   0.5 |
 *              | 0    sin(60°) | = | 0   √3/2 |
 */

// Helper to get the rhombus vertices for a cell within a fundamental domain copy
function getCellRhombusPath(
  row: number,
  col: number,
  _length: number,
  cellSize: number,
): string {
  // Calculate the shear transformation for a 60° rhombus
  const shearX = 0.5;  // cos(60°)
  const shearY = Math.sqrt(3) / 2;  // sin(60°)
  
  // Size of one cell in the sheared grid
  const baseWidth = cellSize;
  const baseHeight = cellSize * shearY;
  
  // Position of this cell within the rhombus (before rotation)
  // In a sheared grid: x' = col + row * shearX, y' = row * shearY
  const localX = col * baseWidth + row * baseWidth * shearX;
  const localY = row * baseHeight;
  
  // The 4 corners of the cell's rhombus shape
  const corners = [
    { x: 0, y: 0 },
    { x: baseWidth, y: 0 },
    { x: baseWidth + baseWidth * shearX, y: baseHeight },
    { x: baseWidth * shearX, y: baseHeight },
  ];
  
  // Apply local cell offset
  const offsetCorners = corners.map(c => ({
    x: localX + c.x,
    y: localY + c.y,
  }));
  
  // Build path
  return `M ${offsetCorners[0].x},${offsetCorners[0].y} ` +
    `L ${offsetCorners[1].x},${offsetCorners[1].y} ` +
    `L ${offsetCorners[2].x},${offsetCorners[2].y} ` +
    `L ${offsetCorners[3].x},${offsetCorners[3].y} Z`;
}

/**
 * Compute the transform for positioning and rotating each copy
 */
function getCopyTransform(
  copyRow: number,
  copyCol: number,
  length: number,
  cellSize: number,
): string {
  const shearX = 0.5;
  const shearY = Math.sqrt(3) / 2;
  const baseWidth = cellSize;
  const baseHeight = cellSize * shearY;
  
  // Size of one rhombus (fundamental domain) in sheared coordinates
  // The rhombus spans from (0,0) to (length*baseWidth + length*baseWidth*shearX, length*baseHeight)
  const rhombusActualWidth = length * baseWidth + length * baseWidth * shearX;
  const rhombusHeight = length * baseHeight;
  
  // Rotation angle based on position: (copyRow + copyCol) % 3 determines the type
  const type = ((copyRow + copyCol) % 3 + 3) % 3;
  const rotationAngle = type * 120;
  
  // For proper P3 tiling, we need to place rhombi in a pattern where
  // each rotated copy meets edges of adjacent copies
  
  // Calculate the center of the rhombus for rotation
  const centerX = rhombusActualWidth / 2;
  const centerY = rhombusHeight / 2;
  
  // For P3 tiling: copies are arranged so that 3 copies meet at vertices
  // The positioning follows a triangular grid pattern
  
  // For each copy, compute base position
  // The overlap factor (2/3) accounts for rhombus overlap in P3 tiling:
  // adjacent rhombi share approximately 1/3 of their width when rotated
  const P3_OVERLAP_FACTOR = 2 / 3;
  const posX = copyCol * rhombusActualWidth * P3_OVERLAP_FACTOR;
  const posY = copyRow * rhombusHeight + (copyCol % 2) * (rhombusHeight / 2);
  
  // Transform: translate to position, then rotate around center
  return `translate(${posX}, ${posY}) rotate(${rotationAngle}, ${centerX}, ${centerY})`;
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
  // Pre-compute the rhombus dimensions
  const dimensions = useMemo(() => {
    const shearX = 0.5;
    const shearY = Math.sqrt(3) / 2;
    const baseWidth = cellSize;
    const baseHeight = cellSize * shearY;
    
    // Rhombus dimensions with shear
    const rhombusActualWidth = length * baseWidth + length * baseWidth * shearX;
    const rhombusHeight = length * baseHeight;
    
    // Total SVG size to fit all copies with rotation
    // Account for rotated copies which might extend beyond base positions
    const totalWidth = (multiplier + 1) * rhombusActualWidth;
    const totalHeight = (multiplier + 1) * rhombusHeight;
    
    return {
      shearX,
      shearY,
      baseWidth,
      baseHeight,
      rhombusActualWidth,
      rhombusHeight,
      totalWidth,
      totalHeight,
    };
  }, [length, cellSize, multiplier]);

  // Generate all the cells for each copy
  const copyElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    
    for (let copyRow = 0; copyRow < multiplier; copyRow++) {
      for (let copyCol = 0; copyCol < multiplier; copyCol++) {
        const copyIndex = copyRow * multiplier + copyCol;
        
        // Render cells for this copy
        const cellElements: React.ReactNode[] = [];
        
        for (let row = 0; row < length; row++) {
          for (let col = 0; col < length; col++) {
            const cellKey = `${row},${col}`;
            const isVacant = vacantCells.has(cellKey);
            const isRoot = row === rootRow && col === rootCol;
            
            // Determine color based on root connection from tiledGraph
            let fillColor = "#e0e0e0";
            if (isVacant) {
              fillColor = "#000";
            } else if (tiledGraph) {
              // Find the corresponding node in tiledGraph
              const node = tiledGraph.nodes.find(
                n => n.copyRow === copyRow && 
                     n.copyCol === copyCol && 
                     n.fundamentalRow === row && 
                     n.fundamentalCol === col
              );
              if (node) {
                fillColor = getRootColor(node.rootIndex);
              }
            }
            
            // Calculate path for this cell
            const path = getCellRhombusPath(row, col, length, cellSize);
            
            cellElements.push(
              <path
                key={`cell-${copyIndex}-${row}-${col}`}
                d={path}
                fill={fillColor}
                stroke="#888"
                strokeWidth={0.5}
              />
            );
            
            // Root indicator
            if (isRoot && !isVacant) {
              const shearX = 0.5;
              const shearY = Math.sqrt(3) / 2;
              const cx = col * cellSize + row * cellSize * shearX + cellSize * 0.75;
              const cy = row * cellSize * shearY + cellSize * shearY / 2;
              
              cellElements.push(
                <circle
                  key={`root-${copyIndex}-${row}-${col}`}
                  cx={cx}
                  cy={cy}
                  r={cellSize / 6}
                  fill="#000"
                />
              );
            }
          }
        }
        
        // Get transform for this copy
        const transform = getCopyTransform(copyRow, copyCol, length, cellSize);
        
        elements.push(
          <g key={`copy-${copyIndex}`} transform={transform}>
            {cellElements}
          </g>
        );
      }
    }
    
    return elements;
  }, [length, multiplier, cellSize, rootRow, rootCol, vacantCells, tiledGraph]);

  const padding = 20;

  return (
    <svg 
      width={dimensions.totalWidth + padding * 2} 
      height={dimensions.totalHeight + padding * 2}
      style={{ border: "1px solid #ccc" }}
    >
      <g transform={`translate(${padding}, ${padding})`}>
        {copyElements}
      </g>
    </svg>
  );
}
