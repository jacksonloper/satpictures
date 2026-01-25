import { useCallback, useEffect, useRef, useState } from "react";
import { ColorPalette, SketchpadGrid, SolutionGrid, downloadSolutionSVG } from "./components";
import type { ColorGrid, GridSolution, GridType, ConnectivitySolverResponse } from "./problem";
import ConnectivityWorker from "./problem/connectivity.worker?worker";
import ConnectivityCadicalWorker from "./problem/connectivity-cadical.worker?worker";
import ConnectivityDPLLWorker from "./problem/connectivity-dpll.worker?worker";
import "./App.css";

type SolverType = "minisat" | "cadical" | "dpll";

// Solution metadata
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

function ConnectivityApp() {
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
  const [solverType, setSolverType] = useState<SolverType>("cadical");
  const [solveTime, setSolveTime] = useState<number | null>(null);
  const [gridType, setGridType] = useState<GridType>("square");
  const [graphMode, setGraphMode] = useState(false);
  const [satStats, setSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [reduceToTree, setReduceToTree] = useState(false);
  // Selected constraint for showing distance levels in solution viewer (null = don't show levels)
  const [selectedLevelConstraintId, setSelectedLevelConstraintId] = useState<string | null>(null);
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

  // Cell click handler for painting colors
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolutionStatus("none"); // Hide "Solution found!" on edit
    },
    [selectedColor]
  );

  // Cell drag for painting
  const handleCellDrag = useCallback(
    (row: number, col: number) => {
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolutionStatus("none");
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
    setSatStats(null);

    const startTime = performance.now();
    
    // Store the current grid settings for the solution
    const currentGridType = gridType;
    const currentWidth = grid.width;
    const currentHeight = grid.height;

    // Create a new worker based on solver type
    let worker: Worker;
    if (solverType === "cadical") {
      worker = new ConnectivityCadicalWorker();
    } else if (solverType === "dpll") {
      worker = new ConnectivityDPLLWorker();
    } else {
      worker = new ConnectivityWorker();
    }
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ConnectivitySolverResponse>) => {
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

    // Send the solve request
    worker.postMessage({
      gridType,
      width: grid.width,
      height: grid.height,
      colors: grid.colors,
      reduceToTree,
    });
  }, [grid, solverType, gridType, reduceToTree]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
    setSolutionStatus("none");
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

  // Copy SAT-generated colors to sketchpad
  const handleCopyToSketchpad = useCallback(() => {
    if (!solution || !solutionMetadata) return;
    
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
    const csvContent = grid.colors
      .map(row => row.map(c => c === null ? -1 : c).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "connectivity-sketchpad-colors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [grid]);

  // Download solution colorset as CSV
  const handleDownloadSolutionColors = useCallback(() => {
    if (!solution) return;
    
    const csvContent = solution.assignedColors
      .map(row => row.map(c => c === null ? -1 : c).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "connectivity-solution-colors.csv";
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
          if (isNaN(num) || num === -1) return null;
          return num >= 0 ? num : null;
        })
      );
      
      const newHeight = parsedColors.length;
      const newWidth = parsedColors[0]?.length || gridWidth;
      
      const clampedWidth = Math.min(Math.max(newWidth, 2), 20);
      const clampedHeight = Math.min(Math.max(newHeight, 2), 20);
      
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

  // Create a grid structure for the solution display
  const solutionDisplayGrid: ColorGrid | null = solution && solutionMetadata ? {
    width: solutionMetadata.width,
    height: solutionMetadata.height,
    colors: solution.assignedColors,
  } : null;

  return (
    <div className="app">
      <h1>Connectivity Solver</h1>
      <p className="description">
        Paint cells with colors and click Solve to find a valid coloring where each
        color forms a connected component. This page uses an <strong>arborescence-style encoding</strong> with
        level constraints for strong SAT propagation.
      </p>
      <p className="description" style={{ fontSize: "0.9em", fontStyle: "italic", marginTop: "-8px" }}>
        <strong>Simplified mode:</strong> Colors only - no roots or distance constraints.
        Each color class is connected via a tree rooted at an automatically selected cell.
        <a href="/" style={{ marginLeft: "8px" }}>→ Full solver with roots &amp; distances</a>
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
            
            {/* Grid Size Controls */}
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "14px" }}>Width:</label>
                <input
                  type="number"
                  min="2"
                  max="20"
                  value={gridWidth}
                  onChange={(e) => handleWidthChange(parseInt(e.target.value, 10))}
                  style={{ width: "60px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "14px" }}>Height:</label>
                <input
                  type="number"
                  min="2"
                  max="20"
                  value={gridHeight}
                  onChange={(e) => handleHeightChange(parseInt(e.target.value, 10))}
                  style={{ width: "60px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "14px" }}>Grid:</label>
                <select
                  value={gridType}
                  onChange={(e) => setGridType(e.target.value as GridType)}
                  style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
                >
                  <option value="square">Square</option>
                  <option value="hex">Hexagon</option>
                  <option value="octagon">Octagon</option>
                  <option value="cairo">Cairo</option>
                  <option value="cairobridge">CairoBridge</option>
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
              <button
                onClick={handleSolve}
                disabled={solving}
                style={{
                  padding: "8px 20px",
                  backgroundColor: solving ? "#95a5a6" : "#27ae60",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: solving ? "not-allowed" : "pointer",
                  fontWeight: "bold",
                }}
              >
                {solving ? "Solving..." : "🔍 Solve"}
              </button>
              {solving && (
                <button
                  onClick={handleCancel}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#e74c3c",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleClear}
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
                onClick={handleDownloadSketchpadColors}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#9b59b6",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                Download CSV
              </button>
              <label
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#16a085",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                Upload CSV
                <input
                  type="file"
                  accept=".csv"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadColors(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            {/* Solver and Options */}
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "14px" }}>Solver:</label>
                <select
                  value={solverType}
                  onChange={(e) => setSolverType(e.target.value as SolverType)}
                  style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
                >
                  <option value="cadical">CaDiCaL</option>
                  <option value="minisat">MiniSat</option>
                  <option value="dpll">DPLL</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "14px" }}>
                  <input
                    type="checkbox"
                    checked={reduceToTree}
                    onChange={(e) => setReduceToTree(e.target.checked)}
                    style={{ marginRight: "4px" }}
                  />
                  Reduce to tree (Kruskal)
                </label>
              </div>
            </div>

            {/* Status Messages */}
            {solutionStatus === "found" && (
              <div style={{ 
                padding: "8px 12px", 
                backgroundColor: "#d4edda", 
                color: "#155724", 
                borderRadius: "4px", 
                marginBottom: "16px",
                fontSize: "14px"
              }}>
                ✅ Solution found!
                {solveTime && ` (${solveTime.toFixed(0)}ms)`}
              </div>
            )}
            {solutionStatus === "unsatisfiable" && (
              <div style={{ 
                padding: "8px 12px", 
                backgroundColor: "#fff3cd", 
                color: "#856404", 
                borderRadius: "4px", 
                marginBottom: "16px",
                fontSize: "14px"
              }}>
                ⚠️ No solution exists for this configuration.
                {solveTime && ` (${solveTime.toFixed(0)}ms)`}
              </div>
            )}
            {solutionStatus === "error" && (
              <div style={{ 
                padding: "8px 12px", 
                backgroundColor: "#f8d7da", 
                color: "#721c24", 
                borderRadius: "4px", 
                marginBottom: "16px",
                fontSize: "14px"
              }}>
                ❌ {errorMessage}
                {solveTime && ` (${solveTime.toFixed(0)}ms)`}
              </div>
            )}

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

            {/* Color Palette */}
            <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "#ecf0f1", borderRadius: "6px" }}>
              <div style={{ fontSize: "13px", color: "#7f8c8d", marginBottom: "8px" }}>
                <strong>Color Palette:</strong> Click cells to paint colors
              </div>
              <ColorPalette
                selectedColor={selectedColor}
                onColorSelect={setSelectedColor}
                numColors={numColors}
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
                          // Find the root from distanceLevels (it's at level 0)
                          const levels = solution.distanceLevels![levelKey];
                          let rootInfo = "";
                          for (let r = 0; r < levels.length; r++) {
                            for (let c = 0; c < levels[r].length; c++) {
                              if (levels[r][c] === 0) {
                                rootInfo = ` (root: ${r},${c})`;
                                break;
                              }
                            }
                            if (rootInfo) break;
                          }
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

export default ConnectivityApp;
