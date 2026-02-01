import { useState, useCallback, useEffect, useRef } from "react";
import "./App.css";
import { EdgeColoringGrid, EDGE_COLORS } from "./polyform-explorer/EdgeColoringGrid";
import type { EdgeDirection } from "./polyform-explorer/EdgeColoringGrid";
import { EdgeColoringViewer } from "./polyform-explorer/EdgeColoringViewer";
import { downloadSvg } from "./polyform-explorer/downloadUtils";
import type { EdgeColoringResult, ColoredTile, EdgeColor } from "./problem/edge-coloring-tiling";

/**
 * Edge Coloring Explorer Component
 * Allows users to build a polyomino shape, assign colors to edges,
 * and solve a tiling problem where adjacent edges must match colors.
 */
export function EdgeColoringExplorer() {
  // Grid state
  const [gridWidth, setGridWidth] = useState(8);
  const [gridHeight, setGridHeight] = useState(8);
  const [widthInput, setWidthInput] = useState("8");
  const [heightInput, setHeightInput] = useState("8");
  const [widthError, setWidthError] = useState(false);
  const [heightError, setHeightError] = useState(false);
  
  // Cell state
  const [cells, setCells] = useState<boolean[][]>(() => 
    Array.from({ length: 8 }, () => Array(8).fill(false))
  );
  
  // Edge colors: Map from "row,col,direction" to color index
  const [edgeColors, setEdgeColors] = useState<Map<string, number>>(new Map());
  
  // Color selection
  const [numColors, setNumColors] = useState(2);
  const [selectedColor, setSelectedColor] = useState(0);
  
  // Tiling solver state
  const [tilingWidthInput, setTilingWidthInput] = useState("6");
  const [tilingHeightInput, setTilingHeightInput] = useState("6");
  const [tilingWidth, setTilingWidth] = useState(6);
  const [tilingHeight, setTilingHeight] = useState(6);
  const [tilingWidthError, setTilingWidthError] = useState(false);
  const [tilingHeightError, setTilingHeightError] = useState(false);
  const [solving, setSolving] = useState(false);
  const [tilingResult, setTilingResult] = useState<EdgeColoringResult | null>(null);
  const [tilingError, setTilingError] = useState<string | null>(null);
  const [tilingStats, setTilingStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const tilingSvgRef = useRef<SVGSVGElement | null>(null);
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  // Create empty grid
  const createEmptyGrid = (w: number, h: number): boolean[][] => {
    return Array.from({ length: h }, () => Array(w).fill(false));
  };
  
  // Handle width input blur
  const handleWidthBlur = useCallback(() => {
    const parsed = parseInt(widthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setWidthError(false);
      if (parsed !== gridWidth) {
        setGridWidth(parsed);
        setCells(prev => {
          const newCells = createEmptyGrid(parsed, gridHeight);
          for (let row = 0; row < Math.min(prev.length, gridHeight); row++) {
            for (let col = 0; col < Math.min(prev[row].length, parsed); col++) {
              newCells[row][col] = prev[row][col];
            }
          }
          return newCells;
        });
      }
    } else {
      setWidthError(true);
    }
  }, [widthInput, gridWidth, gridHeight]);
  
  // Handle height input blur
  const handleHeightBlur = useCallback(() => {
    const parsed = parseInt(heightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setHeightError(false);
      if (parsed !== gridHeight) {
        setGridHeight(parsed);
        setCells(prev => {
          const newCells = createEmptyGrid(gridWidth, parsed);
          for (let row = 0; row < Math.min(prev.length, parsed); row++) {
            for (let col = 0; col < Math.min(prev[row].length, gridWidth); col++) {
              newCells[row][col] = prev[row][col];
            }
          }
          return newCells;
        });
      }
    } else {
      setHeightError(true);
    }
  }, [heightInput, gridHeight, gridWidth]);
  
  // Handle tiling width blur
  const handleTilingWidthBlur = useCallback(() => {
    const parsed = parseInt(tilingWidthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingWidthError(false);
      setTilingWidth(parsed);
    } else {
      setTilingWidthError(true);
    }
  }, [tilingWidthInput]);
  
  // Handle tiling height blur
  const handleTilingHeightBlur = useCallback(() => {
    const parsed = parseInt(tilingHeightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingHeightError(false);
      setTilingHeight(parsed);
    } else {
      setTilingHeightError(true);
    }
  }, [tilingHeightInput]);
  
  // Toggle cell
  const handleCellClick = useCallback((row: number, col: number) => {
    setCells(prev => {
      const newCells = prev.map(r => [...r]);
      newCells[row][col] = !newCells[row][col];
      return newCells;
    });
    // Clear edge colors for this cell if it's being turned off
    if (cells[row]?.[col]) {
      setEdgeColors(prev => {
        const newMap = new Map(prev);
        newMap.delete(`${row},${col},top`);
        newMap.delete(`${row},${col},bottom`);
        newMap.delete(`${row},${col},left`);
        newMap.delete(`${row},${col},right`);
        return newMap;
      });
    }
  }, [cells]);
  
  // Handle edge click - cycle color or set selected color
  const handleEdgeClick = useCallback((row: number, col: number, direction: EdgeDirection) => {
    setEdgeColors(prev => {
      const newMap = new Map(prev);
      const key = `${row},${col},${direction}`;
      newMap.set(key, selectedColor);
      return newMap;
    });
  }, [selectedColor]);
  
  // Clear all
  const handleClear = useCallback(() => {
    setCells(createEmptyGrid(gridWidth, gridHeight));
    setEdgeColors(new Map());
  }, [gridWidth, gridHeight]);
  
  // Convert state to ColoredTile format
  const buildColoredTile = useCallback((): ColoredTile => {
    // Find filled cells
    const filledCells: { row: number; col: number }[] = [];
    for (let row = 0; row < cells.length; row++) {
      for (let col = 0; col < cells[row].length; col++) {
        if (cells[row][col]) {
          filledCells.push({ row, col });
        }
      }
    }
    
    // Build edge colors array
    const edgeColorsList: EdgeColor[] = [];
    for (let idx = 0; idx < filledCells.length; idx++) {
      const { row, col } = filledCells[idx];
      
      // Check each direction
      const directions: EdgeDirection[] = ["top", "bottom", "left", "right"];
      for (const dir of directions) {
        const key = `${row},${col},${dir}`;
        const color = edgeColors.get(key);
        if (color !== undefined) {
          edgeColorsList.push({
            cellIndex: idx,
            direction: dir,
            color,
          });
        }
      }
    }
    
    return {
      cells,
      edgeColors: edgeColorsList,
      numColors,
    };
  }, [cells, edgeColors, numColors]);
  
  // Cancel solving
  const handleCancelSolving = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setSolving(false);
      setTilingError("Solving cancelled by user.");
      setTilingStats(null);
    }
  }, []);
  
  // Solve tiling
  const handleSolveTiling = useCallback(() => {
    // Check if there are any filled cells
    const hasFilledCells = cells.some(row => row.some(c => c));
    if (!hasFilledCells) {
      setTilingError("Please draw a tile first by clicking cells above.");
      return;
    }
    
    // Check if there are edge colors defined
    if (edgeColors.size === 0) {
      setTilingError("Please assign colors to edges by clicking on them.");
      return;
    }
    
    // Clear previous results
    setTilingResult(null);
    setTilingError(null);
    setTilingStats(null);
    setSolving(true);
    
    // Build the colored tile
    const tile = buildColoredTile();
    
    // Create worker
    const worker = new Worker(
      new URL("./problem/edge-coloring-tiling.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    
    worker.onmessage = (event) => {
      const response = event.data;
      
      if (response.messageType === "progress") {
        setTilingStats(response.stats);
      } else if (response.messageType === "result") {
        setSolving(false);
        if (response.success) {
          setTilingResult(response.result);
        } else {
          setTilingError(response.error || "Unknown error");
        }
        worker.terminate();
        workerRef.current = null;
      }
    };
    
    worker.onerror = (error) => {
      setSolving(false);
      setTilingError(`Worker error: ${error.message}`);
      worker.terminate();
      workerRef.current = null;
    };
    
    // Send request
    worker.postMessage({
      tile,
      tilingWidth,
      tilingHeight,
    });
  }, [cells, edgeColors, buildColoredTile, tilingWidth, tilingHeight]);
  
  // Download SVG
  const handleDownloadSvg = useCallback(() => {
    if (!tilingSvgRef.current) return;
    downloadSvg(tilingSvgRef.current, `edge-coloring-${tilingWidth}x${tilingHeight}.svg`);
  }, [tilingWidth, tilingHeight]);
  
  // Count filled cells
  const filledCount = cells.reduce((sum, row) => sum + row.filter(c => c).length, 0);
  
  return (
    <div className="app">
      <h1>🎨 Edge Coloring Polyomino Tiling</h1>
      <p className="description">
        Draw a polyomino by clicking cells, then click on edges to assign colors.
        The solver will try to tile a region such that adjacent tiles have matching edge colors.
      </p>
      
      {/* Grid Controls */}
      <div style={{ 
        marginBottom: "16px",
        padding: "16px",
        backgroundColor: "#f8f9fa",
        borderRadius: "8px",
        border: "1px solid #dee2e6",
      }}>
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <label style={{ marginRight: "8px" }}>Grid Width:</label>
            <input
              type="text"
              value={widthInput}
              onChange={(e) => { setWidthInput(e.target.value); setWidthError(false); }}
              onBlur={handleWidthBlur}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: widthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
              }}
            />
          </div>
          <div>
            <label style={{ marginRight: "8px" }}>Grid Height:</label>
            <input
              type="text"
              value={heightInput}
              onChange={(e) => { setHeightInput(e.target.value); setHeightError(false); }}
              onBlur={handleHeightBlur}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: heightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
              }}
            />
          </div>
          <button
            onClick={handleClear}
            style={{
              padding: "8px 16px",
              backgroundColor: "#e74c3c",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            🗑️ Clear
          </button>
          <span style={{ fontSize: "14px", color: "#6c757d" }}>
            {filledCount} cell{filledCount !== 1 ? 's' : ''} filled
          </span>
        </div>
        
        {/* Color Selection */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ marginRight: "12px", fontWeight: "bold" }}>Edge Color:</label>
          <div style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
            {Array.from({ length: numColors }, (_, i) => (
              <button
                key={i}
                onClick={() => setSelectedColor(i)}
                style={{
                  width: "32px",
                  height: "32px",
                  backgroundColor: EDGE_COLORS[i % EDGE_COLORS.length],
                  border: selectedColor === i ? "3px solid #2c3e50" : "2px solid #bdc3c7",
                  borderRadius: "4px",
                  cursor: "pointer",
                  transition: "border-color 0.2s",
                }}
                title={`Color ${i + 1}`}
              />
            ))}
            <button
              onClick={() => setNumColors(Math.min(numColors + 1, EDGE_COLORS.length))}
              disabled={numColors >= EDGE_COLORS.length}
              style={{
                padding: "4px 8px",
                backgroundColor: numColors >= EDGE_COLORS.length ? "#bdc3c7" : "#27ae60",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: numColors >= EDGE_COLORS.length ? "not-allowed" : "pointer",
                fontSize: "16px",
              }}
              title="Add color"
            >
              +
            </button>
            {numColors > 1 && (
              <button
                onClick={() => {
                  setNumColors(numColors - 1);
                  if (selectedColor >= numColors - 1) {
                    setSelectedColor(numColors - 2);
                  }
                }}
                style={{
                  padding: "4px 8px",
                  backgroundColor: "#e74c3c",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "16px",
                }}
                title="Remove color"
              >
                −
              </button>
            )}
          </div>
        </div>
        
        <p style={{ fontSize: "13px", color: "#6c757d", margin: 0 }}>
          Click cells to toggle them. Click on edges of filled cells to set their color.
        </p>
      </div>
      
      {/* Drawing Grid */}
      <div style={{ 
        padding: "16px", 
        backgroundColor: "#f8f9fa", 
        borderRadius: "8px",
        border: "2px solid #3498db",
        display: "inline-block",
        marginBottom: "24px",
      }}>
        <EdgeColoringGrid
          cells={cells}
          edgeColors={edgeColors}
          selectedColor={selectedColor}
          onCellClick={handleCellClick}
          onEdgeClick={handleEdgeClick}
        />
      </div>
      
      {/* Tiling Solver Section */}
      <div style={{ 
        padding: "16px", 
        backgroundColor: "#f8f9fa", 
        borderRadius: "8px",
        border: "1px solid #dee2e6",
      }}>
        <h3 style={{ marginTop: 0, marginBottom: "12px" }}>🧩 Edge Coloring Tiling Solver</h3>
        <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "16px" }}>
          Tile a grid region with your polyomino. Adjacent tiles must have matching edge colors.
          It's OK if the tiling isn't perfect (similar to Polyform problem).
        </p>
        
        {/* Tiling Grid Size Inputs */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label style={{ marginRight: "8px" }}>Tiling Width:</label>
            <input
              type="text"
              value={tilingWidthInput}
              onChange={(e) => { setTilingWidthInput(e.target.value); setTilingWidthError(false); }}
              onBlur={handleTilingWidthBlur}
              disabled={solving}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: tilingWidthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
              }}
            />
          </div>
          <div>
            <label style={{ marginRight: "8px" }}>Tiling Height:</label>
            <input
              type="text"
              value={tilingHeightInput}
              onChange={(e) => { setTilingHeightInput(e.target.value); setTilingHeightError(false); }}
              onBlur={handleTilingHeightBlur}
              disabled={solving}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: tilingHeightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
              }}
            />
          </div>
          <button
            onClick={handleSolveTiling}
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
            {solving ? "⏳ Solving..." : "🔍 Solve Tiling"}
          </button>
          {solving && (
            <button
              onClick={handleCancelSolving}
              style={{
                padding: "8px 20px",
                backgroundColor: "#e74c3c",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ❌ Cancel
            </button>
          )}
        </div>
        
        {/* Progress/Stats display */}
        {solving && tilingStats && (
          <div style={{ 
            padding: "12px", 
            backgroundColor: "#e8f4fd", 
            borderRadius: "4px",
            marginBottom: "12px",
            fontSize: "14px",
          }}>
            <strong>Solving...</strong> {tilingStats.numVars.toLocaleString()} variables, {tilingStats.numClauses.toLocaleString()} clauses
          </div>
        )}
        
        {/* Error display */}
        {tilingError && (
          <div style={{ 
            padding: "12px", 
            backgroundColor: "#fdecea", 
            borderRadius: "4px",
            marginBottom: "12px",
            color: "#e74c3c",
            fontSize: "14px",
          }}>
            ❌ {tilingError}
          </div>
        )}
        
        {/* Result display */}
        {tilingResult && (
          <div style={{ marginTop: "16px" }}>
            {tilingResult.satisfiable ? (
              <>
                <div style={{ 
                  padding: "12px", 
                  backgroundColor: "#d4edda", 
                  borderRadius: "4px",
                  marginBottom: "12px",
                  color: "#155724",
                  fontSize: "14px",
                }}>
                  ✅ <strong>Solution found!</strong> Using {tilingResult.placements?.length ?? 0} tile placements.
                  <br/>
                  <span style={{ fontSize: "12px", color: "#6c757d" }}>
                    ({tilingResult.stats.numPlacements.toLocaleString()} total possible placements, {tilingResult.stats.numVariables.toLocaleString()} vars, {tilingResult.stats.numClauses.toLocaleString()} clauses)
                  </span>
                </div>
                <EdgeColoringViewer
                  width={tilingWidth}
                  height={tilingHeight}
                  placements={tilingResult.placements || []}
                  svgRef={tilingSvgRef}
                  showEdgeColors={true}
                  numColors={numColors}
                />
                
                {/* Download button */}
                <div style={{ marginTop: "12px" }}>
                  <button
                    onClick={handleDownloadSvg}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#6c757d",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    💾 Save as SVG
                  </button>
                </div>
              </>
            ) : (
              <div style={{ 
                padding: "12px", 
                backgroundColor: "#f8d7da", 
                borderRadius: "4px",
                marginBottom: "12px",
                color: "#721c24",
                fontSize: "14px",
              }}>
                ❌ <strong>No solution found.</strong> The tile cannot cover the region with matching edge colors.
                <br/>
                <span style={{ fontSize: "12px" }}>
                  Try a different tile shape, edge coloring, or region size.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default EdgeColoringExplorer;
