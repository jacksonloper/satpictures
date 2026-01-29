import React from "react";
import type { ColorGrid, GridSolution, PathlengthConstraint, ColorRoots } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  WALL_COLOR,
  getHexDimensions,
  getHexNeighbors,
  createHexPath,
  getHexCenter,
  getHexWallSegment,
} from "./gridConstants";

interface HexGridRendererProps {
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

export const HexGridRenderer: React.FC<HexGridRendererProps> = ({
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
  const keptEdgeSet = React.useMemo(() => {
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

  // Hex grid calculations
  const { hexSize, hexWidth, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);
  
  // Handle mouse events
  const handleMouseDown = (row: number, col: number) => {
    onCellClick(row, col);
  };

  const handleMouseEnter = (row: number, col: number) => {
    onCellDrag(row, col);
  };

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
    isRoot: boolean;
    walls: { x1: number; y1: number; x2: number; y2: number }[];
    reachLevel: number | null;
    minDistConstraint: number | null;
  }[] = [];
  
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const inputColor = grid.colors[row][col];
      const displayColor = showSolutionColors
        ? solution!.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !showSolutionColors;
      const isHatch = displayColor === HATCH_COLOR;
      const isRoot = isRootCell(row, col);
      
      let fill: string;
      if (isBlank) {
        fill = "url(#blankPattern)";
      } else if (isHatch) {
        fill = "url(#hatchPattern)";
      } else {
        fill = COLORS[(displayColor ?? 0) % COLORS.length];
      }
      
      const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
      const path = createHexPath(cx, cy, hexSize);
      
      // Get neighbors and compute walls
      const neighbors = getHexNeighbors(row, col);
      const walls: { x1: number; y1: number; x2: number; y2: number }[] = [];
      
      for (const [nRow, nCol, direction] of neighbors) {
        if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
          // Boundary wall
          const segment = getHexWallSegment(direction, cx, cy, hexSize);
          if (segment) walls.push(segment);
        } else if (hasWall(row, col, nRow, nCol)) {
          // Internal wall (solution found wall)
          const segment = getHexWallSegment(direction, cx, cy, hexSize);
          if (segment) walls.push(segment);
        }
      }
      
      const reachLevel = getDistanceLevel(row, col);
      const minDistConstraint = getMinDistanceConstraint(row, col);

      hexData.push({ row, col, cx, cy, path, fill, isBlank, isHatch, isRoot, walls, reachLevel, minDistConstraint });
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
            style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
            onMouseDown={() => handleMouseDown(row, col)}
            onMouseEnter={() => handleMouseEnter(row, col)}
          />
        ))}
        
        {/* Second pass: render all walls on top */}
        {hexData.map(({ row, col, walls }) =>
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
        
        {/* Third pass: render distance levels on top of everything */}
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
        
        {/* Fourth pass: render root indicators (show R when not displaying levels) */}
        {hexData.map(({ row, col, cx, cy, reachLevel, isRoot }) =>
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
        
        {/* Fifth pass: render min distance constraint markers */}
        {hexData.map(({ row, col, cx, cy, reachLevel, isRoot, minDistConstraint }) =>
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
