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
import type { P3TiledGraph } from "./P3TiledGraph";
import { getP3RootColor } from "./P3TiledGraph";
import { getWallpaperGroup } from "./WallpaperGroups";
import type { Direction } from "./WallpaperGroups";

// Selected node in P3 includes hexagon, rhombus, and cell position
interface P3SelectedNode {
  hexRow: number;
  hexCol: number;
  rhombusIdx: number;
  fundamentalRow: number;
  fundamentalCol: number;
}

interface P3RhombusRendererProps {
  length: number;
  multiplier: number;
  cellSize: number;
  parentOf: Map<string, { row: number; col: number } | null>;
  rootRow: number;
  rootCol: number;
  vacantCells: Set<string>;
  wallpaperGroupName: string;
  p3TiledGraph: P3TiledGraph | null;
  // Neighbor highlighting props
  showNeighbors?: boolean;
  selectedNode?: P3SelectedNode | { copyRow: number; copyCol: number; fundamentalRow: number; fundamentalCol: number; hexRow?: number; hexCol?: number; rhombusIdx?: number } | null;
  onCellClick?: (hexRow: number, hexCol: number, rhombusIdx: number, row: number, col: number) => void;
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

// Get the P3 wallpaper group (static, never changes)
const P3_WALLPAPER_GROUP = getWallpaperGroup("P3");

/**
 * Check if there's a parent-child relationship between two cells
 */
function hasParentChildRelationship(
  cellKey: string,
  neighborKey: string,
  parentOf: Map<string, { row: number; col: number } | null>
): boolean {
  const cellParent = parentOf.get(cellKey);
  const neighborParent = parentOf.get(neighborKey);
  
  // Parse cell coordinates
  const [cellRow, cellCol] = cellKey.split(",").map(Number);
  const [neighborRow, neighborCol] = neighborKey.split(",").map(Number);
  
  // Check if neighbor is parent of this cell
  const isParentOfCell = cellParent && 
    cellParent.row === neighborRow && cellParent.col === neighborCol;
  
  // Check if this cell is parent of neighbor
  const isChildOfCell = neighborParent && 
    neighborParent.row === cellRow && neighborParent.col === cellCol;
  
  return !!(isParentOfCell || isChildOfCell);
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
  p3TiledGraph,
  showNeighbors = false,
  selectedNode = null,
  onCellClick,
}: P3RhombusRendererProps) {
  
  // Compute the 4 adjacent neighbor keys for the selected node
  // Each neighbor is identified by (hexRow, hexCol, rhombusIdx, fundamentalRow, fundamentalCol)
  const adjacentNeighborKeys = useMemo(() => {
    if (!showNeighbors || !selectedNode || selectedNode.hexRow === undefined) return new Set<string>();
    
    const { hexRow, hexCol, rhombusIdx, fundamentalRow, fundamentalCol } = selectedNode as P3SelectedNode;
    const neighbors = new Set<string>();
    
    // For each direction, compute the actual adjacent neighbor
    const directions: Array<"N" | "S" | "E" | "W"> = ["N", "S", "E", "W"];
    
    for (const dir of directions) {
      // Get the fundamental neighbor using wallpaper group wrapping
      const neighborFund = P3_WALLPAPER_GROUP.getWrappedNeighbor(fundamentalRow, fundamentalCol, dir, length);
      
      // Check if we're crossing a boundary
      const isNorthBoundary = dir === "N" && fundamentalRow === 0;
      const isSouthBoundary = dir === "S" && fundamentalRow === length - 1;
      const isEastBoundary = dir === "E" && fundamentalCol === length - 1;
      const isWestBoundary = dir === "W" && fundamentalCol === 0;
      
      let neighborHexRow = hexRow;
      let neighborHexCol = hexCol;
      let neighborRhombusIdx = rhombusIdx;
      
      if (isNorthBoundary || isEastBoundary) {
        // These boundaries connect to another rhombus within the SAME hexagon
        // N from R0 goes to R1, E from R0 goes to R2
        // N from R1 goes to R2, E from R1 goes to R0
        // N from R2 goes to R0, E from R2 goes to R1
        if (isNorthBoundary) {
          neighborRhombusIdx = (rhombusIdx + 1) % 3;
        } else { // isEastBoundary
          neighborRhombusIdx = (rhombusIdx + 2) % 3;
        }
      } else if (isSouthBoundary || isWestBoundary) {
        // These boundaries connect to an ADJACENT hexagon
        // The direction depends on which rhombus we're in
        
        if (rhombusIdx === 0) {
          if (isSouthBoundary) {
            // R0 south goes to hex below
            neighborHexRow = hexRow + 1;
            neighborRhombusIdx = 1;
          } else { // isWestBoundary
            // R0 west goes to hex to the left
            neighborHexCol = hexCol - 1;
            if (hexCol % 2 === 1) {
              neighborHexRow = hexRow + 1;
            }
            neighborRhombusIdx = 2;
          }
        } else if (rhombusIdx === 1) {
          if (isSouthBoundary) {
            // R1 south goes to hex above-left
            if (hexCol % 2 === 0) {
              neighborHexRow = hexRow - 1;
            }
            neighborHexCol = hexCol - 1;
            neighborRhombusIdx = 2;
          } else { // isWestBoundary
            // R1 west goes to hex above
            neighborHexRow = hexRow - 1;
            neighborRhombusIdx = 0;
          }
        } else { // rhombusIdx === 2
          if (isSouthBoundary) {
            // R2 south goes to hex to the right
            neighborHexCol = hexCol + 1;
            if (hexCol % 2 === 0) {
              neighborHexRow = hexRow - 1;
            }
            neighborRhombusIdx = 0;
          } else { // isWestBoundary
            // R2 west goes to hex below-right
            if (hexCol % 2 === 1) {
              neighborHexRow = hexRow + 1;
            }
            neighborHexCol = hexCol + 1;
            neighborRhombusIdx = 1;
          }
        }
      }
      
      neighbors.add(`${neighborHexRow},${neighborHexCol},${neighborRhombusIdx},${neighborFund.row},${neighborFund.col}`);
    }
    
    return neighbors;
  }, [showNeighbors, selectedNode, length]);
  
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
          const highlightElements: React.ReactNode[] = [];
          const wallSegments: React.ReactNode[] = [];
          
          // For each cell in the rhombus (fundamental domain)
          for (let row = 0; row < length; row++) {
            for (let col = 0; col < length; col++) {
              const cellKey = `${row},${col}`;
              const isVacant = vacantCells.has(cellKey);
              const isRoot = row === rootRow && col === rootCol;
              
              // Check if this specific node is selected (not all copies)
              const isSelected = showNeighbors && selectedNode && 
                selectedNode.hexRow === hexRow && 
                selectedNode.hexCol === hexCol &&
                selectedNode.rhombusIdx === rhombusIdx &&
                selectedNode.fundamentalRow === row && 
                selectedNode.fundamentalCol === col;
              
              // Check if this specific node is one of the 4 adjacent neighbors
              const nodeKey = `${hexRow},${hexCol},${rhombusIdx},${row},${col}`;
              const isNeighbor = adjacentNeighborKeys.has(nodeKey);
              
              // Determine color using arborescence coloring from p3TiledGraph
              let fillColor = "#e0e0e0";
              if (isVacant) {
                fillColor = "#000";
              } else if (p3TiledGraph) {
                // Get rootIndex from the p3TiledGraph node
                const nodeId = p3TiledGraph.nodeAt.get(nodeKey);
                if (nodeId !== undefined) {
                  const node = p3TiledGraph.nodes[nodeId];
                  fillColor = getP3RootColor(node.rootIndex);
                }
              } else {
                // Fallback: color by rhombus index
                const rhombusColorIndex = hexIndex * 3 + rhombusIdx;
                fillColor = getP3RootColor(rhombusColorIndex);
              }
              
              const path = getCellRhombusPath(row, col, cellSize);
              
              cellElements.push(
                <path
                  key={`cell-${hexIndex}-${rhombusIdx}-${row}-${col}`}
                  d={path}
                  fill={fillColor}
                  stroke="#ccc"
                  strokeWidth={0.5}
                  style={{ cursor: showNeighbors ? "pointer" : "default" }}
                  onClick={() => onCellClick?.(hexRow, hexCol, rhombusIdx, row, col)}
                />
              );
              
              // Highlight selected cell
              if (isSelected) {
                highlightElements.push(
                  <path
                    key={`selected-${hexIndex}-${rhombusIdx}-${row}-${col}`}
                    d={path}
                    fill="none"
                    stroke="#000"
                    strokeWidth={3}
                  />
                );
              }
              
              // Highlight neighbor cells
              if (isNeighbor && !isSelected) {
                highlightElements.push(
                  <path
                    key={`neighbor-${hexIndex}-${rhombusIdx}-${row}-${col}`}
                    d={path}
                    fill="none"
                    stroke="#ff4081"
                    strokeWidth={3}
                    strokeDasharray="4,2"
                  />
                );
              }
              
              // Root indicator (only compute corners when needed)
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
                // Check each direction - add wall if not connected to parent
                const directions: Direction[] = ["N", "S", "E", "W"];
                for (const dir of directions) {
                  const neighbor = P3_WALLPAPER_GROUP.getWrappedNeighbor(row, col, dir, length);
                  const neighborKey = `${neighbor.row},${neighbor.col}`;
                  const neighborIsVacant = vacantCells.has(neighborKey);
                  
                  // Add wall if neighbor is vacant or no parent-child relationship
                  const shouldAddWall = neighborIsVacant || 
                    !hasParentChildRelationship(cellKey, neighborKey, parentOf);
                  
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
              {highlightElements}
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
  }, [length, multiplier, cellSize, rootRow, rootCol, vacantCells, tiledGraph, parentOf, showNeighbors, selectedNode, adjacentNeighborKeys, onCellClick]);

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
