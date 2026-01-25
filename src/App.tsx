import { useCallback, useEffect, useRef, useState } from "react";
import { ColorPalette, Controls, SketchpadGrid, SolutionGrid, downloadSolutionSVG } from "./components";
import type { ColorGrid, GridSolution, GridType, PathlengthConstraint, SolverRequest, SolverResponse, SolverType, ColorRoots } from "./problem";
import { HATCH_COLOR } from "./problem";
import SolverWorker from "./problem/solver.worker?worker";
import CadicalWorker from "./problem/cadical.worker?worker";
import "./App.css";

// Tool types - different tools for editing the same unified view
type EditingTool = "colors" | "roots" | "distance";

// Solution metadata - stored separately because solution may have different dimensions/type than current sketchpad
interface SolutionMetadata {
  gridType: GridType;
  width: number;
  height: number;
}

function createEmptyGrid(width: number, height: number): ColorGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null)
    ),
  };
}

interface MazeSetupResult {
  grid: ColorGrid;
  constraint: PathlengthConstraint;
}

function createMazeSetupGrid(
  width: number,
  height: number
): MazeSetupResult {
  // Maze setup: 
  // - Orange hatch (HATCH_COLOR) all the way around the border (walls)
  // - One red square on far left border (entrance)
  // - One red square on far right border (exit)
  // - All other interior cells: red (color 0)
  // - Pathlength constraint from entrance to exit with distance >= max(width, height)
  
  // Position the entrance and exit at the middle row of left/right borders
  const middleRow = Math.floor(height / 2);
  const entranceCol = 0;
  const exitCol = width - 1;
  
  const colors = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => {
      // Entrance on far left: red square in the left border
      if (row === middleRow && col === entranceCol) {
        return 0; // red
      }
      // Exit on far right: red square in the right border
      if (row === middleRow && col === exitCol) {
        return 0; // red
      }
      // Other border cells: orange hatch (walls)
      if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
        return HATCH_COLOR;
      }
      // Interior: red
      return 0;
    })
  );
  
  const grid: ColorGrid = { width, height, colors };
  
  // Create pathlength constraint with minimum distance at exit
  // Use max(width, height) as minimum distance to ensure a sufficiently long maze path
  const minDistance = Math.max(width, height);
  const constraint: PathlengthConstraint = {
    id: `maze_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    minDistances: {
      [`${middleRow},${exitCol}`]: minDistance,
    },
  };
  
  return { grid, constraint };
}

/** Generate a unique ID for a new pathlength constraint */
function generateConstraintId(): string {
  return `plc_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function App() {
  const [gridWidth, setGridWidth] = useState(6);
  const [gridHeight, setGridHeight] = useState(6);
  const [grid, setGrid] = useState<ColorGrid>(() =>
    createEmptyGrid(gridWidth, gridHeight)
  );
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [solution, setSolution] = useState<GridSolution | null>(null);
  const [solutionMetadata, setSolutionMetadata] = useState<SolutionMetadata | null>(null);
  const [solving, setSolving] = useState(false);
  const [solutionStatus, setSolutionStatus] = useState<
    "none" | "found" | "unsatisfiable" | "error"
  >("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverType, setSolverType] = useState<SolverType>("minisat");
  const [solveTime, setSolveTime] = useState<number | null>(null);
  const [gridType, setGridType] = useState<GridType>("square");
  const [graphMode, setGraphMode] = useState(false);
  // Pathlength constraints state - now a single constraint (simplified)
  const [pathlengthConstraints, setPathlengthConstraints] = useState<PathlengthConstraint[]>([]);
  const [selectedConstraintId, setSelectedConstraintId] = useState<string | null>(null);
  // Editing tool - controls what action clicking on a cell does (all tools see the same view)
  const [editingTool, setEditingTool] = useState<EditingTool>("colors");
  // Selected constraint for showing distance levels in solution viewer (null = don't show levels)
  const [selectedLevelConstraintId, setSelectedLevelConstraintId] = useState<string | null>(null);
  // Color roots - maps color index (as string) to the root cell for that color's tree
  const [colorRoots, setColorRoots] = useState<ColorRoots>({});
  // Distance input state for distance tool
  const [distanceInput, setDistanceInput] = useState<string>("");
  const [pendingDistanceCell, setPendingDistanceCell] = useState<{ row: number; col: number } | null>(null);
  // SAT stats (variables and clauses) - shown during solving and in solution
  const [satStats, setSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const numColors = 6;

  // Web Worker for non-blocking solving
  const workerRef = useRef<Worker | null>(null);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Auto-manage roots when colors change:
  // 7a. Every color used must have a root as soon as it's assigned to at least one tile
  // 7b. Root must go out of existence if color of its tile changes (and auto-place new root if tiles remain)
  useEffect(() => {
    // Find all used colors (non-null, non-hatch) from grid
    const usedColors = new Set<number>();
    for (const row of grid.colors) {
      for (const cell of row) {
        if (cell !== null && cell !== HATCH_COLOR && cell >= 0) {
          usedColors.add(cell);
        }
      }
    }

    setColorRoots((prevRoots) => {
      const newRoots = { ...prevRoots };
      let changed = false;

      // Remove roots for colors no longer used
      for (const colorStr of Object.keys(newRoots)) {
        const color = parseInt(colorStr, 10);
        if (!usedColors.has(color)) {
          delete newRoots[colorStr];
          changed = true;
        }
      }

      // Check if existing roots are still valid (root cell still has that color)
      for (const colorStr of Object.keys(newRoots)) {
        const color = parseInt(colorStr, 10);
        const root = newRoots[colorStr];
        if (root && grid.colors[root.row]?.[root.col] !== color) {
          // Root's cell no longer has this color - find a new cell with this color
          let foundNew = false;
          for (let r = 0; r < grid.height && !foundNew; r++) {
            for (let c = 0; c < grid.width && !foundNew; c++) {
              if (grid.colors[r][c] === color) {
                newRoots[colorStr] = { row: r, col: c };
                foundNew = true;
                changed = true;
              }
            }
          }
          if (!foundNew) {
            // No cells with this color exist - remove root
            delete newRoots[colorStr];
            changed = true;
          }
        }
      }

      // Add roots for colors that are used but don't have a root yet
      for (const color of usedColors) {
        if (!newRoots[String(color)]) {
          // Find first cell with this color
          for (let r = 0; r < grid.height; r++) {
            for (let c = 0; c < grid.width; c++) {
              if (grid.colors[r][c] === color) {
                newRoots[String(color)] = { row: r, col: c };
                changed = true;
                break;
              }
            }
            if (newRoots[String(color)]) break;
          }
        }
      }

      return changed ? newRoots : prevRoots;
    });
  }, [grid.colors, grid.width, grid.height]);

  // Unified cell click handler - behavior depends on current tool
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (editingTool === "colors") {
        setGrid((prev) => {
          const newColors = prev.colors.map((r) => [...r]);
          newColors[row][col] = selectedColor;
          return { ...prev, colors: newColors };
        });
        setSolutionStatus("none"); // Hide "Solution found!" on edit
      } else if (editingTool === "roots") {
        const cellColor = grid.colors[row][col];
        // Only allow setting roots for non-null, non-hatch colors
        if (cellColor !== null && cellColor !== HATCH_COLOR && cellColor >= 0) {
          setColorRoots((prev) => ({
            ...prev,
            [String(cellColor)]: { row, col },
          }));
          setSolutionStatus("none"); // Hide "Solution found!" on edit
        }
      } else if (editingTool === "distance") {
        // Open distance input dialog for this cell
        const cellKey = `${row},${col}`;
        // Get single constraint or create one
        const constraint = pathlengthConstraints[0];
        const existingDistance = constraint?.minDistances[cellKey];
        setPendingDistanceCell({ row, col });
        setDistanceInput(existingDistance ? existingDistance.toString() : "");
      }
    },
    [editingTool, selectedColor, grid.colors, pathlengthConstraints]
  );

  // Cell drag is only for colors tool
  const handleCellDrag = useCallback(
    (row: number, col: number) => {
      if (editingTool === "colors") {
        setGrid((prev) => {
          const newColors = prev.colors.map((r) => [...r]);
          newColors[row][col] = selectedColor;
          return { ...prev, colors: newColors };
        });
        setSolutionStatus("none"); // Hide "Solution found!" on edit
      }
    },
    [editingTool, selectedColor]
  );

  // Handle distance input submission
  const handleDistanceSubmit = useCallback(() => {
    if (!pendingDistanceCell) return;

    const cellKey = `${pendingDistanceCell.row},${pendingDistanceCell.col}`;
    const parsed = parseInt(distanceInput, 10);

    // Ensure we have a constraint
    let constraint = pathlengthConstraints[0];
    if (!constraint) {
      constraint = {
        id: generateConstraintId(),
        minDistances: {},
      };
    }

    if (!isNaN(parsed) && parsed > 0) {
      // Valid positive integer - add/update the distance
      const updatedConstraint = {
        ...constraint,
        minDistances: {
          ...constraint.minDistances,
          [cellKey]: parsed,
        },
      };
      setPathlengthConstraints([updatedConstraint]);
      setSelectedConstraintId(updatedConstraint.id);
      setSolutionStatus("none"); // Hide "Solution found!" on edit
    } else if (distanceInput === "" || distanceInput === "0") {
      // Empty or zero - remove the distance constraint
      const newDistances = { ...constraint.minDistances };
      delete newDistances[cellKey];
      const updatedConstraint = {
        ...constraint,
        minDistances: newDistances,
      };
      if (Object.keys(newDistances).length > 0) {
        setPathlengthConstraints([updatedConstraint]);
      } else {
        // No more constraints, can remove it entirely
        setPathlengthConstraints([]);
        setSelectedConstraintId(null);
      }
      setSolutionStatus("none"); // Hide "Solution found!" on edit
    }
    // Otherwise (non-numeric input), just close without saving
    
    setPendingDistanceCell(null);
    setDistanceInput("");
  }, [pendingDistanceCell, distanceInput, pathlengthConstraints]);

  const handleDistanceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleDistanceSubmit();
      } else if (e.key === "Escape") {
        setPendingDistanceCell(null);
        setDistanceInput("");
      }
    },
    [handleDistanceSubmit]
  );

  const handleWidthChange = useCallback((width: number) => {
    const clampedWidth = Math.min(Math.max(width, 2), 20);
    setGridWidth(clampedWidth);
    setGrid((prev) => {
      const newColors = Array.from({ length: prev.height }, (_, row) =>
        Array.from({ length: clampedWidth }, (_, col) =>
          col < prev.width ? prev.colors[row][col] : null
        )
      );
      return { width: clampedWidth, height: prev.height, colors: newColors };
    });
  }, []);

  const handleHeightChange = useCallback((height: number) => {
    const clampedHeight = Math.min(Math.max(height, 2), 20);
    setGridHeight(clampedHeight);
    setGrid((prev) => {
      const newColors = Array.from({ length: clampedHeight }, (_, row) =>
        Array.from({ length: prev.width }, (_, col) =>
          row < prev.height ? prev.colors[row][col] : null
        )
      );
      return { width: prev.width, height: clampedHeight, colors: newColors };
    });
  }, []);

  const handleSolve = useCallback(() => {
    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setSolving(true);
    setSolution(null);
    setSolutionMetadata(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
    setSatStats(null);

    const startTime = performance.now();
    
    // Store the current grid settings for the solution
    const currentGridType = gridType;
    const currentWidth = grid.width;
    const currentHeight = grid.height;

    // Create a new worker based on solver type
    const worker = solverType === "cadical" ? new CadicalWorker() : new SolverWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      const { success, solution, error, messageType, stats } = event.data;
      
      // Handle progress message (stats before solving)
      if (messageType === "progress" && stats) {
        setSatStats(stats);
        return; // Don't process as final result
      }
      
      // Handle final result
      const endTime = performance.now();
      setSolveTime(endTime - startTime);
      
      // Update stats from solution if available
      if (solution?.stats) {
        setSatStats(solution.stats);
      }
      
      if (success && solution) {
        setSolution(solution);
        setSolutionMetadata({
          gridType: currentGridType,
          width: currentWidth,
          height: currentHeight,
        });
        setSolutionStatus("found");
        setErrorMessage(null);
      } else if (success && !solution) {
        // SAT solver returned null (unsatisfiable)
        setSolutionStatus("unsatisfiable");
        setErrorMessage(null);
      } else {
        // Error occurred (e.g., out of memory)
        setSolutionStatus("error");
        setErrorMessage(error || "An unexpected error occurred while solving the grid.");
        console.error("Solver error:", error);
      }
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = (error) => {
      const endTime = performance.now();
      setSolveTime(endTime - startTime);
      console.error("Worker error:", error);
      setSolutionStatus("error");
      setErrorMessage("Worker crashed - the grid may be too large to solve");
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };

    // Send the solve request with clear JSON interface
    const request: SolverRequest = { 
      gridType, 
      width: grid.width, 
      height: grid.height, 
      colors: grid.colors, 
      pathlengthConstraints,
      colorRoots,
    };
    worker.postMessage(request);
  }, [grid, solverType, gridType, pathlengthConstraints, colorRoots]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
    setColorRoots({});
    setPathlengthConstraints([]);
    setSelectedConstraintId(null);
    setSolutionStatus("none");
  }, [gridWidth, gridHeight]);

  const handleMazeSetup = useCallback(() => {
    const { grid, constraint } = createMazeSetupGrid(gridWidth, gridHeight);
    setGrid(grid);
    setPathlengthConstraints([constraint]);
    setSelectedConstraintId(constraint.id);
    // Set root for the red color (0) at the entrance position
    const middleRow = Math.floor(gridHeight / 2);
    setColorRoots({ "0": { row: middleRow, col: 0 } });
  }, [gridWidth, gridHeight]);

  const handleCancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setSolving(false);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
  }, []);

  const handleGridTypeChange = useCallback((newGridType: GridType) => {
    setGridType(newGridType);
  }, []);

  // Copy SAT-generated colors to sketchpad
  const handleCopyToSketchpad = useCallback(() => {
    if (!solution || !solutionMetadata) return;
    
    // Copy the solution colors to the sketchpad, adjusting dimensions to match solution
    setGridWidth(solutionMetadata.width);
    setGridHeight(solutionMetadata.height);
    setGridType(solutionMetadata.gridType);
    setGrid({
      width: solutionMetadata.width,
      height: solutionMetadata.height,
      colors: solution.assignedColors.map(row => [...row]),
    });
  }, [solution, solutionMetadata]);

  // Download sketchpad colorset as CSV
  const handleDownloadSketchpadColors = useCallback(() => {
    // Convert to CSV (no headers, integer values, -1 for null/clear)
    const csvContent = grid.colors
      .map(row => row.map(c => c === null ? -1 : c).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sketchpad-colors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [grid]);

  // Download solution colorset as CSV
  const handleDownloadSolutionColors = useCallback(() => {
    if (!solution) return;
    
    // Convert to CSV (no headers, integer values, -1 for null/clear)
    const csvContent = solution.assignedColors
      .map(row => row.map(c => c === null ? -1 : c).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "solution-colors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [solution]);

  // Download solution as SVG
  const handleDownloadSVG = useCallback(() => {
    if (!solution || !solutionMetadata) return;
    downloadSolutionSVG(solution, solutionMetadata.width, solutionMetadata.height, solutionMetadata.gridType);
  }, [solution, solutionMetadata]);

  // Upload colorset from CSV (to sketchpad)
  const handleUploadColors = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content || !content.trim()) return;
      
      const lines = content.trim().split("\n");
      if (lines.length === 0) return;
      
      const parsedColors: (number | null)[][] = lines.map(line => 
        line.split(",").map(val => {
          const num = parseInt(val.trim(), 10);
          // Treat -1 as null (clear), invalid numbers as null, and clamp valid colors to valid range
          if (isNaN(num) || num === -1) return null;
          // Clamp to valid color range (0-5 for 6 colors, or allow higher values for flexibility)
          return num >= 0 ? num : null;
        })
      );
      
      // Determine grid size from CSV
      const newHeight = parsedColors.length;
      const newWidth = parsedColors[0]?.length || gridWidth;
      
      // Clamp to valid range
      const clampedWidth = Math.min(Math.max(newWidth, 2), 20);
      const clampedHeight = Math.min(Math.max(newHeight, 2), 20);
      
      // Adjust colors array to fit clamped size
      const adjustedColors = Array.from({ length: clampedHeight }, (_, row) =>
        Array.from({ length: clampedWidth }, (_, col) =>
          row < parsedColors.length && col < (parsedColors[row]?.length || 0)
            ? parsedColors[row][col]
            : null
        )
      );
      
      setGridWidth(clampedWidth);
      setGridHeight(clampedHeight);
      setGrid({
        width: clampedWidth,
        height: clampedHeight,
        colors: adjustedColors,
      });
    };
    reader.readAsText(file);
  }, [gridWidth]);

  // Create a grid structure for the solution display based on solution metadata
  const solutionDisplayGrid: ColorGrid | null = solution && solutionMetadata ? {
    width: solutionMetadata.width,
    height: solutionMetadata.height,
    colors: solution.assignedColors,
  } : null;

  return (
    <div className="app">
      <h1>Grid Coloring Solver</h1>
      <p className="description">
        Set your grid size below, then paint some cells with colors (or leave them blank
        for the solver to decide). Click Solve to find a valid coloring where each
        color forms a single connected region.
      </p>

      {/* Main content area with two panels */}
      <div style={{ display: "flex", gap: "40px", flexWrap: "wrap", alignItems: "flex-start" }}>
        
        {/* Sketchpad Section */}
        <div style={{ flex: "1", minWidth: "350px" }}>
          <div style={{ 
            padding: "16px", 
            backgroundColor: "#f8f9fa", 
            borderRadius: "8px",
            border: "2px solid #3498db",
          }}>
            <h2 style={{ margin: "0 0 16px 0", color: "#2c3e50", fontSize: "1.3em" }}>
              📝 Sketchpad
            </h2>
            
            {/* Sketchpad Controls */}
            <Controls
              gridWidth={gridWidth}
              gridHeight={gridHeight}
              onWidthChange={handleWidthChange}
              onHeightChange={handleHeightChange}
              onSolve={handleSolve}
              onClear={handleClear}
              onMazeSetup={handleMazeSetup}
              onCancel={handleCancel}
              solving={solving}
              solutionStatus={solutionStatus}
              errorMessage={errorMessage}
              solverType={solverType}
              onSolverTypeChange={setSolverType}
              solveTime={solveTime}
              solution={solution}
              gridType={gridType}
              onGridTypeChange={handleGridTypeChange}
              onDownloadColors={handleDownloadSketchpadColors}
              onUploadColors={handleUploadColors}
              grid={grid}
              pathlengthConstraints={pathlengthConstraints}
              onPathlengthConstraintsChange={setPathlengthConstraints}
              selectedConstraintId={selectedConstraintId}
              onSelectedConstraintIdChange={setSelectedConstraintId}
            />

            {/* Unified Grid - always shows colors, roots, and distances */}
            <div style={{ marginTop: "16px" }}>
              <SketchpadGrid
                grid={grid}
                solution={null}
                selectedColor={editingTool === "colors" ? selectedColor : null}
                onCellClick={handleCellClick}
                onCellDrag={handleCellDrag}
                cellSize={40}
                gridType={gridType}
                colorRoots={colorRoots}
                distanceConstraint={pathlengthConstraints[0]}
              />
            </div>

            {/* Distance input dialog - shown when distance tool has a pending cell */}
            {pendingDistanceCell && (
              <div
                style={{
                  padding: "16px",
                  marginTop: "12px",
                  backgroundColor: "#fff3cd",
                  borderRadius: "8px",
                  border: "2px solid #ffc107",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "8px" }}>
                  Set minimum distance for cell ({pendingDistanceCell.row}, {pendingDistanceCell.col})
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={distanceInput}
                    onChange={(e) => setDistanceInput(e.target.value)}
                    onKeyDown={handleDistanceKeyDown}
                    autoFocus
                    style={{
                      width: "80px",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      border: "2px solid #3498db",
                      fontSize: "16px",
                    }}
                    placeholder="e.g. 5"
                  />
                  <button
                    onClick={handleDistanceSubmit}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#27ae60",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "14px",
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setPendingDistanceCell(null);
                      setDistanceInput("");
                    }}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#95a5a6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <div style={{ fontSize: "12px", color: "#7f8c8d", marginTop: "8px" }}>
                  Enter a positive integer for minimum distance, or 0/empty to remove constraint.
                </div>
              </div>
            )}

            {/* Tool Selector - below canvas */}
            <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "#ecf0f1", borderRadius: "6px" }}>
              <div style={{ fontSize: "13px", color: "#7f8c8d", marginBottom: "8px" }}>
                <strong>Tool:</strong>{" "}
                {editingTool === "colors" && "Click cells to paint colors"}
                {editingTool === "roots" && "Click a colored cell to set its root"}
                {editingTool === "distance" && "Click a cell to set minimum distance from root"}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setEditingTool("colors")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: editingTool === "colors" ? "#3498db" : "#bdc3c7",
                    color: editingTool === "colors" ? "white" : "#2c3e50",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: editingTool === "colors" ? "bold" : "normal",
                  }}
                >
                  🎨 Colors
                </button>
                <button
                  onClick={() => setEditingTool("roots")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: editingTool === "roots" ? "#e74c3c" : "#bdc3c7",
                    color: editingTool === "roots" ? "white" : "#2c3e50",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: editingTool === "roots" ? "bold" : "normal",
                  }}
                >
                  🌳 Roots
                </button>
                <button
                  onClick={() => setEditingTool("distance")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: editingTool === "distance" ? "#9b59b6" : "#bdc3c7",
                    color: editingTool === "distance" ? "white" : "#2c3e50",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: editingTool === "distance" ? "bold" : "normal",
                  }}
                >
                  📏 Distance
                </button>
              </div>

              {/* Tool-specific controls below selector */}
              {editingTool === "colors" && (
                <div style={{ marginTop: "12px" }}>
                  <ColorPalette
                    selectedColor={selectedColor}
                    onColorSelect={setSelectedColor}
                    numColors={numColors}
                  />
                </div>
              )}

              {editingTool === "roots" && (
                <div style={{ marginTop: "12px", fontSize: "12px", color: "#7f8c8d" }}>
                  Roots are auto-assigned when you paint a color. Click any colored cell to move its root.
                </div>
              )}

              {editingTool === "distance" && (
                <div style={{ marginTop: "12px", fontSize: "12px", color: "#7f8c8d" }}>
                  {pathlengthConstraints.length > 0 && pathlengthConstraints[0].minDistances
                    ? `${Object.keys(pathlengthConstraints[0].minDistances).length} distance constraint(s) set`
                    : "No distance constraints set. Click a cell to add one."}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Solution Section */}
        <div style={{ flex: "1", minWidth: "350px" }}>
          <div style={{ 
            padding: "16px", 
            backgroundColor: "#f0fff4", 
            borderRadius: "8px",
            border: "2px solid #27ae60",
          }}>
            <h2 style={{ margin: "0 0 16px 0", color: "#27ae60", fontSize: "1.3em" }}>
              🎯 SAT Solution
            </h2>
            
            {solution && solutionMetadata ? (
              <>
                <p style={{ fontSize: "12px", color: "#7f8c8d", margin: "0 0 12px 0" }}>
                  Most recent solver output ({solutionMetadata.width}×{solutionMetadata.height} {solutionMetadata.gridType} grid).
                  {solveTime && ` Solved in ${solveTime.toFixed(0)}ms.`}
                  {satStats && ` (${satStats.numVars.toLocaleString()} vars, ${satStats.numClauses.toLocaleString()} clauses)`}
                </p>
                
                {/* Solution action buttons */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                  <button
                    onClick={handleCopyToSketchpad}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#16a085",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    Copy to Sketchpad
                  </button>
                  <button
                    onClick={handleDownloadSVG}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#9b59b6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    Download SVG
                  </button>
                  <button
                    onClick={handleDownloadSolutionColors}
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
                    Download CSV
                  </button>
                  {solution.distanceLevels && Object.keys(solution.distanceLevels).length > 0 && !graphMode && (
                    <select
                      value={selectedLevelConstraintId ?? ""}
                      onChange={(e) => setSelectedLevelConstraintId(e.target.value || null)}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: selectedLevelConstraintId ? "#27ae60" : "#95a5a6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      <option value="">Hide Levels</option>
                      {Object.keys(solution.distanceLevels).map((levelKey) => {
                        // Keys are like "color_0", "color_1", etc. for color roots
                        const colorMatch = levelKey.match(/^color_(\d+)$/);
                        if (colorMatch) {
                          const colorIndex = parseInt(colorMatch[1], 10);
                          const root = colorRoots[String(colorIndex)];
                          const rootInfo = root ? ` (${root.row},${root.col})` : "";
                          const colorNames = ["Red", "Blue", "Green", "Orange", "Purple", "Cyan"];
                          const colorName = colorNames[colorIndex] ?? `Color ${colorIndex}`;
                          return (
                            <option key={levelKey} value={levelKey}>
                              {colorName}{rootInfo}
                            </option>
                          );
                        }
                        // Fallback for old-style constraint IDs
                        return (
                          <option key={levelKey} value={levelKey}>
                            Root {levelKey}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  <button
                    onClick={() => setGraphMode(!graphMode)}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: graphMode ? "#3498db" : "#95a5a6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    {graphMode ? "Tile View" : "Graph View"}
                  </button>
                </div>
                
                {/* Solution Grid */}
                <div style={{ marginTop: "12px" }}>
                  <SolutionGrid
                    grid={solutionDisplayGrid!}
                    solution={solution}
                    cellSize={40}
                    gridType={solutionMetadata.gridType}
                    showDistanceLevels={!!selectedLevelConstraintId && !graphMode}
                    selectedConstraintId={selectedLevelConstraintId}
                    graphMode={graphMode}
                  />
                </div>
              </>
            ) : (
              <div style={{
                padding: "40px", 
                textAlign: "center", 
                color: "#7f8c8d",
                backgroundColor: "#f5f5f5",
                borderRadius: "4px",
              }}>
                <p style={{ margin: 0, fontSize: "14px" }}>
                  {solving ? (
                    <>
                      ⏳ Solving...
                      {satStats && (
                        <span style={{ display: "block", marginTop: "8px", fontSize: "12px" }}>
                          {satStats.numVars.toLocaleString()} variables, {satStats.numClauses.toLocaleString()} clauses
                        </span>
                      )}
                    </>
                  ) : "No solution yet. Click Solve to generate one."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
