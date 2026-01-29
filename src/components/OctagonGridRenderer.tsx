import React, { useMemo } from "react";
import type { ColorGrid, GridSolution, PathlengthConstraint, ColorRoots } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  WALL_COLOR,
  getOctagonDimensions,
  createOctagonPath,
} from "./gridConstants";

interface OctagonGridRendererProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  cellSize: number;
  totalWidth: number;
  totalHeight: number;
  wallThickness: number;
  viewMode: "sketchpad" | "solution";
  showDistanceLevels: boolean;
  selectedConstraintId: string | null;
  colorRoots: ColorRoots;
  distanceConstraint?: PathlengthConstraint;
  onCellClick: (row: number, col: number) => void;
  onCellDrag: (row: number, col: number) => void;
  onMouseUp: () => void;
}

export const OctagonGridRenderer: React.FC<OctagonGridRendererProps> = ({
  grid,
  solution,
  cellSize,
  totalWidth,
  totalHeight,
  wallThickness,
  viewMode,
  showDistanceLevels,
  selectedConstraintId,
  colorRoots,
  distanceConstraint,
  onCellClick,
  onCellDrag,
  onMouseUp,
}) => {
  const svgWidth = totalWidth;
  const svgHeight = totalHeight;
  const padding = wallThickness;
  
  // Determine if we should show solution colors
  const showSolutionColors = viewMode === "solution" && solution !== null;
  
  // Octagon grid calculations
  const { octInset, octBandWidth } = getOctagonDimensions(cellSize);
  
  // Helper to check if a cell is a root for its color
  const isRootCell = (row: number, col: number): boolean => {
    const cellColor = grid.colors[row][col];
    if (cellColor === null || cellColor === HATCH_COLOR || cellColor < 0) {
      return false;
    }
    const root = colorRoots[String(cellColor)];
    return root !== undefined && root.row === row && root.col === col;
  };

  // Helper to get distance level for a cell
  const getDistanceLevel = (row: number, col: number): number | null => {
    if (!showDistanceLevels || !selectedConstraintId || !solution?.distanceLevels?.[selectedConstraintId]) {
      return null;
    }
    return solution.distanceLevels[selectedConstraintId][row][col];
  };

  // Helper to get min distance constraint for a cell
  const getMinDistanceConstraint = (row: number, col: number): number | null => {
    if (!distanceConstraint?.minDistances) {
      return null;
    }
    const cellKey = `${row},${col}`;
    return distanceConstraint.minDistances[cellKey] ?? null;
  };

  // Create a set of kept edge keys for quick lookup
  const keptEdgeSet = useMemo(() => {
    const set = new Set<string>();
    if (solution) {
      for (const edge of solution.keptEdges) {
        set.add(`${edge.u.row},${edge.u.col}-${edge.v.row},${edge.v.col}`);
        set.add(`${edge.v.row},${edge.v.col}-${edge.u.row},${edge.u.col}`);
      }
    }
    return set;
  }, [solution]);

  // Check if there should be a wall between two adjacent cells
  const hasWall = (r1: number, c1: number, r2: number, c2: number): boolean => {
    if (!solution) {
      return !(r2 >= 0 && r2 < grid.height && c2 >= 0 && c2 < grid.width);
    }
    const key = `${r1},${c1}-${r2},${c2}`;
    return !keptEdgeSet.has(key);
  };

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
      
      const reachLevel = getDistanceLevel(row, col);
      const isRoot = isRootCell(row, col);
      const minDistConstraint = getMinDistanceConstraint(row, col);
      
      octData.push({ row, col, cx, cy, path, fill, reachLevel, isRoot, minDistConstraint });
    }
  }

  // Pre-compute all walls
  interface WallData {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
  
  const walls: WallData[] = [];
  
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const cx = padding + cellSize / 2 + col * cellSize;
      const cy = padding + cellSize / 2 + row * cellSize;
      
      // Only draw walls on right and bottom to avoid duplicates
      // Plus diagonal neighbors (octagon specific - diagonals connect via small square)
      
      // Right neighbor
      if (hasWall(row, col, row, col + 1)) {
        // Wall on right edge
        const x = cx + cellSize / 2;
        walls.push({ x1: x, y1: cy - cellSize / 2 + octInset, x2: x, y2: cy + cellSize / 2 - octInset });
      }
      
      // Bottom neighbor
      if (hasWall(row, col, row + 1, col)) {
        // Wall on bottom edge
        const y = cy + cellSize / 2;
        walls.push({ x1: cx - cellSize / 2 + octInset, y1: y, x2: cx + cellSize / 2 - octInset, y2: y });
      }
      
      // Top-left boundary
      if (row === 0) {
        const y = cy - cellSize / 2;
        walls.push({ x1: cx - cellSize / 2 + octInset, y1: y, x2: cx + cellSize / 2 - octInset, y2: y });
      }
      
      // Left boundary
      if (col === 0) {
        const x = cx - cellSize / 2;
        walls.push({ x1: x, y1: cy - cellSize / 2 + octInset, x2: x, y2: cy + cellSize / 2 - octInset });
      }
      
      // Bottom boundary (only for last row)
      if (row === grid.height - 1) {
        const y = cy + cellSize / 2;
        walls.push({ x1: cx - cellSize / 2 + octInset, y1: y, x2: cx + cellSize / 2 - octInset, y2: y });
      }
      
      // Right boundary (only for last col)
      if (col === grid.width - 1) {
        const x = cx + cellSize / 2;
        walls.push({ x1: x, y1: cy - cellSize / 2 + octInset, x2: x, y2: cy + cellSize / 2 - octInset });
      }
      
      // Diagonal walls (connect to squares between octagons)
      // For octagon grid, small squares are at the corners
      // Bottom-right diagonal (when no edge is kept)
      if (hasWall(row, col, row + 1, col + 1)) {
        const x1 = cx + cellSize / 2 - octInset;
        const y1 = cy + cellSize / 2;
        const x2 = cx + cellSize / 2;
        const y2 = cy + cellSize / 2 - octInset;
        walls.push({ x1: x1, y1: y1, x2: x2, y2: y2 });
      }
      
      // Bottom-left diagonal (when no edge is kept)  
      if (hasWall(row, col, row + 1, col - 1)) {
        const x1 = cx - cellSize / 2 + octInset;
        const y1 = cy + cellSize / 2;
        const x2 = cx - cellSize / 2;
        const y2 = cy + cellSize / 2 - octInset;
        walls.push({ x1: x1, y1: y1, x2: x2, y2: y2 });
      }
    }
  }

  return (
    <div
      className="grid-container"
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{
        position: "relative",
        userSelect: "none",
      }}
    >
      <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
        {/* Define patterns */}
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
        
        {/* Render small squares at corners (between octagons) */}
        {Array.from({ length: grid.height - 1 }, (_, row) =>
          Array.from({ length: grid.width - 1 }, (_, col) => {
            const x = padding + cellSize * (col + 1) - octBandWidth / 2;
            const y = padding + cellSize * (row + 1) - octBandWidth / 2;
            return (
              <rect
                key={`sq-${row}-${col}`}
                x={x}
                y={y}
                width={octBandWidth}
                height={octBandWidth}
                fill="#ecf0f1"
              />
            );
          })
        )}
        
        {/* Render octagon fills */}
        {octData.map(({ row, col, path, fill }) => (
          <path
            key={`oct-${row}-${col}`}
            d={path}
            fill={fill}
            style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
            onMouseDown={() => onCellClick(row, col)}
            onMouseEnter={() => onCellDrag(row, col)}
          />
        ))}
        
        {/* Render walls */}
        {walls.map((wall, i) => (
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
        
        {/* Render distance levels */}
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
        
        {/* Render root indicators */}
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
        
        {/* Render min distance constraint markers */}
        {octData.map(({ row, col, cx, cy, reachLevel, isRoot, minDistConstraint }) =>
          minDistConstraint !== null && reachLevel === null && !isRoot && (
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
};
