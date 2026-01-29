import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import "./App.css";
import type { TilingResult } from "./problem/polyomino-tiling";
import type { HexTilingResult } from "./problem/polyhex-tiling";
import {
  type PolyformType,
  createEmptyBooleanGrid,
  rotatePolyomino,
  rotatePolyhex,
  rotatePolyiamond,
  transformPolyhex,
  transformPolyiamond,
  flipHorizontal,
  flipVertical,
} from "./utils/polyformTransforms";
import {
  SquareGrid,
  HexGrid,
  TriangleGrid,
  TilingViewer,
  HexTilingViewer,
  downloadSvg,
  exportCellsToJson,
  parseCoordsJson,
  downloadJson,
} from "./polyform-explorer";

/**
 * Polyform Explorer Component
 * Allows users to build polyomino, polyhex, or polyiamond shapes
 * with rotation and flip controls.
 */
export function PolyformExplorer() {
  const [polyformType, setPolyformType] = useState<PolyformType>("polyomino");
  const [gridWidth, setGridWidth] = useState(8);
  const [gridHeight, setGridHeight] = useState(8);
  const [cells, setCells] = useState<boolean[][]>(() => createEmptyBooleanGrid(8, 8));
  
  // Textbox input state (separate from actual values for validation)
  const [widthInput, setWidthInput] = useState("8");
  const [heightInput, setHeightInput] = useState("8");
  const [widthError, setWidthError] = useState(false);
  const [heightError, setHeightError] = useState(false);
  
  // Tiling solver state
  const [tilingWidthInput, setTilingWidthInput] = useState("6");
  const [tilingHeightInput, setTilingHeightInput] = useState("6");
  const [tilingWidth, setTilingWidth] = useState(6);
  const [tilingHeight, setTilingHeight] = useState(6);
  const [tilingWidthError, setTilingWidthError] = useState(false);
  const [tilingHeightError, setTilingHeightError] = useState(false);
  const [solving, setSolving] = useState(false);
  const [tilingResult, setTilingResult] = useState<TilingResult | HexTilingResult | null>(null);
  const [tilingError, setTilingError] = useState<string | null>(null);
  const [tilingStats, setTilingStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [solvedPolyformType, setSolvedPolyformType] = useState<PolyformType | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const tilingSvgRef = useRef<SVGSVGElement | null>(null);
  
  // Debugging state
  const [highlightedPlacement, setHighlightedPlacement] = useState<number | null>(null);
  const [highlightedEdge, setHighlightedEdge] = useState<number | null>(null);
  const [edgeInfo, setEdgeInfo] = useState<{
    cellIndex: number;
    edgeIndex: number;
    isInternal: boolean;
    coord1: { q: number; r: number };
    coord2: { q: number; r: number } | null;
    direction: string;
  } | null>(null);
  const [coordsJsonInput, setCoordsJsonInput] = useState("");
  const [hideFills, setHideFills] = useState(false);
  
  // Download SVG function
  const handleDownloadSvg = useCallback(() => {
    if (!tilingSvgRef.current) return;
    downloadSvg(tilingSvgRef.current, `tiling-${tilingWidth}x${tilingHeight}.svg`);
  }, [tilingWidth, tilingHeight]);
  
  // Export tile coordinates as JSON
  const handleExportTileCoords = useCallback(() => {
    const json = exportCellsToJson(cells);
    const coords = JSON.parse(json);
    navigator.clipboard.writeText(json).then(() => {
      alert(`Copied ${coords.length} coordinates to clipboard!`);
    }).catch(() => {
      // Fallback: show in a prompt
      prompt("Copy these coordinates:", json);
    });
  }, [cells]);
  
  // Import tile coordinates from JSON
  const handleImportTileCoords = useCallback(() => {
    const result = parseCoordsJson(coordsJsonInput);
    if (!result) {
      alert("Invalid JSON: expected an array of {row, col} objects with numeric values");
      return;
    }
    
    const { coords, maxRow, maxCol } = result;
    
    // Create new grid
    const newWidth = Math.max(maxCol + 1, 3);
    const newHeight = Math.max(maxRow + 1, 3);
    const newCells = createEmptyBooleanGrid(newWidth, newHeight);
    
    for (const { row, col } of coords) {
      if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
        newCells[row][col] = true;
      }
    }
    
    setGridWidth(newWidth);
    setGridHeight(newHeight);
    setWidthInput(String(newWidth));
    setHeightInput(String(newHeight));
    setCells(newCells);
    setCoordsJsonInput("");
    alert(`Imported ${coords.length} coordinates`);
  }, [coordsJsonInput]);
  
  // Download placements as JSON
  const handleDownloadPlacementsJson = useCallback(() => {
    if (!tilingResult || !tilingResult.placements) return;
    
    const data = {
      gridWidth: tilingWidth,
      gridHeight: tilingHeight,
      polyformType: solvedPolyformType,
      numPlacements: tilingResult.placements.length,
      placements: tilingResult.placements.map((p, i) => ({
        index: i,
        id: p.id,
        transformIndex: p.transformIndex,
        cells: p.cells,
        ...(("offset" in p) ? { offset: p.offset } : {}),
      })),
    };
    
    downloadJson(data, `placements-${tilingWidth}x${tilingHeight}.json`);
  }, [tilingResult, tilingWidth, tilingHeight, solvedPolyformType]);
  
  // Highlight navigation
  const handlePrevPlacement = useCallback(() => {
    if (!tilingResult?.placements?.length) return;
    setHighlightedEdge(null); // Clear edge when changing placement
    setHighlightedPlacement(prev => {
      if (prev === null) return tilingResult.placements!.length - 1;
      return (prev - 1 + tilingResult.placements!.length) % tilingResult.placements!.length;
    });
  }, [tilingResult]);
  
  const handleNextPlacement = useCallback(() => {
    if (!tilingResult?.placements?.length) return;
    setHighlightedEdge(null); // Clear edge when changing placement
    setHighlightedPlacement(prev => {
      if (prev === null) return 0;
      return (prev + 1) % tilingResult.placements!.length;
    });
  }, [tilingResult]);
  
  const handleClearHighlight = useCallback(() => {
    setHighlightedPlacement(null);
    setHighlightedEdge(null);
  }, []);
  
  // Edge cycling handlers (only available when placement is highlighted)
  const handlePrevEdge = useCallback(() => {
    if (highlightedPlacement === null || !tilingResult?.placements?.[highlightedPlacement]) return;
    const numCells = tilingResult.placements[highlightedPlacement].cells.length;
    const totalEdges = numCells * 6; // 6 edges per hex cell
    setHighlightedEdge(prev => {
      if (prev === null) return totalEdges - 1;
      return (prev - 1 + totalEdges) % totalEdges;
    });
  }, [highlightedPlacement, tilingResult]);
  
  const handleNextEdge = useCallback(() => {
    if (highlightedPlacement === null || !tilingResult?.placements?.[highlightedPlacement]) return;
    const numCells = tilingResult.placements[highlightedPlacement].cells.length;
    const totalEdges = numCells * 6; // 6 edges per hex cell
    setHighlightedEdge(prev => {
      if (prev === null) return 0;
      return (prev + 1) % totalEdges;
    });
  }, [highlightedPlacement, tilingResult]);
  
  const handleClearEdge = useCallback(() => {
    setHighlightedEdge(null);
  }, []);
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  // Validate and apply tiling width on blur
  const handleTilingWidthBlur = useCallback(() => {
    const parsed = parseInt(tilingWidthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingWidthError(false);
      setTilingWidth(parsed);
    } else {
      setTilingWidthError(true);
    }
  }, [tilingWidthInput]);
  
  // Validate and apply tiling height on blur
  const handleTilingHeightBlur = useCallback(() => {
    const parsed = parseInt(tilingHeightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingHeightError(false);
      setTilingHeight(parsed);
    } else {
      setTilingHeightError(true);
    }
  }, [tilingHeightInput]);
  
  // Solve tiling problem
  const handleSolveTiling = useCallback(() => {
    // Support polyomino and polyhex
    if (polyformType !== "polyomino" && polyformType !== "polyhex") {
      setTilingError("Tiling solver currently only supports polyomino (square) and polyhex (hexagon) tiles.");
      return;
    }
    
    // Check that tile has at least one cell
    const hasFilledCell = cells.some(row => row.some(c => c));
    if (!hasFilledCell) {
      setTilingError("Please draw a tile first by clicking cells above.");
      return;
    }
    
    // Clear previous results
    setTilingResult(null);
    setTilingError(null);
    setTilingStats(null);
    setSolvedPolyformType(null);
    setSolving(true);
    
    // Create worker
    const worker = new Worker(
      new URL("./problem/polyomino-tiling.worker.ts", import.meta.url),
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
          setSolvedPolyformType(response.polyformType || "polyomino");
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
    
    // Send request with polyform type
    worker.postMessage({
      cells,
      tilingWidth,
      tilingHeight,
      polyformType,
    });
  }, [cells, tilingWidth, tilingHeight, polyformType]);
  
  // Validate and apply width on blur
  const handleWidthBlur = useCallback(() => {
    const parsed = parseInt(widthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setWidthError(false);
      if (parsed !== gridWidth) {
        setGridWidth(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyBooleanGrid(parsed, gridHeight);
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
  
  // Validate and apply height on blur
  const handleHeightBlur = useCallback(() => {
    const parsed = parseInt(heightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setHeightError(false);
      if (parsed !== gridHeight) {
        setGridHeight(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyBooleanGrid(gridWidth, parsed);
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
  
  // Toggle cell on click
  const handleCellClick = useCallback((row: number, col: number) => {
    setCells(prev => {
      const newCells = prev.map(r => [...r]);
      newCells[row][col] = !newCells[row][col];
      return newCells;
    });
  }, []);
  
  // Rotate the polyform
  const handleRotate = useCallback(() => {
    setCells(prev => {
      let rotated: boolean[][];
      switch (polyformType) {
        case "polyomino":
          rotated = rotatePolyomino(prev);
          break;
        case "polyhex":
          rotated = rotatePolyhex(prev);
          break;
        case "polyiamond":
          rotated = rotatePolyiamond(prev);
          break;
        default:
          rotated = prev;
      }
      // Update dimensions to match rotated shape (clamped to max 50)
      const newHeight = Math.min(rotated.length, 50);
      const newWidth = Math.min(rotated[0]?.length ?? 0, 50);
      setGridHeight(newHeight);
      setGridWidth(newWidth);
      setHeightInput(String(newHeight));
      setWidthInput(String(newWidth));
      // Clear any error states since dimensions are now valid
      setWidthError(false);
      setHeightError(false);
      return rotated;
    });
  }, [polyformType]);
  
  // Flip horizontally (geometry-correct per polyform type)
  const handleFlipH = useCallback(() => {
    setCells(prev => {
      let next: boolean[][];
      switch (polyformType) {
        case "polyomino":
          next = flipHorizontal(prev);
          break;
        case "polyhex":
          next = transformPolyhex(prev, "flipH");
          break;
        case "polyiamond":
          next = transformPolyiamond(prev, "flipH");
          break;
        default:
          next = prev;
      }

      const newHeight = Math.min(next.length, 50);
      const newWidth = Math.min(next[0]?.length ?? 0, 50);
      setGridHeight(newHeight);
      setGridWidth(newWidth);
      setHeightInput(String(newHeight));
      setWidthInput(String(newWidth));
      setWidthError(false);
      setHeightError(false);

      return next;
    });
  }, [polyformType]);
  
  // Flip vertically (geometry-correct per polyform type)
  const handleFlipV = useCallback(() => {
    setCells(prev => {
      let next: boolean[][];
      switch (polyformType) {
        case "polyomino":
          next = flipVertical(prev);
          break;
        case "polyhex":
          next = transformPolyhex(prev, "flipV");
          break;
        case "polyiamond":
          next = transformPolyiamond(prev, "flipV");
          break;
        default:
          next = prev;
      }

      const newHeight = Math.min(next.length, 50);
      const newWidth = Math.min(next[0]?.length ?? 0, 50);
      setGridHeight(newHeight);
      setGridWidth(newWidth);
      setHeightInput(String(newHeight));
      setWidthInput(String(newWidth));
      setWidthError(false);
      setHeightError(false);

      return next;
    });
  }, [polyformType]);
  
  // Clear the grid
  const handleClear = useCallback(() => {
    setCells(createEmptyBooleanGrid(gridWidth, gridHeight));
  }, [gridWidth, gridHeight]);
  
  // Change polyform type
  const handleTypeChange = useCallback((newType: PolyformType) => {
    setPolyformType(newType);
    // Reset grid when changing type
    setCells(createEmptyBooleanGrid(gridWidth, gridHeight));
  }, [gridWidth, gridHeight]);
  
  // Count filled cells
  const filledCount = useMemo(() => {
    let count = 0;
    for (const row of cells) {
      for (const cell of row) {
        if (cell) count++;
      }
    }
    return count;
  }, [cells]);
  
  return (
    <div className="app">
      <h1>🧩 Polyform Explorer</h1>
      <p className="description">
        Build polyforms by clicking cells to toggle them on/off. 
        Use the rotation and flip buttons to transform your shape.
      </p>
      
      {/* Controls */}
      <div style={{ marginBottom: "20px" }}>
        {/* Polyform Type Selector */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ marginRight: "12px", fontWeight: "bold" }}>Type:</label>
          <select
            value={polyformType}
            onChange={(e) => handleTypeChange(e.target.value as PolyformType)}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              borderRadius: "4px",
              border: "1px solid #bdc3c7",
              cursor: "pointer",
            }}
          >
            <option value="polyomino">Polyomino (Square)</option>
            <option value="polyhex">Polyhex (Hexagon)</option>
            <option value="polyiamond">Polyiamond (Triangle)</option>
          </select>
        </div>
        
        {/* Grid Size Inputs */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap" }}>
          <div>
            <label style={{ marginRight: "8px" }}>Width:</label>
            <input
              type="text"
              value={widthInput}
              onChange={(e) => {
                setWidthInput(e.target.value);
                setWidthError(false); // Clear error while typing
              }}
              onBlur={handleWidthBlur}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: widthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: widthError ? "#fdecea" : "white",
              }}
            />
            {widthError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <div>
            <label style={{ marginRight: "8px" }}>Height:</label>
            <input
              type="text"
              value={heightInput}
              onChange={(e) => {
                setHeightInput(e.target.value);
                setHeightError(false); // Clear error while typing
              }}
              onBlur={handleHeightBlur}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: heightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: heightError ? "#fdecea" : "white",
              }}
            />
            {heightError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
        </div>
        
        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={handleRotate}
            style={{
              padding: "8px 16px",
              backgroundColor: "#3498db",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            🔄 Rotate {polyformType === "polyomino" ? "90°" : "60°"}
          </button>
          <button
            onClick={handleFlipH}
            style={{
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ↔️ Flip H
          </button>
          <button
            onClick={handleFlipV}
            style={{
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ↕️ Flip V
          </button>
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
            onClick={handleExportTileCoords}
            style={{
              padding: "8px 16px",
              backgroundColor: "#17a2b8",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
            title="Copy tile coordinates as JSON"
          >
            📋 Copy JSON
          </button>
        </div>
        
        {/* JSON Import */}
        <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={coordsJsonInput}
            onChange={(e) => setCoordsJsonInput(e.target.value)}
            placeholder='Paste JSON coords: [{"row":0,"col":0},...]'
            style={{
              padding: "6px 10px",
              borderRadius: "4px",
              border: "1px solid #bdc3c7",
              width: "300px",
              fontSize: "12px",
            }}
          />
          <button
            onClick={handleImportTileCoords}
            disabled={!coordsJsonInput.trim()}
            style={{
              padding: "6px 12px",
              backgroundColor: coordsJsonInput.trim() ? "#28a745" : "#95a5a6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: coordsJsonInput.trim() ? "pointer" : "not-allowed",
              fontSize: "12px",
            }}
          >
            📥 Import JSON
          </button>
        </div>
        
        {/* Stats */}
        <div style={{ marginTop: "12px", color: "#7f8c8d", fontSize: "14px" }}>
          Filled cells: <strong>{filledCount}</strong>
        </div>
      </div>
      
      {/* Grid */}
      <div style={{ 
        padding: "16px", 
        backgroundColor: "#f8f9fa", 
        borderRadius: "8px",
        border: "2px solid #3498db",
        display: "inline-block",
      }}>
        {polyformType === "polyomino" && (
          <SquareGrid
            cells={cells}
            onCellClick={handleCellClick}
          />
        )}
        {polyformType === "polyhex" && (
          <HexGrid
            cells={cells}
            onCellClick={handleCellClick}
          />
        )}
        {polyformType === "polyiamond" && (
          <TriangleGrid
            cells={cells}
            onCellClick={handleCellClick}
          />
        )}
      </div>
      
      {/* Tiling Solver Section */}
      <div style={{ 
        marginTop: "24px", 
        padding: "16px", 
        backgroundColor: "#f8f9fa", 
        borderRadius: "8px",
        border: "1px solid #dee2e6",
      }}>
        <h3 style={{ marginTop: 0, marginBottom: "12px" }}>🧩 Tiling Solver</h3>
        <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "16px" }}>
          Try to tile a grid of the specified size using rotations, translations, and flips of your polyform.
          {polyformType === "polyiamond" && (
            <span style={{ color: "#e74c3c", display: "block", marginTop: "8px" }}>
              ⚠️ Polyiamond (triangle) tiling is not yet supported.
            </span>
          )}
        </p>
        
        {/* Tiling Grid Size Inputs */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label style={{ marginRight: "8px" }}>Tiling Width:</label>
            <input
              type="text"
              value={tilingWidthInput}
              onChange={(e) => {
                setTilingWidthInput(e.target.value);
                setTilingWidthError(false);
              }}
              onBlur={handleTilingWidthBlur}
              disabled={solving}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: tilingWidthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: tilingWidthError ? "#fdecea" : "white",
              }}
            />
            {tilingWidthError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <div>
            <label style={{ marginRight: "8px" }}>Tiling Height:</label>
            <input
              type="text"
              value={tilingHeightInput}
              onChange={(e) => {
                setTilingHeightInput(e.target.value);
                setTilingHeightError(false);
              }}
              onBlur={handleTilingHeightBlur}
              disabled={solving}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: tilingHeightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: tilingHeightError ? "#fdecea" : "white",
              }}
            />
            {tilingHeightError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <button
            onClick={handleSolveTiling}
            disabled={solving || polyformType === "polyiamond"}
            style={{
              padding: "8px 20px",
              backgroundColor: solving ? "#95a5a6" : "#27ae60",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: solving || polyformType === "polyiamond" ? "not-allowed" : "pointer",
              fontWeight: "bold",
            }}
          >
            {solving ? "⏳ Solving..." : "🔍 Solve Tiling"}
          </button>
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
                {solvedPolyformType === "polyhex" ? (
                  <HexTilingViewer
                    width={tilingWidth}
                    height={tilingHeight}
                    placements={(tilingResult as HexTilingResult).placements || []}
                    svgRef={tilingSvgRef}
                    highlightedPlacement={highlightedPlacement}
                    highlightedEdge={highlightedEdge}
                    onEdgeInfo={setEdgeInfo}
                    hideFills={hideFills}
                  />
                ) : (
                  <TilingViewer
                    width={tilingWidth}
                    height={tilingHeight}
                    placements={(tilingResult as TilingResult).placements || []}
                    svgRef={tilingSvgRef}
                    highlightedPlacement={highlightedPlacement}
                  />
                )}
                
                {/* Highlight controls */}
                <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={handlePrevPlacement}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#007bff",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    ◀ Prev
                  </button>
                  <button
                    onClick={handleNextPlacement}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#007bff",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    Next ▶
                  </button>
                  <button
                    onClick={handleClearHighlight}
                    disabled={highlightedPlacement === null}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: highlightedPlacement !== null ? "#6c757d" : "#adb5bd",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: highlightedPlacement !== null ? "pointer" : "not-allowed",
                      fontSize: "14px",
                    }}
                  >
                    Clear Highlight
                  </button>
                  {highlightedPlacement !== null && tilingResult.placements && (
                    <span style={{ fontSize: "14px", color: "#495057" }}>
                      Placement <strong>{highlightedPlacement + 1}</strong> of {tilingResult.placements.length}
                      {" | "}
                      Transform: <strong>{tilingResult.placements[highlightedPlacement].transformIndex}</strong>
                    </span>
                  )}
                </div>
                
                {/* Hide fills checkbox (only for polyhex) */}
                {solvedPolyformType === "polyhex" && (
                  <div style={{ marginTop: "12px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px" }}>
                      <input
                        type="checkbox"
                        checked={hideFills}
                        onChange={(e) => setHideFills(e.target.checked)}
                        style={{ width: "16px", height: "16px", cursor: "pointer" }}
                      />
                      Hide filled hexes (show edges only)
                    </label>
                  </div>
                )}
                
                {/* Edge debugging controls (only for polyhex when placement is highlighted) */}
                {solvedPolyformType === "polyhex" && highlightedPlacement !== null && tilingResult.placements && (
                  <div style={{ 
                    marginTop: "12px", 
                    padding: "12px", 
                    backgroundColor: "#f8f9fa", 
                    borderRadius: "4px",
                    border: "1px solid #dee2e6"
                  }}>
                    <div style={{ marginBottom: "8px", fontWeight: "bold", fontSize: "14px" }}>
                      🔍 Edge Debugging
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={handlePrevEdge}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#28a745",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        ◀ Prev Edge
                      </button>
                      <button
                        onClick={handleNextEdge}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#28a745",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        Next Edge ▶
                      </button>
                      <button
                        onClick={handleClearEdge}
                        disabled={highlightedEdge === null}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: highlightedEdge !== null ? "#6c757d" : "#adb5bd",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: highlightedEdge !== null ? "pointer" : "not-allowed",
                          fontSize: "12px",
                        }}
                      >
                        Clear Edge
                      </button>
                      {highlightedEdge !== null && (
                        <span style={{ fontSize: "12px", color: "#495057" }}>
                          Edge <strong>{highlightedEdge + 1}</strong> of {tilingResult.placements[highlightedPlacement].cells.length * 6}
                        </span>
                      )}
                    </div>
                    {edgeInfo && (
                      <div style={{ 
                        marginTop: "8px", 
                        padding: "8px", 
                        backgroundColor: edgeInfo.isInternal ? "#d4edda" : "#f8d7da",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontFamily: "monospace"
                      }}>
                        <div>
                          <strong>Edge Type:</strong> {edgeInfo.isInternal ? "🔗 INTERNAL" : "🚧 EXTERNAL"} (direction: {edgeInfo.direction})
                        </div>
                        <div>
                          <strong>Cell:</strong> ({edgeInfo.coord1.q}, {edgeInfo.coord1.r}) [cell #{edgeInfo.cellIndex + 1}, edge #{edgeInfo.edgeIndex}]
                        </div>
                        {edgeInfo.isInternal && edgeInfo.coord2 && (
                          <div>
                            <strong>Connects to:</strong> ({edgeInfo.coord2.q}, {edgeInfo.coord2.r})
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Download buttons */}
                <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
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
                  <button
                    onClick={handleDownloadPlacementsJson}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#17a2b8",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    📥 Download Placements JSON
                  </button>
                </div>
              </>
            ) : (
              <div style={{ 
                padding: "12px", 
                backgroundColor: "#fff3cd", 
                borderRadius: "4px",
                color: "#856404",
                fontSize: "14px",
              }}>
                ⚠️ <strong>No tiling possible</strong> with this tile for a {tilingWidth}×{tilingHeight} grid.
                <br/>
                <span style={{ fontSize: "12px", color: "#6c757d" }}>
                  ({tilingResult.stats.numPlacements.toLocaleString()} possible placements checked, {tilingResult.stats.numVariables.toLocaleString()} vars, {tilingResult.stats.numClauses.toLocaleString()} clauses)
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PolyformExplorer;
