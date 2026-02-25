import React, { useCallback, useMemo, useState } from "react";
import type { ColorGrid, GridSolution, GridType, PathlengthConstraint, ColorRoots } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  HATCH_BG_COLOR,
  BLANK_COLOR,
  WALL_COLOR,
  DEFAULT_WALL_THICKNESS,
  calculateGridDimensions,
} from "./gridConstants";
import { GraphModeRenderer } from "./GraphModeRenderer";
import { HexGridRenderer } from "./HexGridRenderer";
import { OctagonGridRenderer } from "./OctagonGridRenderer";
import { CairoGridRenderer } from "./CairoGridRenderer";
import { CairoBridgeGridRenderer } from "./CairoBridgeGridRenderer";

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

  // Octagon grid rendering - use dedicated component
  if (gridType === "octagon") {
    return (
      <OctagonGridRenderer
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

  // Cairo pentagonal tiling rendering - use dedicated component
  if (gridType === "cairo") {
    return (
      <CairoGridRenderer
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


  // Cairo Bridge pentagonal tiling rendering - use dedicated component
  if (gridType === "cairobridge") {
    return (
      <CairoBridgeGridRenderer
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
