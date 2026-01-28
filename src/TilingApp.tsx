import React, { useCallback, useEffect, useRef, useState } from "react";
import type { GridType, TilingSolution } from "./problem";
import { SketchpadGrid, COLORS } from "./components";
import TilingWorker from "./problem/tiling.worker?worker";
import type { TilingSolverRequest, TilingSolverResponse } from "./problem";
import "./App.css";

/**
 * Color palette component for selecting colors in the tile editor
 */
interface ColorPaletteProps {
  selectedColor: number | null;
  onColorSelect: (color: number | null) => void;
}

function TileColorPalette({ selectedColor, onColorSelect }: ColorPaletteProps) {
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ fontSize: "12px", color: "#7f8c8d", marginRight: "8px" }}>
        Paint tile:
      </div>
      {/* Clear/eraser button */}
      <button
        onClick={() => onColorSelect(null)}
        style={{
          width: "32px",
          height: "32px",
          border: selectedColor === null ? "3px solid #2c3e50" : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          background: "repeating-linear-gradient(45deg, #e0e0e0, #e0e0e0 2px, #f5f5f5 2px, #f5f5f5 8px)",
          boxShadow: selectedColor === null ? "0 0 8px rgba(0,0,0,0.3)" : "none",
        }}
        title="Eraser"
      />
      {/* First color button (tile cell) */}
      <button
        onClick={() => onColorSelect(0)}
        style={{
          width: "32px",
          height: "32px",
          backgroundColor: COLORS[0],
          border: selectedColor === 0 ? "3px solid #2c3e50" : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          boxShadow: selectedColor === 0 ? "0 0 8px rgba(0,0,0,0.3)" : "none",
        }}
        title="Tile cell"
      />
    </div>
  );
}

interface TileGrid {
  width: number;
  height: number;
  colors: (number | null)[][];
}

function createEmptyTileGrid(width: number, height: number): TileGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null)
    ),
  };
}

function TilingApp() {
  // Tile editor state
  const [tileWidth, setTileWidth] = useState(3);
  const [tileHeight, setTileHeight] = useState(3);
  const [tileGrid, setTileGrid] = useState<TileGrid>(() =>
    createEmptyTileGrid(tileWidth, tileHeight)
  );
  const [selectedColor, setSelectedColor] = useState<number | null>(0);
  const [gridType, setGridType] = useState<GridType>("square");

  // Target grid state
  const [targetWidth, setTargetWidth] = useState(6);
  const [targetHeight, setTargetHeight] = useState(6);

  // Solver state
  const [solving, setSolving] = useState(false);
  const [solution, setSolution] = useState<TilingSolution | null>(null);
  const [solutionStatus, setSolutionStatus] = useState<
    "none" | "found" | "unsatisfiable" | "error"
  >("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solveTime, setSolveTime] = useState<number | null>(null);
  const [satStats, setSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);

  // Web Worker ref
  const workerRef = useRef<Worker | null>(null);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Handle tile cell click
  const handleTileCellClick = useCallback(
    (row: number, col: number) => {
      setTileGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolutionStatus("none");
    },
    [selectedColor]
  );

  // Handle tile cell drag
  const handleTileCellDrag = useCallback(
    (row: number, col: number) => {
      setTileGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolutionStatus("none");
    },
    [selectedColor]
  );

  // Handle tile width change
  const handleTileWidthChange = useCallback((width: number) => {
    const clampedWidth = Math.min(Math.max(width, 1), 10);
    setTileWidth(clampedWidth);
    setTileGrid((prev) => {
      const newColors = Array.from({ length: prev.height }, (_, row) =>
        Array.from({ length: clampedWidth }, (_, col) =>
          col < prev.width ? prev.colors[row][col] : null
        )
      );
      return { width: clampedWidth, height: prev.height, colors: newColors };
    });
  }, []);

  // Handle tile height change
  const handleTileHeightChange = useCallback((height: number) => {
    const clampedHeight = Math.min(Math.max(height, 1), 10);
    setTileHeight(clampedHeight);
    setTileGrid((prev) => {
      const newColors = Array.from({ length: clampedHeight }, (_, row) =>
        Array.from({ length: prev.width }, (_, col) =>
          row < prev.height ? prev.colors[row][col] : null
        )
      );
      return { width: prev.width, height: clampedHeight, colors: newColors };
    });
  }, []);

  // Handle solve button
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
    setSatStats(null);

    const startTime = performance.now();

    // Create a new worker
    const worker = new TilingWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<TilingSolverResponse>) => {
      const { success, solution, error, messageType, stats } = event.data;

      // Handle progress message
      if (messageType === "progress" && stats) {
        setSatStats(stats);
        return;
      }

      // Handle final result
      const endTime = performance.now();
      setSolveTime(endTime - startTime);

      if (solution?.stats) {
        setSatStats(solution.stats);
      }

      if (success && solution) {
        setSolution(solution);
        setSolutionStatus("found");
        setErrorMessage(null);
      } else if (success && !solution) {
        setSolutionStatus("unsatisfiable");
        setErrorMessage(null);
      } else {
        setSolutionStatus("error");
        setErrorMessage(error || "An unexpected error occurred");
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
      setErrorMessage("Worker crashed - the problem may be too large");
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };

    // Send the solve request
    const request: TilingSolverRequest = {
      gridType,
      tileColors: tileGrid.colors,
      tileWidth: tileGrid.width,
      tileHeight: tileGrid.height,
      targetWidth,
      targetHeight,
    };
    worker.postMessage(request);
  }, [gridType, tileGrid, targetWidth, targetHeight]);

  // Handle cancel button
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

  // Handle clear tile button
  const handleClearTile = useCallback(() => {
    setTileGrid(createEmptyTileGrid(tileWidth, tileHeight));
    setSolutionStatus("none");
  }, [tileWidth, tileHeight]);

  // Count selected tile cells
  const tileCellCount = tileGrid.colors.flat().filter((c) => c !== null).length;

  return (
    <div className="app">
      <h1>Tiling Solver</h1>
      <p className="description">
        Define a tile shape below, then specify the target grid dimensions.
        The solver will find a way to fill the target grid using translated
        and rotated copies of your tile without overlapping.
      </p>
      <p className="description" style={{ fontSize: "0.9em", fontStyle: "italic", marginTop: "-8px" }}>
        <strong>Note:</strong> The tile can extend beyond the target grid boundaries,
        and overlaps there are also disallowed.
      </p>

      {/* Navigation link back to main app */}
      <div style={{ marginBottom: "16px" }}>
        <a href="#/" style={{ color: "#3498db", textDecoration: "none" }}>
          ← Back to Grid Coloring Solver
        </a>
      </div>

      {/* Main content area */}
      <div style={{ display: "flex", gap: "40px", flexWrap: "wrap", alignItems: "flex-start" }}>
        
        {/* Tile Definition Section */}
        <div style={{ flex: "1", minWidth: "300px" }}>
          <div style={{ 
            padding: "16px", 
            backgroundColor: "#f8f9fa", 
            borderRadius: "8px",
            border: "2px solid #3498db",
          }}>
            <h2 style={{ margin: "0 0 16px 0", color: "#2c3e50", fontSize: "1.3em" }}>
              🧩 Define Tile
            </h2>

            {/* Grid type selector */}
            <div style={{ marginBottom: "12px" }}>
              <label style={{ marginRight: "8px", fontSize: "14px" }}>Grid Type:</label>
              <select
                value={gridType}
                onChange={(e) => setGridType(e.target.value as GridType)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  border: "1px solid #bdc3c7",
                  fontSize: "14px",
                }}
              >
                <option value="square">Square</option>
                <option value="hex">Hexagonal</option>
              </select>
            </div>

            {/* Tile size controls */}
            <div style={{ display: "flex", gap: "16px", marginBottom: "12px", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: "14px", marginRight: "8px" }}>Tile Width:</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={tileWidth}
                  onChange={(e) => handleTileWidthChange(parseInt(e.target.value, 10) || 1)}
                  style={{
                    width: "60px",
                    padding: "6px",
                    borderRadius: "4px",
                    border: "1px solid #bdc3c7",
                    fontSize: "14px",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "14px", marginRight: "8px" }}>Tile Height:</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={tileHeight}
                  onChange={(e) => handleTileHeightChange(parseInt(e.target.value, 10) || 1)}
                  style={{
                    width: "60px",
                    padding: "6px",
                    borderRadius: "4px",
                    border: "1px solid #bdc3c7",
                    fontSize: "14px",
                  }}
                />
              </div>
            </div>

            {/* Color palette for tile */}
            <div style={{ marginBottom: "12px" }}>
              <TileColorPalette
                selectedColor={selectedColor}
                onColorSelect={setSelectedColor}
              />
            </div>

            {/* Tile grid editor */}
            <div style={{ marginTop: "16px" }}>
              <SketchpadGrid
                grid={tileGrid}
                solution={null}
                selectedColor={selectedColor}
                onCellClick={handleTileCellClick}
                onCellDrag={handleTileCellDrag}
                cellSize={40}
                gridType={gridType}
              />
            </div>

            {/* Tile info and clear button */}
            <div style={{ marginTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "#7f8c8d" }}>
                Tile has {tileCellCount} cell{tileCellCount !== 1 ? "s" : ""}
              </span>
              <button
                onClick={handleClearTile}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#e74c3c",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                Clear Tile
              </button>
            </div>
          </div>
        </div>

        {/* Target Grid & Solution Section */}
        <div style={{ flex: "1", minWidth: "350px" }}>
          <div style={{ 
            padding: "16px", 
            backgroundColor: "#f0fff4", 
            borderRadius: "8px",
            border: "2px solid #27ae60",
          }}>
            <h2 style={{ margin: "0 0 16px 0", color: "#27ae60", fontSize: "1.3em" }}>
              🎯 Target Grid & Solution
            </h2>

            {/* Target size controls */}
            <div style={{ display: "flex", gap: "16px", marginBottom: "12px", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: "14px", marginRight: "8px" }}>Target Width:</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={targetWidth}
                  onChange={(e) => {
                    setTargetWidth(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 20));
                    setSolution(null);
                    setSolutionStatus("none");
                  }}
                  style={{
                    width: "60px",
                    padding: "6px",
                    borderRadius: "4px",
                    border: "1px solid #bdc3c7",
                    fontSize: "14px",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "14px", marginRight: "8px" }}>Target Height:</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={targetHeight}
                  onChange={(e) => {
                    setTargetHeight(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 20));
                    setSolution(null);
                    setSolutionStatus("none");
                  }}
                  style={{
                    width: "60px",
                    padding: "6px",
                    borderRadius: "4px",
                    border: "1px solid #bdc3c7",
                    fontSize: "14px",
                  }}
                />
              </div>
            </div>

            {/* Solve/Cancel buttons */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <button
                onClick={handleSolve}
                disabled={solving || tileCellCount === 0}
                style={{
                  padding: "10px 20px",
                  backgroundColor: solving || tileCellCount === 0 ? "#95a5a6" : "#27ae60",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: solving || tileCellCount === 0 ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: "bold",
                }}
              >
                {solving ? "Solving..." : "Solve"}
              </button>
              {solving && (
                <button
                  onClick={handleCancel}
                  style={{
                    padding: "10px 20px",
                    backgroundColor: "#e74c3c",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  Cancel
                </button>
              )}
            </div>

            {/* Status messages */}
            {solutionStatus === "found" && (
              <div style={{ 
                padding: "8px 12px", 
                backgroundColor: "#d4edda", 
                borderRadius: "4px", 
                marginBottom: "12px",
                color: "#155724",
                fontSize: "14px",
              }}>
                ✅ Solution found!
                {solveTime && ` (${solveTime.toFixed(0)}ms)`}
                {satStats && ` • ${satStats.numVars.toLocaleString()} vars, ${satStats.numClauses.toLocaleString()} clauses`}
              </div>
            )}
            {solutionStatus === "unsatisfiable" && (
              <div style={{ 
                padding: "8px 12px", 
                backgroundColor: "#fff3cd", 
                borderRadius: "4px", 
                marginBottom: "12px",
                color: "#856404",
                fontSize: "14px",
              }}>
                ⚠️ No solution exists - the tile cannot fill the target grid
                {solveTime && ` (${solveTime.toFixed(0)}ms)`}
              </div>
            )}
            {solutionStatus === "error" && (
              <div style={{ 
                padding: "8px 12px", 
                backgroundColor: "#f8d7da", 
                borderRadius: "4px", 
                marginBottom: "12px",
                color: "#721c24",
                fontSize: "14px",
              }}>
                ❌ Error: {errorMessage}
              </div>
            )}
            {solving && satStats && (
              <div style={{ 
                padding: "8px 12px", 
                backgroundColor: "#cce5ff", 
                borderRadius: "4px", 
                marginBottom: "12px",
                color: "#004085",
                fontSize: "14px",
              }}>
                ⏳ Solving... {satStats.numVars.toLocaleString()} vars, {satStats.numClauses.toLocaleString()} clauses
              </div>
            )}

            {/* Solution visualization */}
            {solution && (
              <div style={{ marginTop: "16px" }}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#2c3e50" }}>
                  Solution ({solution.usedPlacements.length} placements):
                </h3>
                <TilingSolutionGrid
                  solution={solution}
                  targetWidth={targetWidth}
                  targetHeight={targetHeight}
                  gridType={gridType}
                  cellSize={40}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Component to visualize the tiling solution
 */
interface TilingSolutionGridProps {
  solution: TilingSolution;
  targetWidth: number;
  targetHeight: number;
  gridType: GridType;
  cellSize: number;
}

function TilingSolutionGrid({
  solution,
  targetWidth,
  targetHeight,
  gridType,
  cellSize,
}: TilingSolutionGridProps) {
  const { cellPlacements, usedPlacements } = solution;

  // Generate distinct colors for each placement
  const placementColors = usedPlacements.map((_, idx) => {
    const hue = (idx * 137.508) % 360; // Golden angle for good distribution
    return `hsl(${hue}, 70%, 65%)`;
  });

  // For square grid, render simple rectangles
  if (gridType === "square") {
    const padding = 2;
    const svgWidth = targetWidth * cellSize + padding * 2;
    const svgHeight = targetHeight * cellSize + padding * 2;

    return (
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: "block", backgroundColor: "#f5f5f5", borderRadius: "4px" }}
      >
        <g transform={`translate(${padding}, ${padding})`}>
          {/* Grid cells */}
          {cellPlacements.map((row, rowIdx) =>
            row.map((placementIdx, colIdx) => {
              const x = colIdx * cellSize;
              const y = rowIdx * cellSize;
              const color = placementIdx >= 0 ? placementColors[placementIdx] : "#e0e0e0";
              return (
                <rect
                  key={`${rowIdx}-${colIdx}`}
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  fill={color}
                  stroke="#999"
                  strokeWidth="1"
                />
              );
            })
          )}
          {/* Placement boundaries - draw thicker lines between different placements */}
          {cellPlacements.map((row, rowIdx) =>
            row.map((placementIdx, colIdx) => {
              const x = colIdx * cellSize;
              const y = rowIdx * cellSize;
              const lines: React.ReactNode[] = [];
              
              // Check right neighbor
              if (colIdx < targetWidth - 1 && cellPlacements[rowIdx][colIdx + 1] !== placementIdx) {
                lines.push(
                  <line
                    key={`h-${rowIdx}-${colIdx}`}
                    x1={x + cellSize}
                    y1={y}
                    x2={x + cellSize}
                    y2={y + cellSize}
                    stroke="#333"
                    strokeWidth="2"
                  />
                );
              }
              // Check bottom neighbor
              if (rowIdx < targetHeight - 1 && cellPlacements[rowIdx + 1][colIdx] !== placementIdx) {
                lines.push(
                  <line
                    key={`v-${rowIdx}-${colIdx}`}
                    x1={x}
                    y1={y + cellSize}
                    x2={x + cellSize}
                    y2={y + cellSize}
                    stroke="#333"
                    strokeWidth="2"
                  />
                );
              }
              return lines;
            })
          )}
          {/* Grid border */}
          <rect
            x={0}
            y={0}
            width={targetWidth * cellSize}
            height={targetHeight * cellSize}
            fill="none"
            stroke="#333"
            strokeWidth="2"
          />
        </g>
      </svg>
    );
  }

  // For hex grid, render hexagons
  const hexRadius = cellSize / 2;
  const hexWidth = hexRadius * Math.sqrt(3);
  const hexHeight = hexRadius * 2;
  const rowSpacing = hexHeight * 0.75;
  const colSpacing = hexWidth;

  const padding = hexRadius;
  const svgWidth = targetWidth * colSpacing + hexRadius + padding * 2;
  const svgHeight = targetHeight * rowSpacing + hexRadius + padding * 2;

  // Create hex path
  const hexPoints = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${Math.cos(angle) * hexRadius},${Math.sin(angle) * hexRadius}`;
  }).join(" ");

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: "block", backgroundColor: "#f5f5f5", borderRadius: "4px" }}
    >
      <g transform={`translate(${padding}, ${padding})`}>
        {cellPlacements.map((row, rowIdx) =>
          row.map((placementIdx, colIdx) => {
            const isOddRow = rowIdx % 2 === 1;
            const cx = colIdx * colSpacing + hexRadius + (isOddRow ? colSpacing / 2 : 0);
            const cy = rowIdx * rowSpacing + hexRadius;
            const color = placementIdx >= 0 ? placementColors[placementIdx] : "#e0e0e0";
            return (
              <polygon
                key={`${rowIdx}-${colIdx}`}
                points={hexPoints}
                transform={`translate(${cx}, ${cy})`}
                fill={color}
                stroke="#333"
                strokeWidth="1"
              />
            );
          })
        )}
      </g>
    </svg>
  );
}

export default TilingApp;
