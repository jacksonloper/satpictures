import React, { useCallback, useMemo, useState } from "react";
import type { ColorGrid, GridSolution, GridType } from "../solver";
import { HATCH_COLOR, RED_DOT_COLOR, RED_HATCH_COLOR } from "../solver";
import {
  COLORS,
  HATCH_BG_COLOR,
  BLANK_COLOR,
  WALL_COLOR,
  DEFAULT_WALL_THICKNESS,
  getHexDimensions,
  getHexNeighbors,
  createHexPath,
  getHexCenter,
  getHexWallSegment,
  getOctagonDimensions,
  createOctagonPath,
  getCairoTile,
  getCairoNeighborsWithDirection,
  getCairoBridgeNeighborsWithDirection,
  findSharedEdge,
  createCairoTransformer,
  polyCentroid,
  calculateGridDimensions,
} from "./gridConstants";

// Re-export color constants for convenience
export { HATCH_COLOR, RED_DOT_COLOR, RED_HATCH_COLOR };
// Re-export COLORS for components that need it
export { COLORS };

// Blank cell appearance
const BLANK_PATTERN = `repeating-linear-gradient(
  45deg,
  #e0e0e0,
  #e0e0e0 2px,
  #f5f5f5 2px,
  #f5f5f5 8px
)`;

// Hatch cell appearance - crosshatch pattern on yellow background
const HATCH_PATTERN = `repeating-linear-gradient(
  45deg,
  #ff9800,
  #ff9800 2px,
  transparent 2px,
  transparent 8px
),
repeating-linear-gradient(
  -45deg,
  #ff9800,
  #ff9800 2px,
  transparent 2px,
  transparent 8px
),
${HATCH_BG_COLOR}`;

// Red with dot appearance - red background with a white dot (origin for bounded reachability)
const RED_DOT_BG_COLOR = "#e74c3c"; // red
const RED_DOT_PATTERN = `radial-gradient(circle at center, white 4px, transparent 4px), #e74c3c`;

// Red with hatch appearance - red background with crosshatch pattern
const RED_HATCH_BG_COLOR = "#e74c3c"; // red
const RED_HATCH_PATTERN = `repeating-linear-gradient(
  45deg,
  rgba(255, 255, 255, 0.5),
  rgba(255, 255, 255, 0.5) 2px,
  transparent 2px,
  transparent 8px
),
repeating-linear-gradient(
  -45deg,
  rgba(255, 255, 255, 0.5),
  rgba(255, 255, 255, 0.5) 2px,
  transparent 2px,
  transparent 8px
),
#e74c3c`;

interface GridProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  selectedColor: number | null;
  onCellClick: (row: number, col: number) => void;
  onCellDrag: (row: number, col: number) => void;
  cellSize?: number;
  gridType?: GridType;
  viewMode?: "sketchpad" | "solution";
  showReachabilityLevels?: boolean;
}

export const Grid: React.FC<GridProps> = ({
  grid,
  solution,
  selectedColor: _selectedColor,
  onCellClick,
  onCellDrag,
  cellSize = 40,
  gridType = "square",
  viewMode = "sketchpad",
  showReachabilityLevels = false,
}) => {
  // selectedColor is used by parent for painting, not needed here directly
  void _selectedColor;
  const [isDragging, setIsDragging] = useState(false);

  // Determine if we should show solution colors (when viewing solution mode and solution exists)
  const showSolutionColors = viewMode === "solution" && solution !== null;

  // Create a set of kept edge keys for quick lookup
  const keptEdgeSet = useMemo(() => {
    const set = new Set<string>();
    if (solution) {
      for (const edge of solution.keptEdges) {
        // Store both directions for easy lookup
        set.add(`${edge.u.row},${edge.u.col}-${edge.v.row},${edge.v.col}`);
        set.add(`${edge.v.row},${edge.v.col}-${edge.u.row},${edge.u.col}`);
      }
    }
    return set;
  }, [solution]);

  const handleMouseDown = useCallback(
    (row: number, col: number) => {
      setIsDragging(true);
      onCellClick(row, col);
    },
    [onCellClick]
  );

  const handleMouseEnter = useCallback(
    (row: number, col: number) => {
      if (isDragging) {
        onCellDrag(row, col);
      }
    },
    [isDragging, onCellDrag]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Check if there should be a wall between two adjacent cells
  const hasWall = useCallback(
    (r1: number, c1: number, r2: number, c2: number): boolean => {
      if (!solution) {
        // No solution yet - don't show any internal walls
        // Only show walls at grid boundary
        return !(r2 >= 0 && r2 < grid.height && c2 >= 0 && c2 < grid.width);
      }
      // With solution - check if edge is kept (no wall) or blocked (wall)
      const key = `${r1},${c1}-${r2},${c2}`;
      return !keptEdgeSet.has(key);
    },
    [solution, keptEdgeSet, grid]
  );

  const wallThickness = DEFAULT_WALL_THICKNESS;
  
  // Hex grid calculations
  const { hexSize, hexWidth, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);

  // Octagon grid calculations
  const { octInset, octBandWidth } = getOctagonDimensions(cellSize);
  
  // Calculate total dimensions based on grid type
  const { totalWidth, totalHeight } = calculateGridDimensions(
    grid.width,
    grid.height,
    cellSize,
    gridType,
    wallThickness
  );

  // For hex grid, we use SVG
  if (gridType === "hex") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;
    
    // Pre-compute all hex data
    const hexData: {
      row: number;
      col: number;
      cx: number;
      cy: number;
      path: string;
      fill: string;
      isBlank: boolean;
      isHatch: boolean;
      walls: { x1: number; y1: number; x2: number; y2: number }[];
      reachLevel: number | null;
    }[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const inputColor = grid.colors[row][col];
        // In solution view mode, always show solution colors
        // In sketchpad mode, always show user colors (inputColor), even if null
        const displayColor = showSolutionColors
          ? solution!.assignedColors[row][col]
          : inputColor;
        const isBlank = inputColor === null && !showSolutionColors;
        const isHatch = displayColor === HATCH_COLOR;
        const isRedDot = displayColor === RED_DOT_COLOR;
        const isRedHatch = displayColor === RED_HATCH_COLOR;
        
        let fill: string;
        if (isBlank) {
          fill = "url(#blankPattern)";
        } else if (isHatch) {
          fill = "url(#hatchPattern)";
        } else if (isRedDot) {
          fill = "url(#redDotPattern)";
        } else if (isRedHatch) {
          fill = "url(#redHatchPattern)";
        } else {
          fill = COLORS[(displayColor ?? 0) % COLORS.length];
        }

        // Calculate hex center position - for pointy-topped, odd rows are offset right
        const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
        
        const path = createHexPath(cx, cy, hexSize);

        // Check for walls to neighbors
        const neighbors = getHexNeighbors(row, col);
        const walls: { x1: number; y1: number; x2: number; y2: number }[] = [];
        
        for (const [nRow, nCol, direction] of neighbors) {
          // Skip walls to out-of-bounds neighbors (boundary)
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          if (hasWall(row, col, nRow, nCol)) {
            const segment = getHexWallSegment(direction, cx, cy, hexSize);
            if (segment) {
              walls.push(segment);
            }
          }
        }
        
        // Get reachability level if available
        const reachLevel = showReachabilityLevels && solution?.reachabilityLevels 
          ? solution.reachabilityLevels[row][col] 
          : null;
        
        hexData.push({ row, col, cx, cy, path, fill, isBlank, isHatch, walls, reachLevel });
      }
    }
    
    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
            <pattern id="redDotPattern" patternUnits="userSpaceOnUse" width="20" height="20">
              <rect width="20" height="20" fill="#e74c3c"/>
              <circle cx="10" cy="10" r="4" fill="white"/>
            </pattern>
            <pattern id="redHatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#e74c3c"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* First pass: render all hex fills */}
          {hexData.map(({ row, col, path, fill }) => (
            <path
              key={`fill-${row}-${col}`}
              d={path}
              fill={fill}
              stroke="none"
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Second pass: render all walls on top */}
          {hexData.flatMap(({ row, col, walls }) =>
            walls.map((wall, i) => (
              <line
                key={`wall-${row}-${col}-${i}`}
                x1={wall.x1}
                y1={wall.y1}
                x2={wall.x2}
                y2={wall.y2}
                stroke={WALL_COLOR}
                strokeWidth={wallThickness}
                strokeLinecap="round"
              />
            ))
          )}
          
          {/* Third pass: render reachability levels on top of everything */}
          {hexData.map(({ row, col, cx, cy, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
        </svg>
      </div>
    );
  }

  // Octagon grid rendering
  if (gridType === "octagon") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;

    // Helper to get color for a cell
    const getCellColor = (row: number, col: number): string => {
      const inputColor = grid.colors[row][col];
      // In solution view mode, always show solution colors
      // In sketchpad mode, always show user colors (inputColor), even if null
      const displayColor = showSolutionColors
        ? solution!.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !showSolutionColors;
      const isHatch = displayColor === HATCH_COLOR;
      const isRedDot = displayColor === RED_DOT_COLOR;
      const isRedHatch = displayColor === RED_HATCH_COLOR;
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
      } else if (isRedDot) {
        return "url(#redDotPattern)";
      } else if (isRedHatch) {
        return "url(#redHatchPattern)";
      } else {
        return COLORS[(displayColor ?? 0) % COLORS.length];
      }
    };

    // Pre-compute all octagon data
    interface OctData {
      row: number;
      col: number;
      cx: number;
      cy: number;
      path: string;
      fill: string;
      reachLevel: number | null;
    }
    
    const octData: OctData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = padding + cellSize / 2 + col * cellSize;
        const cy = padding + cellSize / 2 + row * cellSize;
        const path = createOctagonPath(cx, cy, cellSize, octInset);
        const fill = getCellColor(row, col);
        
        // Get reachability level if available
        const reachLevel = showReachabilityLevels && solution?.reachabilityLevels 
          ? solution.reachabilityLevels[row][col] 
          : null;

        octData.push({ row, col, cx, cy, path, fill, reachLevel });
      }
    }

    // Pre-compute diagonal bands at intersection points
    // Each intersection (where 4 octagons meet) has two crossing bands:
    // - Down-slant band connects top-left cell to bottom-right cell (NW-SE direction)
    // - Up-slant band connects top-right cell to bottom-left cell (NE-SW direction)
    // Down-slanting bands render beneath, up-slanting bands render on top
    interface DiagonalBand {
      path: string;
      fill: string;
    }
    
    interface UpSlantBand {
      path: string;
      fill: string;
      // Long edges for outline (only for up-slant bands)
      edge1: { x1: number; y1: number; x2: number; y2: number };
      edge2: { x1: number; y1: number; x2: number; y2: number };
    }
    
    const downSlantBands: DiagonalBand[] = [];
    const upSlantBands: UpSlantBand[] = [];
    
    // Iterate over intersection points (corners where 4 cells meet)
    // Intersection at (iRow, iCol) is between cells:
    //   top-left: (iRow-1, iCol-1), top-right: (iRow-1, iCol)
    //   bottom-left: (iRow, iCol-1), bottom-right: (iRow, iCol)
    for (let iRow = 1; iRow < grid.height; iRow++) {
      for (let iCol = 1; iCol < grid.width; iCol++) {
        // Center of the small square gap at this intersection
        const ix = padding + iCol * cellSize;
        const iy = padding + iRow * cellSize;
        
        // The gap forms a small square. Its corners are at the octagon vertices.
        // For truncated square tiling, the gap has size 2*octInset on each side.
        const gapHalf = octInset; // Half the gap size
        
        // Cell coordinates for the 4 adjacent cells
        const tlRow = iRow - 1, tlCol = iCol - 1; // top-left
        const trRow = iRow - 1, trCol = iCol;     // top-right  
        const blRow = iRow, blCol = iCol - 1;     // bottom-left
        const brRow = iRow, brCol = iCol;         // bottom-right
        
        // Down-slant band: connects top-left to bottom-right
        // This band runs from NW to SE through the gap
        // Only draw the band if there's a passage (not a wall)
        const downSlantWall = hasWall(tlRow, tlCol, brRow, brCol);
        
        if (!downSlantWall) {
          const downSlantFill = getCellColor(tlRow, tlCol);
          
          // Band spans from top-left corner to bottom-right corner of the gap
          // Band width is octBandWidth, centered on the diagonal
          const halfBand = octBandWidth / 2;
          // Down-slant diagonal goes from (-gapHalf, -gapHalf) to (gapHalf, gapHalf)
          // Perpendicular direction is (1, -1) normalized
          const downPerpX = halfBand * Math.SQRT1_2;
          const downPerpY = halfBand * Math.SQRT1_2;
          const downPath = `M ${ix - gapHalf + downPerpX} ${iy - gapHalf - downPerpY} ` +
                          `L ${ix - gapHalf - downPerpX} ${iy - gapHalf + downPerpY} ` +
                          `L ${ix + gapHalf - downPerpX} ${iy + gapHalf + downPerpY} ` +
                          `L ${ix + gapHalf + downPerpX} ${iy + gapHalf - downPerpY} Z`;
          downSlantBands.push({ path: downPath, fill: downSlantFill });
        }
        
        // Up-slant band: connects top-right to bottom-left
        // This band runs from NE to SW through the gap
        // Only draw the band if there's a passage (not a wall)
        const upSlantWall = hasWall(trRow, trCol, blRow, blCol);
        
        if (!upSlantWall) {
          const upSlantFill = getCellColor(trRow, trCol);
          
          // Band spans from top-right corner to bottom-left corner of the gap
          // Up-slant diagonal goes from (gapHalf, -gapHalf) to (-gapHalf, gapHalf)
          // Perpendicular direction is (1, 1) normalized
          const halfBand = octBandWidth / 2;
          const upPerpX = halfBand * Math.SQRT1_2;
          const upPerpY = halfBand * Math.SQRT1_2;
          
          // The four corners of the band (clockwise from top-right outer edge)
          // Corner 1: top-right, outer (toward NE)
          const c1x = ix + gapHalf + upPerpX, c1y = iy - gapHalf + upPerpY;
          // Corner 2: top-right, inner (toward center)
          const c2x = ix + gapHalf - upPerpX, c2y = iy - gapHalf - upPerpY;
          // Corner 3: bottom-left, inner (toward center)
          const c3x = ix - gapHalf - upPerpX, c3y = iy + gapHalf - upPerpY;
          // Corner 4: bottom-left, outer (toward SW)
          const c4x = ix - gapHalf + upPerpX, c4y = iy + gapHalf + upPerpY;
          
          const upPath = `M ${c1x} ${c1y} L ${c2x} ${c2y} L ${c3x} ${c3y} L ${c4x} ${c4y} Z`;
          
          // Long edges are: c1-c4 (outer edge) and c2-c3 (inner edge)
          upSlantBands.push({ 
            path: upPath, 
            fill: upSlantFill,
            edge1: { x1: c1x, y1: c1y, x2: c4x, y2: c4y }, // outer long edge
            edge2: { x1: c2x, y1: c2y, x2: c3x, y2: c3y }, // inner long edge
          });
        }
      }
    }

    // Pre-compute cardinal walls (N, S, E, W edges)
    interface CardinalWall {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    
    const cardinalWalls: CardinalWall[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = padding + cellSize / 2 + col * cellSize;
        const cy = padding + cellSize / 2 + row * cellSize;
        const halfSize = cellSize / 2;
        
        // Check each cardinal direction
        // North wall
        if (row > 0 && hasWall(row, col, row - 1, col)) {
          cardinalWalls.push({
            x1: cx - halfSize + octInset,
            y1: cy - halfSize,
            x2: cx + halfSize - octInset,
            y2: cy - halfSize,
          });
        }
        // East wall
        if (col < grid.width - 1 && hasWall(row, col, row, col + 1)) {
          cardinalWalls.push({
            x1: cx + halfSize,
            y1: cy - halfSize + octInset,
            x2: cx + halfSize,
            y2: cy + halfSize - octInset,
          });
        }
        // South wall
        if (row < grid.height - 1 && hasWall(row, col, row + 1, col)) {
          cardinalWalls.push({
            x1: cx - halfSize + octInset,
            y1: cy + halfSize,
            x2: cx + halfSize - octInset,
            y2: cy + halfSize,
          });
        }
        // West wall
        if (col > 0 && hasWall(row, col, row, col - 1)) {
          cardinalWalls.push({
            x1: cx - halfSize,
            y1: cy - halfSize + octInset,
            x2: cx - halfSize,
            y2: cy + halfSize - octInset,
          });
        }
      }
    }

    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block", backgroundColor: "#000000" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
            <pattern id="redDotPattern" patternUnits="userSpaceOnUse" width="20" height="20">
              <rect width="20" height="20" fill="#e74c3c"/>
              <circle cx="10" cy="10" r="4" fill="white"/>
            </pattern>
            <pattern id="redHatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#e74c3c"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* Layer 1: Down-slanting diagonal bands (beneath) - no outline */}
          {downSlantBands.map((band, i) => (
            <path
              key={`down-band-${i}`}
              d={band.path}
              fill={band.fill}
              stroke="none"
            />
          ))}
          
          {/* Layer 2: Octagon fills */}
          {octData.map(({ row, col, path, fill }) => (
            <path
              key={`oct-${row}-${col}`}
              d={path}
              fill={fill}
              stroke="none"
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Layer 3: Up-slanting diagonal bands (on top) - fill only, no stroke on path */}
          {upSlantBands.map((band, i) => (
            <path
              key={`up-band-${i}`}
              d={band.path}
              fill={band.fill}
              stroke="none"
            />
          ))}
          
          {/* Layer 3b: Up-slanting band long edge outlines */}
          {upSlantBands.map((band, i) => (
            <React.Fragment key={`up-band-edges-${i}`}>
              <line
                x1={band.edge1.x1}
                y1={band.edge1.y1}
                x2={band.edge1.x2}
                y2={band.edge1.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
              <line
                x1={band.edge2.x1}
                y1={band.edge2.y1}
                x2={band.edge2.x2}
                y2={band.edge2.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
            </React.Fragment>
          ))}
          
          {/* Layer 4: Cardinal walls (on top of everything) */}
          {cardinalWalls.map((wall, i) => (
            <line
              key={`cardinal-wall-${i}`}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke={WALL_COLOR}
              strokeWidth={wallThickness}
              strokeLinecap="round"
            />
          ))}
          
          {/* Outer boundary */}
          <rect
            x={wallThickness / 2}
            y={wallThickness / 2}
            width={svgWidth - wallThickness}
            height={svgHeight - wallThickness}
            fill="none"
            stroke={WALL_COLOR}
            strokeWidth={wallThickness}
          />
          
          {/* Reachability levels on top of everything */}
          {octData.map(({ row, col, cx, cy, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
        </svg>
      </div>
    );
  }

  // Cairo pentagonal tiling rendering
  if (gridType === "cairo") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;
    
    // Create coordinate transformer
    const availableWidth = svgWidth - 2 * padding;
    const availableHeight = svgHeight - 2 * padding;
    const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);
    
    // Helper to get color for a cell
    const getCellColor = (row: number, col: number): string => {
      const inputColor = grid.colors[row][col];
      const displayColor = showSolutionColors
        ? solution!.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !showSolutionColors;
      const isHatch = displayColor === HATCH_COLOR;
      const isRedDot = displayColor === RED_DOT_COLOR;
      const isRedHatch = displayColor === RED_HATCH_COLOR;
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
      } else if (isRedDot) {
        return "url(#redDotPattern)";
      } else if (isRedHatch) {
        return "url(#redHatchPattern)";
      } else {
        return COLORS[(displayColor ?? 0) % COLORS.length];
      }
    };
    
    // Pre-compute all Cairo tile data
    interface CairoData {
      row: number;
      col: number;
      path: string;
      fill: string;
      centroid: [number, number];
      reachLevel: number | null;
    }
    
    const cairoData: CairoData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const path = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const fill = getCellColor(row, col);
        const centroid = toSvg(polyCentroid(tile));
        
        // Get reachability level if available
        const reachLevel = showReachabilityLevels && solution?.reachabilityLevels 
          ? solution.reachabilityLevels[row][col] 
          : null;

        cairoData.push({ row, col, path, fill, centroid, reachLevel });
      }
    }
    
    // Pre-compute walls between tiles
    interface CairoWall {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    
    const cairoWalls: CairoWall[] = [];
    const processedEdges = new Set<string>();
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const neighbors = getCairoNeighborsWithDirection(row, col);
        
        for (const [nRow, nCol] of neighbors) {
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          
          // Create unique edge key
          const edgeKey = row < nRow || (row === nRow && col < nCol)
            ? `${row},${col}-${nRow},${nCol}`
            : `${nRow},${nCol}-${row},${col}`;
            
          if (processedEdges.has(edgeKey)) {
            continue;
          }
          processedEdges.add(edgeKey);
          
          if (hasWall(row, col, nRow, nCol)) {
            const neighborTile = getCairoTile(nRow, nCol);
            const sharedEdge = findSharedEdge(tile, neighborTile);
            
            if (sharedEdge) {
              const [p1, p2] = sharedEdge.map(toSvg);
              cairoWalls.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
            }
          }
        }
      }
    }

    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
            <pattern id="redDotPattern" patternUnits="userSpaceOnUse" width="20" height="20">
              <rect width="20" height="20" fill="#e74c3c"/>
              <circle cx="10" cy="10" r="4" fill="white"/>
            </pattern>
            <pattern id="redHatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#e74c3c"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* First pass: render all Cairo tile fills */}
          {cairoData.map(({ row, col, path, fill }) => (
            <path
              key={`fill-${row}-${col}`}
              d={path}
              fill={fill}
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Second pass: render all walls on top */}
          {cairoWalls.map((wall, i) => (
            <line
              key={`wall-${i}`}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke={WALL_COLOR}
              strokeWidth={wallThickness}
              strokeLinecap="round"
            />
          ))}
          
          {/* Third pass: render reachability levels on top of everything */}
          {cairoData.map(({ row, col, centroid, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
        </svg>
      </div>
    );
  }

  // Cairo Bridge pentagonal tiling rendering (like Cairo but with bridge connections for extra diagonal neighbors)
  if (gridType === "cairobridge") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;
    
    // Create coordinate transformer
    const availableWidth = svgWidth - 2 * padding;
    const availableHeight = svgHeight - 2 * padding;
    const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);
    
    // Helper to get color for a cell
    const getCellColor = (row: number, col: number): string => {
      const inputColor = grid.colors[row][col];
      const displayColor = showSolutionColors
        ? solution!.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !showSolutionColors;
      const isHatch = displayColor === HATCH_COLOR;
      const isRedDot = displayColor === RED_DOT_COLOR;
      const isRedHatch = displayColor === RED_HATCH_COLOR;
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
      } else if (isRedDot) {
        return "url(#redDotPattern)";
      } else if (isRedHatch) {
        return "url(#redHatchPattern)";
      } else {
        return COLORS[(displayColor ?? 0) % COLORS.length];
      }
    };
    
    // Pre-compute all Cairo tile data
    interface CairoData {
      row: number;
      col: number;
      path: string;
      fill: string;
      centroid: [number, number];
      reachLevel: number | null;
    }
    
    const cairoData: CairoData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const path = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const fill = getCellColor(row, col);
        const centroid = toSvg(polyCentroid(tile));
        
        // Get reachability level if available
        const reachLevel = showReachabilityLevels && solution?.reachabilityLevels 
          ? solution.reachabilityLevels[row][col] 
          : null;

        cairoData.push({ row, col, path, fill, centroid, reachLevel });
      }
    }
    
    // Pre-compute walls between tiles (for base Cairo-like edges)
    interface CairoWall {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    
    const cairoWalls: CairoWall[] = [];
    const processedEdges = new Set<string>();
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const neighbors = getCairoBridgeNeighborsWithDirection(row, col);
        
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          
          // Create unique edge key
          const edgeKey = row < nRow || (row === nRow && col < nCol)
            ? `${row},${col}-${nRow},${nCol}`
            : `${nRow},${nCol}-${row},${col}`;
            
          if (processedEdges.has(edgeKey)) {
            continue;
          }
          processedEdges.add(edgeKey);
          
          // Only draw walls for shared-edge neighbors (cardinal + Cairo's diagonal)
          // Diagonal bridge neighbors don't have a shared edge to draw a wall on
          const isCardinal = direction === "N" || direction === "S" || direction === "E" || direction === "W";
          // Check if this is the original Cairo diagonal (which has a shared edge)
          const parityCol = col % 2;
          const parityRow = row % 2;
          let isCairoDiagonal = false;
          if (parityCol === 0 && parityRow === 0 && direction === "SW") isCairoDiagonal = true;
          else if (parityCol === 1 && parityRow === 0 && direction === "NW") isCairoDiagonal = true;
          else if (parityCol === 0 && parityRow === 1 && direction === "SE") isCairoDiagonal = true;
          else if (parityCol === 1 && parityRow === 1 && direction === "NE") isCairoDiagonal = true;
          
          if ((isCardinal || isCairoDiagonal) && hasWall(row, col, nRow, nCol)) {
            const neighborTile = getCairoTile(nRow, nCol);
            const sharedEdge = findSharedEdge(tile, neighborTile);
            
            if (sharedEdge) {
              const [p1, p2] = sharedEdge.map(toSvg);
              cairoWalls.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
            }
          }
        }
      }
    }
    
    // Pre-compute bridge connections for the extra diagonal neighbors
    // These are thin bands like in octagon that cross over each other
    interface Bridge {
      path: string;
      fill: string;
      // The two long edges of the bridge for outline
      edge1: { x1: number; y1: number; x2: number; y2: number };
      edge2: { x1: number; y1: number; x2: number; y2: number };
    }
    
    const bridges: Bridge[] = [];
    const bridgeBandWidth = cellSize * 0.08; // Thin bridges
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const neighbors = getCairoBridgeNeighborsWithDirection(row, col);
        const parityCol = col % 2;
        const parityRow = row % 2;
        
        // Determine which diagonals are "bridge" diagonals (not the Cairo diagonal)
        // Cairo diagonal for each parity:
        // (0,0): SW, (1,0): NW, (0,1): SE, (1,1): NE
        let cairoDiagonal: string;
        if (parityCol === 0 && parityRow === 0) cairoDiagonal = "SW";
        else if (parityCol === 1 && parityRow === 0) cairoDiagonal = "NW";
        else if (parityCol === 0 && parityRow === 1) cairoDiagonal = "SE";
        else cairoDiagonal = "NE";
        
        const tile = getCairoTile(row, col);
        const centroid1 = toSvg(polyCentroid(tile));
        
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          
          // Only process non-Cairo diagonals (the bridge diagonals)
          const isCardinal = direction === "N" || direction === "S" || direction === "E" || direction === "W";
          if (isCardinal || direction === cairoDiagonal) {
            continue;
          }
          
          // Only process each bridge once (from lower row/col cell)
          if (row > nRow || (row === nRow && col > nCol)) {
            continue;
          }
          
          // Check if there's no wall (passage exists)
          if (hasWall(row, col, nRow, nCol)) {
            continue;
          }
          
          // Draw bridge from this cell's centroid to neighbor's centroid
          const neighborTile = getCairoTile(nRow, nCol);
          const centroid2 = toSvg(polyCentroid(neighborTile));
          
          // Create a thin band covering only the middle 30% of the trajectory
          const dx = centroid2[0] - centroid1[0];
          const dy = centroid2[1] - centroid1[1];
          const len = Math.sqrt(dx * dx + dy * dy);
          
          // Unit vector along the bridge direction
          const unitX = dx / len;
          const unitY = dy / len;
          
          // Start at 35% and end at 65% of the trajectory (middle 30%)
          const startX = centroid1[0] + unitX * len * 0.35;
          const startY = centroid1[1] + unitY * len * 0.35;
          const endX = centroid1[0] + unitX * len * 0.65;
          const endY = centroid1[1] + unitY * len * 0.65;
          
          // Perpendicular unit vector
          const perpX = -dy / len * bridgeBandWidth / 2;
          const perpY = dx / len * bridgeBandWidth / 2;
          
          // Four corners of the bridge band (shortened)
          const c1x = startX + perpX, c1y = startY + perpY;
          const c2x = startX - perpX, c2y = startY - perpY;
          const c3x = endX - perpX, c3y = endY - perpY;
          const c4x = endX + perpX, c4y = endY + perpY;
          
          const bridgePath = `M ${c1x} ${c1y} L ${c2x} ${c2y} L ${c3x} ${c3y} L ${c4x} ${c4y} Z`;
          // In sketchpad mode, don't fill with color since we don't know what it will be
          const bridgeFill = showSolutionColors ? getCellColor(row, col) : "none";
          
          bridges.push({
            path: bridgePath,
            fill: bridgeFill,
            edge1: { x1: c1x, y1: c1y, x2: c4x, y2: c4y },
            edge2: { x1: c2x, y1: c2y, x2: c3x, y2: c3y },
          });
        }
      }
    }

    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
            <pattern id="redDotPattern" patternUnits="userSpaceOnUse" width="20" height="20">
              <rect width="20" height="20" fill="#e74c3c"/>
              <circle cx="10" cy="10" r="4" fill="white"/>
            </pattern>
            <pattern id="redHatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#e74c3c"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* First pass: render all Cairo tile fills */}
          {cairoData.map(({ row, col, path, fill }) => (
            <path
              key={`fill-${row}-${col}`}
              d={path}
              fill={fill}
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Second pass: render all walls */}
          {cairoWalls.map((wall, i) => (
            <line
              key={`wall-${i}`}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke={WALL_COLOR}
              strokeWidth={wallThickness}
              strokeLinecap="round"
            />
          ))}
          
          {/* Third pass: render bridge connections on top of walls (thin bands) */}
          {bridges.map((bridge, i) => (
            <g key={`bridge-${i}`}>
              <path
                d={bridge.path}
                fill={bridge.fill}
                stroke="none"
              />
              {/* Outline on long edges */}
              <line
                x1={bridge.edge1.x1}
                y1={bridge.edge1.y1}
                x2={bridge.edge1.x2}
                y2={bridge.edge1.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
              <line
                x1={bridge.edge2.x1}
                y1={bridge.edge2.y1}
                x2={bridge.edge2.x2}
                y2={bridge.edge2.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
            </g>
          ))}
          
          {/* Fourth pass: render reachability levels on top of everything */}
          {cairoData.map(({ row, col, centroid, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
        </svg>
      </div>
    );
  }

  // Square grid rendering (original code)

  return (
    <div
      className="grid-container"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        position: "relative",
        width: totalWidth,
        height: totalHeight,
        border: `${wallThickness}px solid ${WALL_COLOR}`,
        boxSizing: "content-box",
        userSelect: "none",
      }}
    >
      {/* Render cells */}
      {Array.from({ length: grid.height }, (_, row) =>
        Array.from({ length: grid.width }, (_, col) => {
          const inputColor = grid.colors[row][col];
          // In solution view mode, always show solution colors
          // In sketchpad mode, always show user colors (inputColor), even if null
          const displayColor = showSolutionColors
            ? solution!.assignedColors[row][col]
            : inputColor;
          const isBlank = inputColor === null && !showSolutionColors;
          const isHatch = displayColor === HATCH_COLOR;
          const isRedDot = displayColor === RED_DOT_COLOR;
          const isRedHatch = displayColor === RED_HATCH_COLOR;
          
          // Determine background
          let bgColor: string;
          let bgPattern: string;
          if (isBlank) {
            bgColor = BLANK_COLOR;
            bgPattern = BLANK_PATTERN;
          } else if (isHatch) {
            bgColor = HATCH_BG_COLOR;
            bgPattern = HATCH_PATTERN;
          } else if (isRedDot) {
            bgColor = RED_DOT_BG_COLOR;
            bgPattern = RED_DOT_PATTERN;
          } else if (isRedHatch) {
            bgColor = RED_HATCH_BG_COLOR;
            bgPattern = RED_HATCH_PATTERN;
          } else {
            bgColor = COLORS[(displayColor ?? 0) % COLORS.length];
            bgPattern = bgColor;
          }

          // Check walls on each side
          const wallRight = col < grid.width - 1 && hasWall(row, col, row, col + 1);
          const wallBottom = row < grid.height - 1 && hasWall(row, col, row + 1, col);
          
          // Get reachability level if available
          const reachLevel = showReachabilityLevels && solution?.reachabilityLevels 
            ? solution.reachabilityLevels[row][col] 
            : null;

          return (
            <div
              key={`${row}-${col}`}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
              style={{
                position: "absolute",
                left: col * cellSize,
                top: row * cellSize,
                width: cellSize,
                height: cellSize,
                backgroundColor: bgColor,
                background: bgPattern,
                cursor: viewMode === "solution" ? "default" : "pointer",
                boxSizing: "border-box",
                // Right wall
                borderRight: wallRight
                  ? `${wallThickness}px solid ${WALL_COLOR}`
                  : "none",
                // Bottom wall
                borderBottom: wallBottom
                  ? `${wallThickness}px solid ${WALL_COLOR}`
                  : "none",
                // Center text for reachability level
                display: reachLevel !== null ? "flex" : undefined,
                alignItems: reachLevel !== null ? "center" : undefined,
                justifyContent: reachLevel !== null ? "center" : undefined,
              }}
            >
              {reachLevel !== null && (
                <span style={{
                  color: "#fff",
                  fontWeight: "bold",
                  fontSize: cellSize > 30 ? "14px" : "10px",
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                }}>
                  {reachLevel === -1 ? "∞" : reachLevel}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

interface ColorPaletteProps {
  selectedColor: number | null; // null means blank/eraser
  onColorSelect: (color: number | null) => void;
  numColors?: number;
}

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  selectedColor,
  onColorSelect,
  numColors = 6,
}) => {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        marginBottom: "16px",
      }}
    >
      {/* Blank/eraser option */}
      <button
        onClick={() => onColorSelect(null)}
        style={{
          width: "36px",
          height: "36px",
          background: BLANK_PATTERN,
          border:
            selectedColor === null
              ? "3px solid #2c3e50"
              : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          outline: "none",
          boxShadow:
            selectedColor === null
              ? "0 0 0 2px #3498db"
              : "none",
        }}
        title="Blank (eraser)"
      />
      {/* Color options */}
      {Array.from({ length: numColors }, (_, i) => (
        <button
          key={i}
          onClick={() => onColorSelect(i)}
          style={{
            width: "36px",
            height: "36px",
            backgroundColor: COLORS[i % COLORS.length],
            border:
              selectedColor === i
                ? "3px solid #2c3e50"
                : "2px solid #bdc3c7",
            borderRadius: "4px",
            cursor: "pointer",
            outline: "none",
            boxShadow:
              selectedColor === i
                ? "0 0 0 2px #3498db"
                : "none",
          }}
          title={`Color ${i + 1}`}
        />
      ))}
      {/* Hatch color option - doesn't need to be connected */}
      <button
        onClick={() => onColorSelect(HATCH_COLOR)}
        style={{
          width: "36px",
          height: "36px",
          background: HATCH_PATTERN,
          border:
            selectedColor === HATCH_COLOR
              ? "3px solid #2c3e50"
              : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          outline: "none",
          boxShadow:
            selectedColor === HATCH_COLOR
              ? "0 0 0 2px #3498db"
              : "none",
        }}
        title="Hatch (doesn't need to be connected)"
      />
      {/* Red with Dot - origin for bounded reachability (at most one) */}
      <button
        onClick={() => onColorSelect(RED_DOT_COLOR)}
        style={{
          width: "36px",
          height: "36px",
          background: RED_DOT_PATTERN,
          border:
            selectedColor === RED_DOT_COLOR
              ? "3px solid #2c3e50"
              : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          outline: "none",
          boxShadow:
            selectedColor === RED_DOT_COLOR
              ? "0 0 0 2px #3498db"
              : "none",
        }}
        title="Red with Dot (origin - at most one allowed)"
      />
      {/* Red with Hatch - must be at reachability > K from origin */}
      <button
        onClick={() => onColorSelect(RED_HATCH_COLOR)}
        style={{
          width: "36px",
          height: "36px",
          background: RED_HATCH_PATTERN,
          border:
            selectedColor === RED_HATCH_COLOR
              ? "3px solid #2c3e50"
              : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          outline: "none",
          boxShadow:
            selectedColor === RED_HATCH_COLOR
              ? "0 0 0 2px #3498db"
              : "none",
        }}
        title="Red with Hatch (reachability > K from origin)"
      />
    </div>
  );
};

interface ControlsProps {
  gridWidth: number;
  gridHeight: number;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onSolve: () => void;
  onClear: () => void;
  onMazeSetup: () => void;
  onCancel?: () => void;
  solving: boolean;
  solutionStatus: "none" | "found" | "unsatisfiable" | "error";
  errorMessage?: string | null;
  solverType?: "minisat" | "cadical";
  onSolverTypeChange?: (solverType: "minisat" | "cadical") => void;
  solveTime?: number | null;
  minWallsProportion?: number;
  onMinWallsProportionChange?: (proportion: number) => void;
  solution?: GridSolution | null;
  gridType?: GridType;
  onGridTypeChange?: (gridType: GridType) => void;
  onDownloadColors?: () => void;
  onUploadColors?: (file: File) => void;
  grid?: { colors: (number | null)[][] };
  reachabilityK?: number;
  onReachabilityKChange?: (k: number) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  gridWidth,
  gridHeight,
  onWidthChange,
  onHeightChange,
  onSolve,
  onClear,
  onMazeSetup,
  onCancel,
  solving,
  solutionStatus,
  errorMessage,
  solverType = "minisat",
  onSolverTypeChange,
  solveTime,
  minWallsProportion = 0,
  onMinWallsProportionChange,
  solution: _solution,
  gridType = "square",
  onGridTypeChange,
  onDownloadColors,
  onUploadColors,
  grid,
  reachabilityK = 0,
  onReachabilityKChange,
}) => {
  // solution is received but not used in Controls (SVG download moved to solution panel)
  void _solution;
  
  // File input ref for upload
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  // Local state for K value input to allow empty while typing
  const [localKValue, setLocalKValue] = useState<string>(reachabilityK.toString());
  
  // Sync local state when prop changes (e.g., from parent)
  React.useEffect(() => {
    setLocalKValue(reachabilityK.toString());
  }, [reachabilityK]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadColors) {
      onUploadColors(file);
    }
    // Reset input so same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [onUploadColors]);
  
  const handleKValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalKValue(value);
    // Update parent immediately with parsed value (allows real-time updates)
    // but allow empty string temporarily during editing
    if (value !== '' && onReachabilityKChange) {
      const parsed = parseInt(value);
      if (!isNaN(parsed)) {
        onReachabilityKChange(Math.max(0, parsed));
      }
    }
  }, [onReachabilityKChange]);
  
  const handleKValueBlur = useCallback(() => {
    // On blur, normalize empty to 0
    const parsed = parseInt(localKValue);
    const validValue = isNaN(parsed) ? 0 : Math.max(0, parsed);
    setLocalKValue(validValue.toString());
    if (onReachabilityKChange) {
      onReachabilityKChange(validValue);
    }
  }, [localKValue, onReachabilityKChange]);

  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ minWidth: "50px" }}>Width:</span>
          <input
            type="range"
            min="2"
            max="20"
            value={gridWidth}
            onChange={(e) => onWidthChange(parseInt(e.target.value))}
            style={{ flex: 1, cursor: "pointer" }}
          />
          <span style={{ minWidth: "24px", textAlign: "right" }}>{gridWidth}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ minWidth: "50px" }}>Height:</span>
          <input
            type="range"
            min="2"
            max="20"
            value={gridHeight}
            onChange={(e) => onHeightChange(parseInt(e.target.value))}
            style={{ flex: 1, cursor: "pointer" }}
          />
          <span style={{ minWidth: "24px", textAlign: "right" }}>{gridHeight}</span>
        </label>
        {onSolverTypeChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>Solver:</span>
            <select
              value={solverType}
              onChange={(e) => onSolverTypeChange(e.target.value as "minisat" | "cadical")}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #bdc3c7",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              <option value="minisat">MiniSat</option>
              <option value="cadical">CaDiCaL</option>
            </select>
          </label>
        )}
        {onGridTypeChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>Grid:</span>
            <select
              value={gridType}
              onChange={(e) => onGridTypeChange(e.target.value as GridType)}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #bdc3c7",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              <option value="square">Square</option>
              <option value="hex">Hex</option>
              <option value="octagon">Octagon</option>
              <option value="cairo">Cairo</option>
              <option value="cairobridge">Cairo Bridge</option>
            </select>
          </label>
        )}
        {onMinWallsProportionChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>Min Walls:</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(minWallsProportion * 100)}
              onChange={(e) => onMinWallsProportionChange(parseInt(e.target.value) / 100)}
              style={{ flex: 1, cursor: "pointer" }}
            />
            <span style={{ minWidth: "36px", textAlign: "right" }}>{Math.round(minWallsProportion * 100)}%</span>
          </label>
        )}
        {onReachabilityKChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>K Value:</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={localKValue}
              onChange={handleKValueChange}
              onBlur={handleKValueBlur}
              style={{
                width: "60px",
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #bdc3c7",
                fontSize: "14px",
              }}
            />
            <span style={{ fontSize: "12px", color: "#7f8c8d" }}>(Red+Hatch must have reachability &gt; K)</span>
          </label>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={onSolve}
          disabled={solving}
          style={{
            padding: "8px 16px",
            backgroundColor: "#2ecc71",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: solving ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {solving ? "Solving..." : "Solve"}
        </button>
        {solving && onCancel && (
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              backgroundColor: "#e67e22",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={onClear}
          style={{
            padding: "8px 16px",
            backgroundColor: "#e74c3c",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        <button
          onClick={onMazeSetup}
          style={{
            padding: "8px 16px",
            backgroundColor: "#3498db",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Maze Setup
        </button>
      </div>

      {/* Color CSV Download/Upload */}
      <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {onDownloadColors && grid && (
          <button
            onClick={onDownloadColors}
            style={{
              padding: "6px 12px",
              backgroundColor: "#8e44ad",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Download Colors (CSV)
          </button>
        )}
        {onUploadColors && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: "6px 12px",
                backgroundColor: "#2980b9",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Upload Colors (CSV)
            </button>
          </>
        )}
      </div>

      {solutionStatus !== "none" && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            borderRadius: "4px",
            backgroundColor:
              solutionStatus === "found"
                ? "#d5f5e3"
                : solutionStatus === "error"
                  ? "#fdebd0"
                  : "#fadbd8",
            color:
              solutionStatus === "found"
                ? "#1e8449"
                : solutionStatus === "error"
                  ? "#9c640c"
                  : "#922b21",
          }}
        >
          {solutionStatus === "found"
            ? `Solution found! Each color region is now connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : "MiniSat"})` : ""}${_solution ? ` Walls: ${Math.round(_solution.wallEdges.length / (_solution.wallEdges.length + _solution.keptEdges.length) * 100)}%` : ""}`
            : solutionStatus === "error"
              ? errorMessage || "Unknown error occurred."
              : `No solution exists - some color regions cannot be connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : "MiniSat"})` : ""}`}
        </div>
      )}
    </div>
  );
};
