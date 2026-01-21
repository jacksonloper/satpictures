import { useCallback, useEffect, useRef, useState } from "react";
import { ColorPalette, Controls, Grid } from "./components";
import type { ColorGrid, GridSolution, GridType, SolverRequest, SolverResponse, SolverType } from "./solver";
import SolverWorker from "./solver/solver.worker?worker";
import CadicalWorker from "./solver/cadical.worker?worker";
import "./App.css";

// View mode: "sketchpad" is user-editable, "solution" is SAT-generated (read-only)
type ViewMode = "sketchpad" | "solution";

function createEmptyGrid(width: number, height: number): ColorGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null)
    ),
  };
}

function createMazeSetupGrid(
  width: number,
  height: number
): ColorGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, () => {
        if (row === 0) return 0; // Top edge is color 0
        if (row === height - 1) return 1; // Bottom edge is color 1
        return 2; // Everything in between is color 2
      })
    ),
  };
}

function App() {
  const [gridWidth, setGridWidth] = useState(6);
  const [gridHeight, setGridHeight] = useState(6);
  const [grid, setGrid] = useState<ColorGrid>(() =>
    createEmptyGrid(gridWidth, gridHeight)
  );
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [solution, setSolution] = useState<GridSolution | null>(null);
  const [solving, setSolving] = useState(false);
  const [solutionStatus, setSolutionStatus] = useState<
    "none" | "found" | "unsatisfiable" | "error"
  >("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverType, setSolverType] = useState<SolverType>("minisat");
  const [solveTime, setSolveTime] = useState<number | null>(null);
  const [minWallsProportion, setMinWallsProportion] = useState(0);
  const [gridType, setGridType] = useState<GridType>("square");
  const [viewMode, setViewMode] = useState<ViewMode>("sketchpad");
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

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      // Don't allow editing when viewing SAT solution
      if (viewMode === "solution") return;
      
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolution(null);
      setSolutionStatus("none");
      setErrorMessage(null);
    },
    [selectedColor, viewMode]
  );

  const handleCellDrag = useCallback(
    (row: number, col: number) => {
      // Don't allow editing when viewing SAT solution
      if (viewMode === "solution") return;
      
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolution(null);
      setSolutionStatus("none");
      setErrorMessage(null);
    },
    [selectedColor, viewMode]
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
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
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
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
  }, []);

  const handleSolve = useCallback(() => {
    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setSolving(true);
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);

    const startTime = performance.now();

    // Create a new worker based on solver type
    const worker = solverType === "cadical" ? new CadicalWorker() : new SolverWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      const endTime = performance.now();
      const { success, solution, error } = event.data;
      setSolveTime(endTime - startTime);
      
      if (success && solution) {
        setSolution(solution);
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

    // Send the solve request
    const request: SolverRequest = { grid, numColors, minWallsProportion, gridType };
    worker.postMessage(request);
  }, [grid, numColors, solverType, minWallsProportion, gridType]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
  }, [gridWidth, gridHeight]);

  const handleMazeSetup = useCallback(() => {
    setGrid(createMazeSetupGrid(gridWidth, gridHeight));
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
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
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
    setViewMode("sketchpad");
  }, []);

  // Copy SAT-generated colors to sketchpad
  const handleCopyToSketchpad = useCallback(() => {
    if (!solution) return;
    
    setGrid({
      width: gridWidth,
      height: gridHeight,
      colors: solution.assignedColors.map(row => [...row]),
    });
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
    setViewMode("sketchpad");
  }, [solution, gridWidth, gridHeight]);

  // Download current colorset as CSV
  const handleDownloadColors = useCallback(() => {
    // Get the colors based on current view mode
    const colors = viewMode === "solution" && solution
      ? solution.assignedColors
      : grid.colors;
    
    // Convert to CSV (no headers, integer values, -1 for null/clear)
    const csvContent = colors
      .map(row => row.map(c => c === null ? -1 : c).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = viewMode === "solution" ? "sat-colors.csv" : "sketchpad-colors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [viewMode, solution, grid]);

  // Upload colorset from CSV
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
      setSolution(null);
      setSolutionStatus("none");
      setErrorMessage(null);
      setSolveTime(null);
      setViewMode("sketchpad");
    };
    reader.readAsText(file);
  }, [gridWidth]);

  // Handle view mode change
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  return (
    <div className="app">
      <h1>Grid Coloring Solver</h1>
      <p className="description">
        Set your grid size below, then paint some cells with colors (or leave them blank
        for the solver to decide). Click Solve to find a valid coloring where each
        color forms a single connected region.
      </p>

      <div className="controls-panel">
        <h3>Grid Size & Solver</h3>
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
          minWallsProportion={minWallsProportion}
          onMinWallsProportionChange={setMinWallsProportion}
          solution={solution}
          gridType={gridType}
          onGridTypeChange={handleGridTypeChange}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onCopyToSketchpad={handleCopyToSketchpad}
          onDownloadColors={handleDownloadColors}
          onUploadColors={handleUploadColors}
          grid={grid}
        />

        <h3>Colors</h3>
        <ColorPalette
          selectedColor={selectedColor}
          onColorSelect={setSelectedColor}
          numColors={numColors}
        />
      </div>

      <div className="grid-panel">
        <Grid
          grid={grid}
          solution={solution}
          selectedColor={selectedColor}
          onCellClick={handleCellClick}
          onCellDrag={handleCellDrag}
          cellSize={40}
          gridType={gridType}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}

export default App;
