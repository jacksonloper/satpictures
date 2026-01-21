import React, { useCallback, useMemo, useState } from "react";
import type { ColorGrid, GridSolution, GridType } from "../solver";
import { HATCH_COLOR } from "../solver";

// Re-export HATCH_COLOR for convenience
export { HATCH_COLOR };

// Predefined color palette
const COLORS = [
  "#e74c3c", // red
  "#3498db", // blue
  "#2ecc71", // green
  "#f39c12", // orange
  "#9b59b6", // purple
  "#1abc9c", // teal
  "#e91e63", // pink
  "#795548", // brown
  "#607d8b", // gray-blue
  "#00bcd4", // cyan
];

// Blank cell appearance
const BLANK_COLOR = "#f5f5f5";
const BLANK_PATTERN = `repeating-linear-gradient(
  45deg,
  #e0e0e0,
  #e0e0e0 2px,
  #f5f5f5 2px,
  #f5f5f5 8px
)`;

// Hatch cell appearance - crosshatch pattern on yellow background
const HATCH_BG_COLOR = "#fffde7"; // light yellow
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
#fffde7`;

interface GridProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  selectedColor: number | null;
  onCellClick: (row: number, col: number) => void;
  onCellDrag: (row: number, col: number) => void;
  cellSize?: number;
  gridType?: GridType;
}

export const Grid: React.FC<GridProps> = ({
  grid,
  solution,
  selectedColor: _selectedColor,
  onCellClick,
  onCellDrag,
  cellSize = 40,
  gridType = "square",
}) => {
  // selectedColor is used by parent for painting, not needed here directly
  void _selectedColor;
  const [isDragging, setIsDragging] = useState(false);

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

  const wallThickness = 3;
  
  // Hex grid calculations
  // Using pointy-topped hexagons with odd-r offset coordinates
  // For pointy-topped hex: width = sqrt(3) * size, height = 2 * size
  const hexSize = cellSize * 0.5; // radius from center to vertex
  const hexWidth = Math.sqrt(3) * hexSize;
  const hexHeight = 2 * hexSize;
  const hexHorizSpacing = hexWidth;
  const hexVertSpacing = hexHeight * 0.75;

  // Octagon grid calculations
  // Octagons are laid out on a square grid but with 8 neighbors
  // In truncated square tiling, there are small squares between octagons at the corners
  // We render diagonal bands through those squares (not the squares themselves)
  // The bands are half-width (narrower than the gap)
  const octInset = cellSize * 0.3; // How much the octagon corners are cut
  const octBandWidth = octInset; // Band width is half of the gap (the gap is 2*octInset diagonally)
  
  // Calculate total dimensions based on grid type
  let totalWidth: number;
  let totalHeight: number;
  if (gridType === "hex") {
    totalWidth = grid.width * hexHorizSpacing + hexWidth / 2 + wallThickness * 2;
    totalHeight = (grid.height - 1) * hexVertSpacing + hexHeight + wallThickness * 2;
  } else if (gridType === "octagon") {
    totalWidth = grid.width * cellSize + wallThickness * 2;
    totalHeight = grid.height * cellSize + wallThickness * 2;
  } else {
    totalWidth = grid.width * cellSize + wallThickness;
    totalHeight = grid.height * cellSize + wallThickness;
  }

  // Get hex neighbors (odd-r offset coordinates) - must match solver's getHexNeighbors
  const getHexNeighbors = (row: number, col: number): [number, number, string][] => {
    const isOddRow = row % 2 === 1;
    if (isOddRow) {
      // Odd rows: match solver's deltas exactly
      return [
        [row - 1, col, "NW"],     // NW (top-left) - solver: [-1, 0]
        [row - 1, col + 1, "NE"], // NE (top-right) - solver: [-1, 1]
        [row, col - 1, "W"],      // W (left) - solver: [0, -1]
        [row, col + 1, "E"],      // E (right) - solver: [0, 1]
        [row + 1, col, "SW"],     // SW (bottom-left) - solver: [1, 0]
        [row + 1, col + 1, "SE"], // SE (bottom-right) - solver: [1, 1]
      ];
    } else {
      // Even rows: match solver's deltas exactly
      return [
        [row - 1, col - 1, "NW"], // NW (top-left) - solver: [-1, -1]
        [row - 1, col, "NE"],     // NE (top-right) - solver: [-1, 0]
        [row, col - 1, "W"],      // W (left) - solver: [0, -1]
        [row, col + 1, "E"],      // E (right) - solver: [0, 1]
        [row + 1, col - 1, "SW"], // SW (bottom-left) - solver: [1, -1]
        [row + 1, col, "SE"],     // SE (bottom-right) - solver: [1, 0]
      ];
    }
  };

  // Create SVG hexagon path - pointy-topped
  const createHexPath = (cx: number, cy: number, size: number): string => {
    // Pointy-topped hexagon: vertices at 30, 90, 150, 210, 270, 330 degrees
    const points: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const angleDeg = 60 * i - 30; // Start at -30 degrees for pointy-top
      const angleRad = (Math.PI / 180) * angleDeg;
      points.push([cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)]);
    }
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
  };

  // Create wall segment between two hex cells - for pointy-topped hexagons
  const getHexWallSegment = (
    _row: number, _col: number, 
    nRow: number, nCol: number,
    direction: string,
    cx: number, cy: number,
    size: number
  ): { x1: number; y1: number; x2: number; y2: number } | null => {
    // Check if neighbor is within bounds
    if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
      return null; // Boundary - will be handled separately
    }
    
    // For pointy-topped hex, calculate the edge positions
    // Vertices are at angles: -30, 30, 90, 150, 210, 270 degrees
    const getVertex = (angleDeg: number): [number, number] => {
      const angleRad = (Math.PI / 180) * angleDeg;
      return [cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)];
    };
    
    // Return the edge segment for this direction
    // Mapping verified by testing that edge coordinates match from both cells
    switch (direction) {
      case "NW": { // Between 210° and 270° vertices
        const v1 = getVertex(210);
        const v2 = getVertex(270);
        return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
      }
      case "NE": { // Between 270° and -30° vertices
        const v1 = getVertex(270);
        const v2 = getVertex(-30);
        return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
      }
      case "W": { // Between 150° and 210° vertices
        const v1 = getVertex(150);
        const v2 = getVertex(210);
        return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
      }
      case "E": { // Between -30° and 30° vertices
        const v1 = getVertex(-30);
        const v2 = getVertex(30);
        return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
      }
      case "SW": { // Between 90° and 150° vertices
        const v1 = getVertex(90);
        const v2 = getVertex(150);
        return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
      }
      case "SE": { // Between 30° and 90° vertices
        const v1 = getVertex(30);
        const v2 = getVertex(90);
        return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
      }
      default:
        return null;
    }
  };

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
    }[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const inputColor = grid.colors[row][col];
        const displayColor =
          solution && inputColor === null
            ? solution.assignedColors[row][col]
            : inputColor;
        const isBlank = inputColor === null && !solution;
        const isHatch = displayColor === HATCH_COLOR;
        
        let fill: string;
        if (isBlank) {
          fill = "url(#blankPattern)";
        } else if (isHatch) {
          fill = "url(#hatchPattern)";
        } else {
          fill = COLORS[(displayColor ?? 0) % COLORS.length];
        }

        // Calculate hex center position - for pointy-topped, odd rows are offset right
        const isOddRow = row % 2 === 1;
        const cx = padding + hexWidth / 2 + col * hexHorizSpacing + (isOddRow ? hexWidth / 2 : 0);
        const cy = padding + hexSize + row * hexVertSpacing;
        
        const path = createHexPath(cx, cy, hexSize);

        // Check for walls to neighbors
        const neighbors = getHexNeighbors(row, col);
        const walls: { x1: number; y1: number; x2: number; y2: number }[] = [];
        
        for (const [nRow, nCol, direction] of neighbors) {
          if (hasWall(row, col, nRow, nCol)) {
            const segment = getHexWallSegment(row, col, nRow, nCol, direction, cx, cy, hexSize);
            if (segment) {
              walls.push(segment);
            }
          }
        }
        
        hexData.push({ row, col, cx, cy, path, fill, isBlank, isHatch, walls });
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
          
          {/* First pass: render all hex fills */}
          {hexData.map(({ row, col, path, fill }) => (
            <path
              key={`fill-${row}-${col}`}
              d={path}
              fill={fill}
              stroke="none"
              style={{ cursor: "pointer" }}
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
                stroke="#2c3e50"
                strokeWidth={wallThickness}
                strokeLinecap="round"
              />
            ))
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

    // Create SVG octagon path
    const createOctagonPath = (cx: number, cy: number, size: number, inset: number): string => {
      // Octagon with flat sides at top/bottom/left/right
      const halfSize = size / 2;
      const points: [number, number][] = [
        [cx - halfSize + inset, cy - halfSize],           // top-left edge
        [cx + halfSize - inset, cy - halfSize],           // top-right edge  
        [cx + halfSize, cy - halfSize + inset],           // right-top edge
        [cx + halfSize, cy + halfSize - inset],           // right-bottom edge
        [cx + halfSize - inset, cy + halfSize],           // bottom-right edge
        [cx - halfSize + inset, cy + halfSize],           // bottom-left edge
        [cx - halfSize, cy + halfSize - inset],           // left-bottom edge
        [cx - halfSize, cy - halfSize + inset],           // left-top edge
      ];
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
    };

    // Helper to get color for a cell
    const getCellColor = (row: number, col: number): string => {
      const inputColor = grid.colors[row][col];
      const displayColor = solution && inputColor === null
        ? solution.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !solution;
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
    }
    
    const octData: OctData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = padding + cellSize / 2 + col * cellSize;
        const cy = padding + cellSize / 2 + row * cellSize;
        const path = createOctagonPath(cx, cy, cellSize, octInset);
        const fill = getCellColor(row, col);

        octData.push({ row, col, cx, cy, path, fill });
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
    
    const downSlantBands: DiagonalBand[] = [];
    const upSlantBands: DiagonalBand[] = [];
    
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
          const upPath = `M ${ix + gapHalf + upPerpX} ${iy - gapHalf + upPerpY} ` +
                        `L ${ix + gapHalf - upPerpX} ${iy - gapHalf - upPerpY} ` +
                        `L ${ix - gapHalf - upPerpX} ${iy + gapHalf - upPerpY} ` +
                        `L ${ix - gapHalf + upPerpX} ${iy + gapHalf + upPerpY} Z`;
          upSlantBands.push({ path: upPath, fill: upSlantFill });
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
          
          {/* Layer 1: Down-slanting diagonal bands (beneath) */}
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
              style={{ cursor: "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Layer 3: Up-slanting diagonal bands (on top) */}
          {upSlantBands.map((band, i) => (
            <path
              key={`up-band-${i}`}
              d={band.path}
              fill={band.fill}
              stroke="none"
            />
          ))}
          
          {/* Layer 4: Cardinal walls (on top of everything) */}
          {cardinalWalls.map((wall, i) => (
            <line
              key={`cardinal-wall-${i}`}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke="#2c3e50"
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
            stroke="#2c3e50"
            strokeWidth={wallThickness}
          />
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
        border: `${wallThickness}px solid #2c3e50`,
        boxSizing: "content-box",
        userSelect: "none",
      }}
    >
      {/* Render cells */}
      {Array.from({ length: grid.height }, (_, row) =>
        Array.from({ length: grid.width }, (_, col) => {
          const inputColor = grid.colors[row][col];
          // Use assigned color from solution if available, otherwise use input
          const displayColor =
            solution && inputColor === null
              ? solution.assignedColors[row][col]
              : inputColor;
          const isBlank = inputColor === null && !solution;
          const isHatch = displayColor === HATCH_COLOR;
          
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
                cursor: "pointer",
                boxSizing: "border-box",
                // Right wall
                borderRight: wallRight
                  ? `${wallThickness}px solid #2c3e50`
                  : "none",
                // Bottom wall
                borderBottom: wallBottom
                  ? `${wallThickness}px solid #2c3e50`
                  : "none",
              }}
            />
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
  solution,
  gridType = "square",
  onGridTypeChange,
}) => {
  const handleDownloadJSON = useCallback(() => {
    if (!solution) return;

    // Convert wall edges to line segments
    // Each wall is between two adjacent cells
    // For a wall between (r1, c1) and (r2, c2):
    // - Vertical edge (same col, adjacent rows): horizontal wall line from (c1, r2) to (c1+1, r2)
    // - Horizontal edge (same row, adjacent cols): vertical wall line from (c2, r1) to (c2, r1+1)
    const walls = solution.wallEdges.map(edge => {
      const { u, v } = edge;
      // Ensure u is the "smaller" point for consistent ordering
      const [p1, p2] = u.row < v.row || (u.row === v.row && u.col < v.col) 
        ? [u, v] : [v, u];
      
      if (p1.row === p2.row) {
        // Horizontal edge (same row) -> vertical wall between cells
        // Wall goes from (p2.col, p1.row) to (p2.col, p1.row + 1)
        return {
          start: { x: p2.col, y: p1.row },
          end: { x: p2.col, y: p1.row + 1 }
        };
      } else {
        // Vertical edge (same col) -> horizontal wall between cells
        // Wall goes from (p1.col, p2.row) to (p1.col + 1, p2.row)
        return {
          start: { x: p1.col, y: p2.row },
          end: { x: p1.col + 1, y: p2.row }
        };
      }
    });

    // Add boundary walls (outer edges of the grid)
    type WallSegment = { start: { x: number; y: number }; end: { x: number; y: number } };
    const boundaryWalls: WallSegment[] = [
      // Top edge
      { start: { x: 0, y: 0 }, end: { x: gridWidth, y: 0 } },
      // Bottom edge
      { start: { x: 0, y: gridHeight }, end: { x: gridWidth, y: gridHeight } },
      // Left edge
      { start: { x: 0, y: 0 }, end: { x: 0, y: gridHeight } },
      // Right edge
      { start: { x: gridWidth, y: 0 }, end: { x: gridWidth, y: gridHeight } },
    ];

    const jsonData = {
      walls: [...boundaryWalls, ...walls],
      colors: solution.assignedColors
    };

    // Create and download the JSON file
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grid-solution.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [solution, gridWidth, gridHeight]);

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
        {solution && (
          <button
            onClick={handleDownloadJSON}
            style={{
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Download JSON
          </button>
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
            ? `Solution found! Each color region is now connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : "MiniSat"})` : ""}${solution ? ` Walls: ${Math.round(solution.wallEdges.length / (solution.wallEdges.length + solution.keptEdges.length) * 100)}%` : ""}`
            : solutionStatus === "error"
              ? errorMessage || "Unknown error occurred."
              : `No solution exists - some color regions cannot be connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : "MiniSat"})` : ""}`}
        </div>
      )}
    </div>
  );
};

export { COLORS };
