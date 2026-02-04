/**
 * P3RhombusRenderer - Renders the P3 wallpaper group solution as sheared rhombi
 * 
 * For P3, we:
 * 1. Shear each square grid into a rhombus (60° parallelogram)
 * 2. Place 3 rhombi rotating around the corner at pre-skew (0, length-1)
 * 3. These 3 rhombi form a hexagon
 * 4. Tile that hexagon in a multiplier × multiplier grid
 * 5. Render maze walls based on parent relationships
 */

import { useMemo } from "react";
import type { TiledGraph } from "./TiledGraph";
import { getRootColor } from "./TiledGraph";
import { getWallpaperGroup } from "./WallpaperGroups";
import type { Direction } from "./WallpaperGroups";

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

// Shear constants
const SHEAR_X = 0.5;  // cos(60°)
const SHEAR_Y = Math.sqrt(3) / 2;  // sin(60°)

/**
 * Get the 4 corners of a cell in the sheared grid (local coordinates)
 */
function getCellCorners(row: number, col: number, cellSize: number) {
  const baseWidth = cellSize;
  const baseHeight = cellSize * SHEAR_Y;
  
  // Position of this cell's top-left corner
  const localX = col * baseWidth + row * baseWidth * SHEAR_X;
  const localY = row * baseHeight;
  
  return {
    topLeft: { x: localX, y: localY },
    topRight: { x: localX + baseWidth, y: localY },
    bottomRight: { x: localX + baseWidth + baseWidth * SHEAR_X, y: localY + baseHeight },
    bottomLeft: { x: localX + baseWidth * SHEAR_X, y: localY + baseHeight },
  };
}

/**
 * Get the path for a cell rhombus
 */
function getCellRhombusPath(row: number, col: number, cellSize: number): string {
  const corners = getCellCorners(row, col, cellSize);
  return `M ${corners.topLeft.x},${corners.topLeft.y} ` +
    `L ${corners.topRight.x},${corners.topRight.y} ` +
    `L ${corners.bottomRight.x},${corners.bottomRight.y} ` +
    `L ${corners.bottomLeft.x},${corners.bottomLeft.y} Z`;
}

/**
 * Get the wall segment for a cell edge in a specific direction
 */
function getWallSegment(
  row: number, 
  col: number, 
  direction: Direction, 
  cellSize: number
): { x1: number; y1: number; x2: number; y2: number } {
  const corners = getCellCorners(row, col, cellSize);
  
  switch (direction) {
    case "N": // Top edge: topLeft to topRight
      return { 
        x1: corners.topLeft.x, y1: corners.topLeft.y,
        x2: corners.topRight.x, y2: corners.topRight.y 
      };
    case "E": // Right edge: topRight to bottomRight
      return { 
        x1: corners.topRight.x, y1: corners.topRight.y,
        x2: corners.bottomRight.x, y2: corners.bottomRight.y 
      };
    case "S": // Bottom edge: bottomLeft to bottomRight
      return { 
        x1: corners.bottomLeft.x, y1: corners.bottomLeft.y,
        x2: corners.bottomRight.x, y2: corners.bottomRight.y 
      };
    case "W": // Left edge: topLeft to bottomLeft
      return { 
        x1: corners.topLeft.x, y1: corners.topLeft.y,
        x2: corners.bottomLeft.x, y2: corners.bottomLeft.y 
      };
  }
}

/**
 * Calculate the pivot point for P3 rotation.
 * This is the top-right corner of cell (0, length-1).
 */
function getPivotPoint(length: number, cellSize: number): { x: number; y: number } {
  return { x: length * cellSize, y: 0 };
}

/**
 * Compute the transform for a single rhombus within a hexagon.
 */
function getRhombusTransformInHexagon(
  rhombusIndex: number,
  length: number,
  cellSize: number,
): string {
  const pivot = getPivotPoint(length, cellSize);
  const rotationAngle = rhombusIndex * 120;
  return `rotate(${rotationAngle}, ${pivot.x}, ${pivot.y})`;
}

/**
 * Compute the translation for a hexagon in the tiled grid.
 * Each hexagon is formed by 3 rhombi and tiles in a specific pattern.
 */
function getHexagonTranslation(
  hexRow: number,
  hexCol: number,
  length: number,
  cellSize: number,
): { x: number; y: number } {
  // The rhombus has specific dimensions after shearing
  const rhombusWidth = length * cellSize * (1 + SHEAR_X);  // = 1.5 * length * cellSize
  const rhombusHeight = length * cellSize * SHEAR_Y;
  
  // For proper hexagon tiling:
  // - The hexagon formed by 3 rhombi shares edges with adjacent hexagons
  // - Horizontal spacing: rhombi share their slanted edges
  // - Vertical spacing: based on the hexagon height
  
  // The horizontal spacing should be exactly rhombusWidth (the full rhombus)
  // because each hexagon takes up rhombusWidth in a single direction before rotating
  const horizSpacing = rhombusWidth;
  const vertSpacing = 2 * rhombusHeight;
  
  // Offset for odd columns (hex grid staggering)
  const x = hexCol * horizSpacing;
  const y = hexRow * vertSpacing + (hexCol % 2) * rhombusHeight;
  
  return { x, y };
}

export function P3RhombusRenderer({
  length,
  multiplier,
  cellSize,
  parentOf,
  rootRow,
  rootCol,
  vacantCells,
  wallpaperGroupName: _wallpaperGroupName,
  tiledGraph,
}: P3RhombusRendererProps) {
  const wpg = getWallpaperGroup("P3");
  
  // Pre-compute dimensions
  const dimensions = useMemo(() => {
    const rhombusWidth = length * cellSize * (1 + SHEAR_X);
    const rhombusHeight = length * cellSize * SHEAR_Y;
    const hexWidth = rhombusWidth;
    const hexHeight = 2 * rhombusHeight;
    
    // Total size for the SVG
    const totalWidth = (multiplier + 1) * hexWidth;
    const totalHeight = (multiplier + 1) * hexHeight;
    
    return { rhombusWidth, rhombusHeight, hexWidth, hexHeight, totalWidth, totalHeight };
  }, [length, cellSize, multiplier]);

  // Generate all the cells and walls for each hexagon
  const { hexagonElements, wallElements } = useMemo(() => {
    const hexElements: React.ReactNode[] = [];
    const walls: React.ReactNode[] = [];
    
    // For each hexagon in the multiplier × multiplier grid
    for (let hexRow = 0; hexRow < multiplier; hexRow++) {
      for (let hexCol = 0; hexCol < multiplier; hexCol++) {
        const hexIndex = hexRow * multiplier + hexCol;
        const hexTranslation = getHexagonTranslation(hexRow, hexCol, length, cellSize);
        
        // Each hexagon contains 3 rhombi
        const rhombiElements: React.ReactNode[] = [];
        const rhombiWalls: React.ReactNode[] = [];
        
        for (let rhombusIdx = 0; rhombusIdx < 3; rhombusIdx++) {
          const rhombusTransform = getRhombusTransformInHexagon(rhombusIdx, length, cellSize);
          const cellElements: React.ReactNode[] = [];
          const wallSegments: React.ReactNode[] = [];
          
          // For each cell in the rhombus (fundamental domain)
          for (let row = 0; row < length; row++) {
            for (let col = 0; col < length; col++) {
              const cellKey = `${row},${col}`;
              const isVacant = vacantCells.has(cellKey);
              const isRoot = row === rootRow && col === rootCol;
              
              // Determine color
              const rhombusColorIndex = hexIndex * 3 + rhombusIdx;
              let fillColor = "#e0e0e0";
              if (isVacant) {
                fillColor = "#000";
              } else if (tiledGraph) {
                fillColor = getRootColor(rhombusColorIndex);
              } else {
                fillColor = getRootColor(rhombusColorIndex);
              }
              
              const path = getCellRhombusPath(row, col, cellSize);
              
              cellElements.push(
                <path
                  key={`cell-${hexIndex}-${rhombusIdx}-${row}-${col}`}
                  d={path}
                  fill={fillColor}
                  stroke="#ccc"
                  strokeWidth={0.5}
                />
              );
              
              // Root indicator
              if (isRoot && !isVacant) {
                const corners = getCellCorners(row, col, cellSize);
                const cx = (corners.topLeft.x + corners.bottomRight.x) / 2;
                const cy = (corners.topLeft.y + corners.bottomRight.y) / 2;
                
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
              
              // Add maze walls based on parent relationships
              if (!isVacant) {
                const parent = parentOf.get(cellKey);
                
                // Check each direction - add wall if not connected to parent
                const directions: Direction[] = ["N", "S", "E", "W"];
                for (const dir of directions) {
                  const neighbor = wpg.getWrappedNeighbor(row, col, dir, length);
                  const neighborKey = `${neighbor.row},${neighbor.col}`;
                  const neighborIsVacant = vacantCells.has(neighborKey);
                  
                  // Add wall if:
                  // 1. Neighbor is vacant, OR
                  // 2. This cell is not root and parent is not in this direction, AND
                  //    The neighbor is not this cell's child (neighbor's parent is not this cell)
                  let shouldAddWall = false;
                  
                  if (neighborIsVacant) {
                    shouldAddWall = true;
                  } else {
                    // Check if this is a passage (either direction is parent-child)
                    const isParentOfThis = parent && 
                      parent.row === neighbor.row && parent.col === neighbor.col;
                    const neighborParent = parentOf.get(neighborKey);
                    const isChildOfThis = neighborParent && 
                      neighborParent.row === row && neighborParent.col === col;
                    
                    // Wall exists if no parent-child relationship in either direction
                    shouldAddWall = !isParentOfThis && !isChildOfThis;
                  }
                  
                  if (shouldAddWall) {
                    const segment = getWallSegment(row, col, dir, cellSize);
                    wallSegments.push(
                      <line
                        key={`wall-${hexIndex}-${rhombusIdx}-${row}-${col}-${dir}`}
                        x1={segment.x1}
                        y1={segment.y1}
                        x2={segment.x2}
                        y2={segment.y2}
                        stroke="#000"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    );
                  }
                }
              }
            }
          }
          
          // Wrap cells in a group with the rhombus rotation transform
          rhombiElements.push(
            <g key={`rhombus-cells-${hexIndex}-${rhombusIdx}`} transform={rhombusTransform}>
              {cellElements}
            </g>
          );
          
          // Wrap walls separately (rendered on top of all cells)
          rhombiWalls.push(
            <g key={`rhombus-walls-${hexIndex}-${rhombusIdx}`} transform={rhombusTransform}>
              {wallSegments}
            </g>
          );
        }
        
        // Wrap all 3 rhombi in a group with the hexagon translation
        hexElements.push(
          <g 
            key={`hexagon-${hexIndex}`} 
            transform={`translate(${hexTranslation.x}, ${hexTranslation.y})`}
          >
            {rhombiElements}
          </g>
        );
        
        walls.push(
          <g 
            key={`hexagon-walls-${hexIndex}`} 
            transform={`translate(${hexTranslation.x}, ${hexTranslation.y})`}
          >
            {rhombiWalls}
          </g>
        );
      }
    }
    
    return { hexagonElements: hexElements, wallElements: walls };
  }, [length, multiplier, cellSize, rootRow, rootCol, vacantCells, tiledGraph, parentOf, wpg]);

  const padding = 60;

  return (
    <svg 
      width={dimensions.totalWidth + padding * 2} 
      height={dimensions.totalHeight + padding * 2}
      style={{ border: "1px solid #ccc" }}
    >
      <g transform={`translate(${padding}, ${padding})`}>
        {/* First layer: cells */}
        {hexagonElements}
        {/* Second layer: walls on top */}
        {wallElements}
      </g>
    </svg>
  );
}
