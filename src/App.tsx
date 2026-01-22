import { useCallback, useEffect, useRef, useState } from "react";
import { ColorPalette, Controls, SketchpadGrid, SolutionGrid, downloadSolutionSVG } from "./components";
import type { ColorGrid, GridSolution, GridType, SolverRequest, SolverResponse, SolverType } from "./solver";
import SolverWorker from "./solver/solver.worker?worker";
import CadicalWorker from "./solver/cadical.worker?worker";
import "./App.css";

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
  const [solutionMetadata, setSolutionMetadata] = useState<SolutionMetadata | null>(null);
  const [solving, setSolving] = useState(false);
  const [solutionStatus, setSolutionStatus] = useState<
    "none" | "found" | "unsatisfiable" | "error"
  >("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverType, setSolverType] = useState<SolverType>("minisat");
  const [solveTime, setSolveTime] = useState<number | null>(null);
  const [minWallsProportion, setMinWallsProportion] = useState(0);
  const [gridType, setGridType] = useState<GridType>("square");
  const [reachabilityK, setReachabilityK] = useState(0);
  const [showReachabilityLevels, setShowReachabilityLevels] = useState(false);
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
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
    },
    [selectedColor]
  );

  const handleCellDrag = useCallback(
    (row: number, col: number) => {
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
    },
    [selectedColor]
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

    const startTime = performance.now();
    
    // Store the current grid settings for the solution
    const currentGridType = gridType;
    const currentWidth = grid.width;
    const currentHeight = grid.height;

    // Create a new worker based on solver type
    const worker = solverType === "cadical" ? new CadicalWorker() : new SolverWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      const endTime = performance.now();
      const { success, solution, error } = event.data;
      setSolveTime(endTime - startTime);
      
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

    // Send the solve request
    const request: SolverRequest = { grid, numColors, minWallsProportion, gridType, reachabilityK };
    worker.postMessage(request);
  }, [grid, numColors, solverType, minWallsProportion, gridType, reachabilityK]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
  }, [gridWidth, gridHeight]);

  const handleMazeSetup = useCallback(() => {
    setGrid(createMazeSetupGrid(gridWidth, gridHeight));
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
            <p style={{ fontSize: "12px", color: "#7f8c8d", margin: "0 0 12px 0" }}>
              Click cells to paint colors. Click Solve to generate a solution.
            </p>
            
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
              minWallsProportion={minWallsProportion}
              onMinWallsProportionChange={setMinWallsProportion}
              solution={solution}
              gridType={gridType}
              onGridTypeChange={handleGridTypeChange}
              onDownloadColors={handleDownloadSketchpadColors}
              onUploadColors={handleUploadColors}
              grid={grid}
              reachabilityK={reachabilityK}
              onReachabilityKChange={setReachabilityK}
            />

            <h3 style={{ marginTop: "16px" }}>Colors</h3>
            <ColorPalette
              selectedColor={selectedColor}
              onColorSelect={setSelectedColor}
              numColors={numColors}
            />

            {/* Sketchpad Grid */}
            <div style={{ marginTop: "16px" }}>
              <SketchpadGrid
                grid={grid}
                solution={null}
                selectedColor={selectedColor}
                onCellClick={handleCellClick}
                onCellDrag={handleCellDrag}
                cellSize={40}
                gridType={gridType}
              />
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
                  {solution.reachabilityLevels && (
                    <button
                      onClick={() => setShowReachabilityLevels(!showReachabilityLevels)}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: showReachabilityLevels ? "#27ae60" : "#95a5a6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      {showReachabilityLevels ? "Hide Levels" : "Show Levels"}
                    </button>
                  )}
                </div>
                
                {/* Solution Grid */}
                <div style={{ marginTop: "12px" }}>
                  <SolutionGrid
                    grid={solutionDisplayGrid!}
                    solution={solution}
                    cellSize={40}
                    gridType={solutionMetadata.gridType}
                    showReachabilityLevels={showReachabilityLevels}
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
                  {solving ? "⏳ Solving..." : "No solution yet. Click Solve to generate one."}
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
