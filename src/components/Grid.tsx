import React, { useCallback, useMemo, useState } from "react";
import type { ColorGrid, GridSolution, GridType, PathlengthConstraint, ColorRoots } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  HATCH_BG_COLOR,
  BLANK_COLOR,
  WALL_COLOR,
  DEFAULT_WALL_THICKNESS,
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
import { GraphModeRenderer } from "./GraphModeRenderer";
import { HexGridRenderer } from "./HexGridRenderer";

// Re-export color constants for convenience
export { HATCH_COLOR };
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

interface GridProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  selectedColor: number | null;
  onCellClick: (row: number, col: number) => void;
  onCellDrag: (row: number, col: number) => void;
  cellSize?: number;
  gridType?: GridType;
  viewMode?: "sketchpad" | "solution";
  showDistanceLevels?: boolean;
  selectedConstraintId?: string | null;
  graphMode?: boolean;
  colorRoots?: ColorRoots;
  distanceConstraint?: PathlengthConstraint;
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
  showDistanceLevels = false,
  selectedConstraintId = null,
  graphMode = false,
  colorRoots = {},
  distanceConstraint,
}) => {
  // selectedColor is used by parent for painting, not needed here directly
  void _selectedColor;
  const [isDragging, setIsDragging] = useState(false);

  // Determine if we should show solution colors (when viewing solution mode and solution exists)
  const showSolutionColors = viewMode === "solution" && solution !== null;

  // Helper to check if a cell is a root for its color
  const isRootCell = useCallback(
    (row: number, col: number): boolean => {
      const cellColor = grid.colors[row][col];
      if (cellColor === null || cellColor === HATCH_COLOR || cellColor < 0) {
        return false;
      }
      const root = colorRoots[String(cellColor)];
      return root !== undefined && root.row === row && root.col === col;
    },
    [grid.colors, colorRoots]
  );

  // Helper to get distance level for a cell
  const getDistanceLevel = useCallback(
    (row: number, col: number): number | null => {
      if (!showDistanceLevels || !selectedConstraintId || !solution?.distanceLevels?.[selectedConstraintId]) {
        return null;
      }
      return solution.distanceLevels[selectedConstraintId][row][col];
    },
    [showDistanceLevels, selectedConstraintId, solution]
  );

  // Helper to get min distance constraint for a cell (from sketchpad constraint)
  const getMinDistanceConstraint = useCallback(
    (row: number, col: number): number | null => {
      if (!distanceConstraint?.minDistances) {
        return null;
      }
      const cellKey = `${row},${col}`;
      return distanceConstraint.minDistances[cellKey] ?? null;
    },
    [distanceConstraint]
  );

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


  // Graph mode rendering - use dedicated component
  if (graphMode && solution) {
    return (
      <GraphModeRenderer
        grid={grid}
        solution={solution}
        cellSize={cellSize}
        gridType={gridType}
        totalWidth={totalWidth}
        totalHeight={totalHeight}
        wallThickness={wallThickness}
      />
    );
  }


  // For hex grid, use dedicated component
  if (gridType === "hex") {
    return (
      <HexGridRenderer
        grid={grid}
        solution={solution}
        cellSize={cellSize}
        totalWidth={totalWidth}
        totalHeight={totalHeight}
        wallThickness={wallThickness}
        viewMode={viewMode}
        showDistanceLevels={showDistanceLevels}
        selectedConstraintId={selectedConstraintId ?? null}
        colorRoots={colorRoots}
        distanceConstraint={distanceConstraint}
        onCellClick={handleMouseDown}
        onCellDrag={handleMouseEnter}
        onMouseUp={handleMouseUp}
      />
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
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
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
      isRoot: boolean;
      minDistConstraint: number | null;
    }
    
    const octData: OctData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = padding + cellSize / 2 + col * cellSize;
        const cy = padding + cellSize / 2 + row * cellSize;
        const path = createOctagonPath(cx, cy, cellSize, octInset);
        const fill = getCellColor(row, col);
        
        // Get distance level if available
        const reachLevel = getDistanceLevel(row, col);
        
        // Check if this cell is a root
        const isRoot = isRootCell(row, col);
        
        // Get min distance constraint if available
        const minDistConstraint = getMinDistanceConstraint(row, col);

        octData.push({ row, col, cx, cy, path, fill, reachLevel, isRoot, minDistConstraint });
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
          
          {/* Root indicators (show R when not displaying levels) */}
          {octData.map(({ row, col, cx, cy, reachLevel, isRoot }) =>
            isRoot && reachLevel === null && (
              <g key={`root-${row}-${col}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={cellSize * 0.2}
                  fill="white"
                  stroke="#2c3e50"
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#2c3e50"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "12px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  R
                </text>
              </g>
            )
          )}
          
          {/* Min distance constraint markers */}
          {octData.map(({ row, col, cx, cy, minDistConstraint, isRoot }) =>
            minDistConstraint !== null && !isRoot && (
              <g key={`mindist-${row}-${col}`}>
                <rect
                  x={cx - cellSize * 0.25}
                  y={cy - cellSize * 0.15}
                  width={cellSize * 0.5}
                  height={cellSize * 0.3}
                  rx={3}
                  fill="rgba(231, 76, 60, 0.85)"
                  stroke="white"
                  strokeWidth="1.5"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "10px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  ≥{minDistConstraint}
                </text>
              </g>
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
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
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
      isRoot: boolean;
      minDistConstraint: number | null;
    }
    
    const cairoData: CairoData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const path = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const fill = getCellColor(row, col);
        const centroid = toSvg(polyCentroid(tile));
        
        // Get distance level if available
        const reachLevel = getDistanceLevel(row, col);
        
        // Check if this cell is a root
        const isRoot = isRootCell(row, col);
        
        // Get min distance constraint if available
        const minDistConstraint = getMinDistanceConstraint(row, col);

        cairoData.push({ row, col, path, fill, centroid, reachLevel, isRoot, minDistConstraint });
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
          
          {/* Third pass: render distance levels on top of everything */}
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
          
          {/* Fourth pass: render root indicators (show R when not displaying levels) */}
          {cairoData.map(({ row, col, centroid, reachLevel, isRoot }) =>
            isRoot && reachLevel === null && (
              <g key={`root-${row}-${col}`}>
                <circle
                  cx={centroid[0]}
                  cy={centroid[1]}
                  r={cellSize * 0.2}
                  fill="white"
                  stroke="#2c3e50"
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#2c3e50"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "12px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  R
                </text>
              </g>
            )
          )}
          
          {/* Fifth pass: render min distance constraint markers */}
          {cairoData.map(({ row, col, centroid, minDistConstraint, isRoot }) =>
            minDistConstraint !== null && !isRoot && (
              <g key={`mindist-${row}-${col}`}>
                <rect
                  x={centroid[0] - cellSize * 0.25}
                  y={centroid[1] - cellSize * 0.15}
                  width={cellSize * 0.5}
                  height={cellSize * 0.3}
                  rx={3}
                  fill="rgba(231, 76, 60, 0.85)"
                  stroke="white"
                  strokeWidth="1.5"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "10px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  ≥{minDistConstraint}
                </text>
              </g>
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
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
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
      isRoot: boolean;
      minDistConstraint: number | null;
    }
    
    const cairoData: CairoData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const path = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const fill = getCellColor(row, col);
        const centroid = toSvg(polyCentroid(tile));
        
        // Get distance level if available
        const reachLevel = getDistanceLevel(row, col);
        
        // Check if this cell is a root
        const isRoot = isRootCell(row, col);
        
        // Get min distance constraint if available
        const minDistConstraint = getMinDistanceConstraint(row, col);

        cairoData.push({ row, col, path, fill, centroid, reachLevel, isRoot, minDistConstraint });
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
          
          {/* Fifth pass: render root indicators (show R when not displaying levels) */}
          {cairoData.map(({ row, col, centroid, reachLevel, isRoot }) =>
            isRoot && reachLevel === null && (
              <g key={`root-${row}-${col}`}>
                <circle
                  cx={centroid[0]}
                  cy={centroid[1]}
                  r={cellSize * 0.2}
                  fill="white"
                  stroke="#2c3e50"
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#2c3e50"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "12px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  R
                </text>
              </g>
            )
          )}
          
          {/* Sixth pass: render min distance constraint markers */}
          {cairoData.map(({ row, col, centroid, minDistConstraint, isRoot }) =>
            minDistConstraint !== null && !isRoot && (
              <g key={`mindist-${row}-${col}`}>
                <rect
                  x={centroid[0] - cellSize * 0.25}
                  y={centroid[1] - cellSize * 0.15}
                  width={cellSize * 0.5}
                  height={cellSize * 0.3}
                  rx={3}
                  fill="rgba(231, 76, 60, 0.85)"
                  stroke="white"
                  strokeWidth="1.5"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "10px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  ≥{minDistConstraint}
                </text>
              </g>
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
          const isRoot = isRootCell(row, col);
          
          // Determine background
          let bgColor: string;
          let bgPattern: string;
          if (isBlank) {
            bgColor = BLANK_COLOR;
            bgPattern = BLANK_PATTERN;
          } else if (isHatch) {
            bgColor = HATCH_BG_COLOR;
            bgPattern = HATCH_PATTERN;
          } else {
            bgColor = COLORS[(displayColor ?? 0) % COLORS.length];
            bgPattern = bgColor;
          }

          // Check walls on each side
          const wallRight = col < grid.width - 1 && hasWall(row, col, row, col + 1);
          const wallBottom = row < grid.height - 1 && hasWall(row, col, row + 1, col);
          
          // Get distance level if available
          const reachLevel = getDistanceLevel(row, col);
          // Get min distance constraint if available
          const minDistConstraint = getMinDistanceConstraint(row, col);

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
                // Center content for reachability level or root indicator
                display: (reachLevel !== null || isRoot || minDistConstraint !== null) ? "flex" : undefined,
                alignItems: (reachLevel !== null || isRoot || minDistConstraint !== null) ? "center" : undefined,
                justifyContent: (reachLevel !== null || isRoot || minDistConstraint !== null) ? "center" : undefined,
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
              {/* Show root indicator only when not displaying reachability levels.
                  When levels are shown, the root is implicitly at level 0, so the "R"
                  marker would be redundant. */}
              {isRoot && reachLevel === null && (
                <div style={{
                  width: cellSize * 0.5,
                  height: cellSize * 0.5,
                  borderRadius: "50%",
                  backgroundColor: "white",
                  border: "2px solid #2c3e50",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: cellSize > 30 ? "12px" : "8px",
                  fontWeight: "bold",
                  color: "#2c3e50",
                }}>
                  R
                </div>
              )}
              {/* Show min distance constraint marker when not showing reach level or root */}
              {minDistConstraint !== null && reachLevel === null && !isRoot && (
                <div style={{
                  minWidth: cellSize * 0.5,
                  height: cellSize * 0.4,
                  padding: "2px 4px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(231, 76, 60, 0.85)",
                  border: "2px solid white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "white",
                }}>
                  ≥{minDistConstraint}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
