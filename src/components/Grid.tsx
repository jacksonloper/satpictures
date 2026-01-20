import React, { useCallback, useMemo, useState } from "react";
import type { ColorGrid, GridSolution } from "../solver";
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
}

export const Grid: React.FC<GridProps> = ({
  grid,
  solution,
  selectedColor: _selectedColor,
  onCellClick,
  onCellDrag,
  cellSize = 40,
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
  const totalWidth = grid.width * cellSize + wallThickness;
  const totalHeight = grid.height * cellSize + wallThickness;

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
  solving: boolean;
  solutionStatus: "none" | "found" | "unsatisfiable" | "error";
  errorMessage?: string | null;
  solverType?: "minisat" | "cadical";
  onSolverTypeChange?: (solverType: "minisat" | "cadical") => void;
  solveTime?: number | null;
  minWallsProportion?: number;
  onMinWallsProportionChange?: (proportion: number) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  gridWidth,
  gridHeight,
  onWidthChange,
  onHeightChange,
  onSolve,
  onClear,
  onMazeSetup,
  solving,
  solutionStatus,
  errorMessage,
  solverType = "minisat",
  onSolverTypeChange,
  solveTime,
  minWallsProportion = 0,
  onMinWallsProportionChange,
}) => {
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
            ? `Solution found! Each color region is now connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : "MiniSat"})` : ""}`
            : solutionStatus === "error"
              ? errorMessage || "Unknown error occurred."
              : `No solution exists - some color regions cannot be connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : "MiniSat"})` : ""}`}
        </div>
      )}
    </div>
  );
};

export { COLORS };
