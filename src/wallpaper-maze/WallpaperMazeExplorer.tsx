import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import WallpaperMazeWorker from "../problem/wallpaper-maze.worker?worker";
import type { WallpaperMazeRequest, WallpaperMazeResponse } from "../problem/wallpaper-maze.worker";
import { buildTiledGraph } from "./TiledGraph";
import type { TiledGraph, TiledNode } from "./TiledGraph";
import { buildP3TiledGraph } from "./P3TiledGraph";
import type { P3TiledGraph, P3TiledNode } from "./P3TiledGraph";
import { getWallpaperGroup, DIRECTION_DELTA } from "./WallpaperGroups";
import type { WallpaperGroupName } from "./WallpaperGroups";
import { P3RhombusRenderer } from "./P3RhombusRenderer";
import { downloadSvg } from "../polyform-explorer/downloadUtils";
import { ToolSelector } from "./ToolSelector";
import { Sketchpad } from "./Sketchpad";
import { SolutionMazeView } from "./SolutionMazeView";
import { SolutionGraphView } from "./SolutionGraphView";
import { P3GraphView } from "./P3GraphView";
import type { GridCell, MazeSolution, SolutionSelectedNode, SolutionViewMode, SketchpadTool } from "./types";
import { DEFAULT_LENGTH, DEFAULT_MULTIPLIER, CELL_SIZE } from "./types";
import "../App.css";

/**
 * Wallpaper Maze Explorer
 * 
 * Creates mazes on a square grid with wallpaper group symmetry.
 * Currently supports P1 (torus/regular wrapping) and P2 (180° rotation wrapping).
 */

export function WallpaperMazeExplorer() {
  const [length, setLength] = useState(DEFAULT_LENGTH);
  const [multiplier, setMultiplier] = useState(DEFAULT_MULTIPLIER);
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroupName>("P1");
  const [rootRow, setRootRow] = useState(0);
  const [rootCol, setRootCol] = useState(0);
  const [solution, setSolution] = useState<MazeSolution | null>(null);
  const [solving, setSolving] = useState(false);
  const [selectedCell, setSelectedCell] = useState<GridCell | null>(null);
  const [satStats, setSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solutionViewMode, setSolutionViewMode] = useState<SolutionViewMode>("maze");
  const [graphSelectedNode, setGraphSelectedNode] = useState<TiledNode | null>(null);
  const [p3GraphSelectedNode, setP3GraphSelectedNode] = useState<P3TiledNode | null>(null);
  
  // State for solution neighbor viewer
  const [solutionSelectedNode, setSolutionSelectedNode] = useState<SolutionSelectedNode | null>(null);
  const [showSolutionNeighbors, setShowSolutionNeighbors] = useState(false);
  
  // New state for tools and vacant cells
  const [activeTool, setActiveTool] = useState<SketchpadTool>("rootSetter");
  const [vacantCells, setVacantCells] = useState<Set<string>>(new Set());
  
  // Worker ref for cancel support
  const workerRef = useRef<Worker | null>(null);
  
  // Ref for maze SVG download
  const mazeSvgRef = useRef<SVGSVGElement | null>(null);
  
  const cellSize = CELL_SIZE;
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  // Reset root when grid size changes
  useEffect(() => {
    setGraphSelectedNode(null);
    setRootRow(0);
    setRootCol(0);
    setVacantCells(new Set());
  }, [length]);
  
  // Build the tiled graph when solution changes
  const tiledGraph = useMemo<TiledGraph | null>(() => {
    if (!solution) return null;
    return buildTiledGraph(
      length,
      multiplier,
      solution.wallpaperGroup,
      solution.rootRow,
      solution.rootCol,
      solution.parentOf,
      solution.vacantCells
    );
  }, [solution, length, multiplier]);
  
  // Build P3-specific tiled graph when solution is for P3
  const p3TiledGraph = useMemo<P3TiledGraph | null>(() => {
    if (!solution || solution.wallpaperGroup !== "P3") return null;
    return buildP3TiledGraph(
      length,
      multiplier,
      cellSize,
      solution.rootRow,
      solution.rootCol,
      solution.parentOf,
      solution.vacantCells
    );
  }, [solution, length, multiplier, cellSize]);
  
  // Compute adjacent neighbors for selected node in solution viewer
  const solutionAdjacentNeighbors = useMemo(() => {
    if (!solutionSelectedNode || !solution) return null;
    const wpg = getWallpaperGroup(solution.wallpaperGroup);
    
    const { copyRow, copyCol, fundamentalRow, fundamentalCol } = solutionSelectedNode;
    
    const computeNeighbor = (dir: "N" | "S" | "E" | "W") => {
      const neighborFund = wpg.getWrappedNeighbor(fundamentalRow, fundamentalCol, dir, length);
      const delta = DIRECTION_DELTA[dir];
      const rawRow = fundamentalRow + delta.dRow;
      const rawCol = fundamentalCol + delta.dCol;
      
      let neighborCopyRow = copyRow;
      let neighborCopyCol = copyCol;
      
      if (rawRow < 0) neighborCopyRow = copyRow - 1;
      else if (rawRow >= length) neighborCopyRow = copyRow + 1;
      
      if (rawCol < 0) neighborCopyCol = copyCol - 1;
      else if (rawCol >= length) neighborCopyCol = copyCol + 1;
      
      return {
        copyRow: neighborCopyRow,
        copyCol: neighborCopyCol,
        fundamentalRow: neighborFund.row,
        fundamentalCol: neighborFund.col,
      };
    };
    
    return {
      N: computeNeighbor("N"),
      S: computeNeighbor("S"),
      E: computeNeighbor("E"),
      W: computeNeighbor("W"),
    };
  }, [solutionSelectedNode, length, solution]);
  
  // Handle cell click in solution viewer (for square grids)
  const handleSolutionCellClick = useCallback((copyRow: number, copyCol: number, fundamentalRow: number, fundamentalCol: number) => {
    if (!showSolutionNeighbors) return;
    
    if (solutionSelectedNode &&
        solutionSelectedNode.copyRow === copyRow &&
        solutionSelectedNode.copyCol === copyCol &&
        solutionSelectedNode.fundamentalRow === fundamentalRow &&
        solutionSelectedNode.fundamentalCol === fundamentalCol) {
      setSolutionSelectedNode(null);
    } else {
      setSolutionSelectedNode({ copyRow, copyCol, fundamentalRow, fundamentalCol });
    }
  }, [showSolutionNeighbors, solutionSelectedNode]);
  
  // Handle cell click in solution viewer (for P3 hexagons)
  const handleP3CellClick = useCallback((hexRow: number, hexCol: number, rhombusIdx: number, row: number, col: number) => {
    if (!showSolutionNeighbors) return;
    
    if (solutionSelectedNode &&
        solutionSelectedNode.hexRow === hexRow &&
        solutionSelectedNode.hexCol === hexCol &&
        solutionSelectedNode.rhombusIdx === rhombusIdx &&
        solutionSelectedNode.fundamentalRow === row &&
        solutionSelectedNode.fundamentalCol === col) {
      setSolutionSelectedNode(null);
    } else {
      setSolutionSelectedNode({
        copyRow: 0,
        copyCol: 0,
        fundamentalRow: row,
        fundamentalCol: col,
        hexRow,
        hexCol,
        rhombusIdx,
      });
    }
  }, [showSolutionNeighbors, solutionSelectedNode]);
  
  // Handle solve button click
  const handleSolve = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    
    let safeRootRow = rootRow >= length ? 0 : rootRow;
    let safeRootCol = rootCol >= length ? 0 : rootCol;
    
    if (vacantCells.has(`${safeRootRow},${safeRootCol}`)) {
      let found = false;
      for (let r = 0; r < length && !found; r++) {
        for (let c = 0; c < length && !found; c++) {
          if (!vacantCells.has(`${r},${c}`)) {
            safeRootRow = r;
            safeRootCol = c;
            found = true;
          }
        }
      }
      if (!found) {
        setErrorMessage("Cannot solve: all cells are vacant");
        return;
      }
    }
    
    if (safeRootRow !== rootRow) setRootRow(safeRootRow);
    if (safeRootCol !== rootCol) setRootCol(safeRootCol);
    
    setSolving(true);
    setErrorMessage(null);
    setSatStats(null);
    setGraphSelectedNode(null);
    
    const currentWallpaperGroup = wallpaperGroup;
    const currentVacantCells = new Set(vacantCells);
    
    const worker = new WallpaperMazeWorker();
    workerRef.current = worker;
    
    worker.onmessage = (event: MessageEvent<WallpaperMazeResponse>) => {
      const response = event.data;
      
      if (response.messageType === "progress") {
        if (response.stats) {
          setSatStats(response.stats);
        }
        return;
      }
      
      if (response.success && response.result) {
        const parentOf = new Map<string, GridCell | null>(response.result.parentOf);
        const distanceFromRoot = new Map<string, number>(response.result.distanceFromRoot);
        
        setSolution({ 
          parentOf, 
          distanceFromRoot, 
          wallpaperGroup: currentWallpaperGroup,
          vacantCells: currentVacantCells,
          rootRow: safeRootRow,
          rootCol: safeRootCol
        });
        setErrorMessage(null);
      } else {
        setErrorMessage(response.error || "Failed to solve maze");
      }
      
      setSolving(false);
      workerRef.current = null;
    };
    
    worker.onerror = (error) => {
      setErrorMessage(`Worker error: ${error.message}`);
      setSolving(false);
      workerRef.current = null;
    };
    
    const request: WallpaperMazeRequest = {
      length,
      rootRow: safeRootRow,
      rootCol: safeRootCol,
      wallpaperGroup,
      vacantCells: Array.from(vacantCells),
    };
    worker.postMessage(request);
  }, [length, rootRow, rootCol, wallpaperGroup, vacantCells]);
  
  // Handle cancel button click
  const handleCancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setSolving(false);
      setErrorMessage("Solving cancelled");
    }
  }, []);
  
  // Handle SVG download
  const handleDownloadSvg = useCallback(() => {
    if (!mazeSvgRef.current || !solution || solutionViewMode !== "maze") return;
    downloadSvg(mazeSvgRef.current, `wallpaper-maze-${solution.wallpaperGroup}-${length}x${length}.svg`);
  }, [solution, length, solutionViewMode]);
  
  // Handle cell click based on active tool
  const handleCellClick = useCallback((row: number, col: number) => {
    const cellKey = `${row},${col}`;
    
    switch (activeTool) {
      case "rootSetter":
        if (vacantCells.has(cellKey)) return;
        setRootRow(row);
        setRootCol(col);
        break;
        
      case "neighborhoodViewer":
        if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
          setSelectedCell(null);
        } else {
          setSelectedCell({ row, col });
        }
        break;
        
      case "blockSetter":
        if (row === rootRow && col === rootCol) return;
        setVacantCells(prev => {
          const next = new Set(prev);
          if (next.has(cellKey)) {
            next.delete(cellKey);
          } else {
            next.add(cellKey);
          }
          return next;
        });
        break;
    }
  }, [activeTool, selectedCell, vacantCells, rootRow, rootCol]);
  
  return (
    <div className="wallpaper-maze-explorer">
      <h2>Wallpaper Maze Explorer</h2>
      
      <div style={{ display: "flex", gap: "40px", marginBottom: "20px" }}>
        {/* Left panel: Sketchpad and Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ margin: 0 }}>Sketchpad ({wallpaperGroup})</h3>
          
          <ToolSelector activeTool={activeTool} onToolChange={setActiveTool} />
          
          <Sketchpad
            length={length}
            cellSize={cellSize}
            rootRow={rootRow}
            rootCol={rootCol}
            wallpaperGroup={wallpaperGroup}
            activeTool={activeTool}
            selectedCell={selectedCell}
            vacantCells={vacantCells}
            onCellClick={handleCellClick}
          />
          
          {/* Tool info */}
          <div style={{ fontSize: "12px", color: "#666", maxWidth: "200px" }}>
            {activeTool === "rootSetter" && "Click a cell to set it as the root."}
            {activeTool === "neighborhoodViewer" && selectedCell && (
              <>
                <strong>Selected:</strong> ({selectedCell.row}, {selectedCell.col})
                <br />
                <span style={{ color: "#ff4081" }}>Neighbors highlighted in pink</span>
              </>
            )}
            {activeTool === "neighborhoodViewer" && !selectedCell && "Click a cell to view its neighbors."}
            {activeTool === "blockSetter" && `Click to toggle vacant cells. ${vacantCells.size} vacant.`}
          </div>
          
          <div style={{ marginTop: "10px" }}>
            <strong>Root:</strong> ({rootRow}, {rootCol})
          </div>
          
          {/* Settings */}
          <label>
            Grid Length:
            <input
              type="number"
              min={2}
              max={10}
              value={length}
              onChange={(e) => setLength(parseInt(e.target.value))}
              style={{ marginLeft: "10px", width: "60px" }}
            />
          </label>
          
          <label>
            Wallpaper Group:
            <select
              value={wallpaperGroup}
              onChange={(e) => setWallpaperGroup(e.target.value as WallpaperGroupName)}
              style={{ marginLeft: "10px" }}
            >
              <option value="P1">P1 (Torus)</option>
              <option value="P2">P2 (180° Rotation)</option>
              <option value="pgg">pgg (Glide Reflections)</option>
              <option value="P3">P3 (3-fold Rotation)</option>
              <option value="P4">P4 (4-fold Rotation)</option>
            </select>
          </label>
          
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            {!solving ? (
              <button onClick={handleSolve} style={{ padding: "10px 20px" }}>
                Solve
              </button>
            ) : (
              <button 
                onClick={handleCancel} 
                style={{ padding: "10px 20px", backgroundColor: "#f44336", color: "white" }}
              >
                Cancel
              </button>
            )}
          </div>
          
          {solving && satStats && (
            <div style={{ fontSize: "12px", color: "#666" }}>
              Variables: {satStats.numVars}, Clauses: {satStats.numClauses}
            </div>
          )}
          
          {errorMessage && (
            <div style={{ color: "red" }}>{errorMessage}</div>
          )}
        </div>
        
        {/* Right panel: Solution View */}
        {solution && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h3 style={{ margin: 0 }}>Solution ({solution.wallpaperGroup})</h3>
            
            <label>
              Multiplier:
              <input
                type="number"
                min={1}
                max={5}
                value={multiplier}
                onChange={(e) => setMultiplier(parseInt(e.target.value))}
                style={{ marginLeft: "10px", width: "60px" }}
              />
            </label>
            
            {/* View mode toggle */}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setSolutionViewMode("maze")}
                style={{ 
                  padding: "5px 15px",
                  backgroundColor: solutionViewMode === "maze" ? "#1976d2" : "#e0e0e0",
                  color: solutionViewMode === "maze" ? "white" : "black",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Maze
              </button>
              <button
                onClick={() => setSolutionViewMode("graph")}
                style={{ 
                  padding: "5px 15px",
                  backgroundColor: solutionViewMode === "graph" ? "#1976d2" : "#e0e0e0",
                  color: solutionViewMode === "graph" ? "white" : "black",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Graph
              </button>
            </div>
            
            {/* Show Neighbors toggle */}
            <button
              onClick={() => {
                setShowSolutionNeighbors(!showSolutionNeighbors);
                if (!showSolutionNeighbors) {
                  setSolutionSelectedNode(null);
                }
              }}
              style={{
                padding: "5px 15px",
                backgroundColor: showSolutionNeighbors ? "#2196f3" : "#e0e0e0",
                color: showSolutionNeighbors ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
              title="Click cells in the solution to see their neighbors"
            >
              🔍 Show Neighbors
            </button>
            
            {/* Save to SVG button */}
            {solutionViewMode === "maze" && (
              <button
                onClick={handleDownloadSvg}
                style={{
                  padding: "5px 15px",
                  backgroundColor: "#4caf50",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
                title="Download maze as SVG file"
              >
                💾 Save to SVG
              </button>
            )}
            
            {/* Show selected node info when in neighbor mode */}
            {showSolutionNeighbors && solutionSelectedNode && (
              <div style={{ fontSize: "12px", color: "#666" }}>
                <strong>Selected:</strong> {solution.wallpaperGroup === "P3" 
                  ? `hex (${solutionSelectedNode.hexRow ?? 0}, ${solutionSelectedNode.hexCol ?? 0}), rhombus ${solutionSelectedNode.rhombusIdx ?? 0}, cell (${solutionSelectedNode.fundamentalRow}, ${solutionSelectedNode.fundamentalCol})`
                  : `copy (${solutionSelectedNode.copyRow}, ${solutionSelectedNode.copyCol}), cell (${solutionSelectedNode.fundamentalRow}, ${solutionSelectedNode.fundamentalCol})`
                }
                <br />
                <span style={{ color: "#ff4081" }}>4 neighbors highlighted in pink</span>
              </div>
            )}
            
            {/* Solution view */}
            {solution.wallpaperGroup === "P3" ? (
              solutionViewMode === "maze" ? (
                <P3RhombusRenderer
                  length={length}
                  multiplier={multiplier}
                  cellSize={cellSize}
                  parentOf={solution.parentOf}
                  rootRow={solution.rootRow}
                  rootCol={solution.rootCol}
                  vacantCells={solution.vacantCells}
                  wallpaperGroupName={solution.wallpaperGroup}
                  p3TiledGraph={p3TiledGraph}
                  showNeighbors={showSolutionNeighbors}
                  selectedNode={solutionSelectedNode}
                  onCellClick={handleP3CellClick}
                  svgRef={mazeSvgRef}
                />
              ) : p3TiledGraph ? (
                <P3GraphView
                  p3TiledGraph={p3TiledGraph}
                  solution={solution}
                  length={length}
                  multiplier={multiplier}
                  cellSize={cellSize}
                  p3GraphSelectedNode={p3GraphSelectedNode}
                  onNodeSelect={setP3GraphSelectedNode}
                />
              ) : null
            ) : (
              solutionViewMode === "maze" && tiledGraph ? (
                <SolutionMazeView
                  tiledGraph={tiledGraph}
                  solution={solution}
                  cellSize={cellSize}
                  showSolutionNeighbors={showSolutionNeighbors}
                  solutionSelectedNode={solutionSelectedNode}
                  solutionAdjacentNeighbors={solutionAdjacentNeighbors}
                  onCellClick={handleSolutionCellClick}
                  svgRef={mazeSvgRef}
                />
              ) : solutionViewMode === "graph" && tiledGraph ? (
                <SolutionGraphView
                  tiledGraph={tiledGraph}
                  solution={solution}
                  graphSelectedNode={graphSelectedNode}
                  onNodeSelect={setGraphSelectedNode}
                />
              ) : null
            )}
            
            {/* Selected node info for graph view */}
            {solutionViewMode === "graph" && graphSelectedNode && solution.wallpaperGroup !== "P3" && (
              <div style={{ marginTop: "10px", padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
                <strong>Selected Cell</strong><br/>
                Fundamental: ({graphSelectedNode.fundamentalRow}, {graphSelectedNode.fundamentalCol})<br/>
                {!graphSelectedNode.isRoot && graphSelectedNode.parentDirection && (
                  <>Parent direction: {graphSelectedNode.parentDirection}<br/></>
                )}
                {graphSelectedNode.isRoot && <span style={{ color: "#ff9800" }}>Root</span>}
              </div>
            )}
            
            {/* Selected node info for P3 graph view */}
            {solutionViewMode === "graph" && p3GraphSelectedNode && solution.wallpaperGroup === "P3" && (
              <div style={{ marginTop: "10px", padding: "10px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
                <strong>Selected Cell</strong><br/>
                Hex: ({p3GraphSelectedNode.hexRow}, {p3GraphSelectedNode.hexCol}), 
                Rhombus: {p3GraphSelectedNode.rhombusIdx}<br/>
                Fundamental: ({p3GraphSelectedNode.fundamentalRow}, {p3GraphSelectedNode.fundamentalCol})<br/>
                {p3GraphSelectedNode.isRoot && <span style={{ color: "#ff9800" }}>Root</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
