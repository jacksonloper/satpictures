import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import WallpaperMazeWorker from "../problem/wallpaper-maze.worker?worker";
import type { WallpaperMazeRequest, WallpaperMazeResponse } from "../problem/wallpaper-maze.worker";
import {
  buildTiledGraph,
  getRootColor,
  computeWallSegments,
  findEquivalentNodes,
} from "./TiledGraph";
import type { TiledGraph, TiledNode } from "./TiledGraph";
import { getWallpaperGroup, DIRECTION_DELTA } from "./WallpaperGroups";
import type { WallpaperGroupName } from "./WallpaperGroups";
import { P3RhombusRenderer } from "./P3RhombusRenderer";
import "../App.css";

/**
 * Wallpaper Maze Explorer
 * 
 * Creates mazes on a square grid with wallpaper group symmetry.
 * Currently supports P1 (torus/regular wrapping) and P2 (180° rotation wrapping).
 */

// Constants
const DEFAULT_LENGTH = 4;
const DEFAULT_MULTIPLIER = 2;
const CELL_SIZE = 40;
const GRID_PADDING = 20;

// Types
interface GridCell {
  row: number;
  col: number;
}

interface MazeSolution {
  parentOf: Map<string, GridCell | null>;
  distanceFromRoot: Map<string, number>;
  wallpaperGroup: WallpaperGroupName; // Store the wallpaper group used for this solution
  vacantCells: Set<string>; // Store which cells were vacant at solve time
}

// View mode type for solution
type SolutionViewMode = "maze" | "graph";

// Tool types for interacting with the sketchpad
type SketchpadTool = "rootSetter" | "neighborhoodViewer" | "blockSetter";

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
  
  // New state for tools and vacant cells
  const [activeTool, setActiveTool] = useState<SketchpadTool>("rootSetter");
  const [vacantCells, setVacantCells] = useState<Set<string>>(new Set());
  
  // Worker ref for cancel support
  const workerRef = useRef<Worker | null>(null);
  
  const cellSize = CELL_SIZE;
  const padding = GRID_PADDING;
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  // Reset root and vacant cells when grid size changes
  useEffect(() => {
    setGraphSelectedNode(null);
    // Always set root to (0,0) when length or wallpaper group changes
    // This ensures a valid root exists even if previous state was corrupted
    setRootRow(0);
    setRootCol(0);
    setVacantCells(new Set()); // Reset vacant cells when grid size changes
  }, [length, wallpaperGroup]);
  
  // Build the tiled graph when solution changes (uses solution's stored wallpaper group)
  const tiledGraph = useMemo<TiledGraph | null>(() => {
    if (!solution) return null;
    return buildTiledGraph(
      length,
      multiplier,
      solution.wallpaperGroup, // Use the wallpaper group stored in the solution
      rootRow,
      rootCol,
      solution.parentOf,
      solution.vacantCells // Pass vacant cells to the tiled graph builder
    );
  }, [solution, length, multiplier, rootRow, rootCol]);
  
  // Get neighbor info for selected cell in fundamental domain
  const neighborInfo = useMemo(() => {
    if (!selectedCell) return null;
    const wpg = getWallpaperGroup(wallpaperGroup);
    return {
      N: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "N", length),
      S: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "S", length),
      E: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "E", length),
      W: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "W", length),
    };
  }, [selectedCell, length, wallpaperGroup]);
  
  // Handle solve button click
  const handleSolve = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    
    // Ensure root is within bounds and not vacant
    let safeRootRow = rootRow >= length ? 0 : rootRow;
    let safeRootCol = rootCol >= length ? 0 : rootCol;
    
    // If current root is vacant, find a non-vacant cell
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
    
    // Store a snapshot of current settings to be stored with the solution
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
          vacantCells: currentVacantCells
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
  
  // Handle cell click based on active tool
  const handleCellClick = useCallback((row: number, col: number) => {
    const cellKey = `${row},${col}`;
    
    switch (activeTool) {
      case "rootSetter":
        // Don't set root on vacant cells
        if (vacantCells.has(cellKey)) {
          return;
        }
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
        // Toggle vacancy state (but don't allow blocking the root)
        if (row === rootRow && col === rootCol) {
          // Don't allow blocking the root - move root first
          return;
        }
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
  
  // Compute wall segments from tiled graph
  const wallSegments = useMemo(() => {
    if (!tiledGraph) return [];
    return computeWallSegments(tiledGraph, cellSize);
  }, [tiledGraph, cellSize]);
  
  // Render solution maze view using tiled graph
  const renderSolutionMazeView = () => {
    if (!tiledGraph || !solution) {
      return null;
    }
    
    const cells: React.ReactNode[] = [];
    const walls: React.ReactNode[] = [];
    
    // Render cells from tiled graph
    for (const node of tiledGraph.nodes) {
      const x = padding + node.absCol * cellSize;
      const y = padding + node.absRow * cellSize;
      
      // Check if this cell was vacant at solve time
      const cellKey = `${node.fundamentalRow},${node.fundamentalCol}`;
      const isVacant = solution.vacantCells.has(cellKey);
      
      // Color: vacant cells are black, others colored by root connection
      const fillColor = isVacant ? "#000" : getRootColor(node.rootIndex);
      
      cells.push(
        <rect
          key={`cell-${node.id}`}
          x={x}
          y={y}
          width={cellSize}
          height={cellSize}
          fill={fillColor}
          stroke="none"
        />
      );
      
      // Root indicator (only for non-vacant cells)
      if (node.isRoot && !isVacant) {
        cells.push(
          <circle
            key={`root-${node.id}`}
            cx={x + cellSize / 2}
            cy={y + cellSize / 2}
            r={cellSize / 6}
            fill="#000"
          />
        );
      }
    }
    
    // Render walls from precomputed segments
    for (let i = 0; i < wallSegments.length; i++) {
      const wall = wallSegments[i];
      walls.push(
        <line
          key={`wall-${i}`}
          x1={padding + wall.x1}
          y1={padding + wall.y1}
          x2={padding + wall.x2}
          y2={padding + wall.y2}
          stroke="#000"
          strokeWidth={3}
          strokeLinecap="round"
        />
      );
    }
    
    const totalSize = tiledGraph.totalSize * cellSize + padding * 2;
    
    return (
      <svg width={totalSize} height={totalSize}>
        {cells}
        {walls}
      </svg>
    );
  };
  
  // Render sketchpad (always visible, editable)
  const renderSketchpad = () => {
    const cells: React.ReactNode[] = [];
    const highlights: React.ReactNode[] = [];
    
    // Determine which cells are neighbors of selected (when using neighborhood viewer)
    const neighborCells = new Set<string>();
    if (activeTool === "neighborhoodViewer" && selectedCell && neighborInfo) {
      neighborCells.add(`${neighborInfo.N.row},${neighborInfo.N.col}`);
      neighborCells.add(`${neighborInfo.S.row},${neighborInfo.S.col}`);
      neighborCells.add(`${neighborInfo.E.row},${neighborInfo.E.col}`);
      neighborCells.add(`${neighborInfo.W.row},${neighborInfo.W.col}`);
    }
    
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        const x = padding + col * cellSize;
        const y = padding + row * cellSize;
        const cellKey = `${row},${col}`;
        const isRoot = row === rootRow && col === rootCol;
        const isSelected = activeTool === "neighborhoodViewer" && selectedCell && selectedCell.row === row && selectedCell.col === col;
        const isNeighbor = neighborCells.has(cellKey);
        const isVacant = vacantCells.has(cellKey);
        
        // Determine fill color: vacant cells are black, root is orange, others are gray
        let fillColor = "#e0e0e0";
        if (isVacant) {
          fillColor = "#000";
        } else if (isRoot) {
          fillColor = "#ffa726";
        }
        
        cells.push(
          <rect
            key={`cell-${row}-${col}`}
            x={x}
            y={y}
            width={cellSize}
            height={cellSize}
            fill={fillColor}
            stroke="#ccc"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={() => handleCellClick(row, col)}
          />
        );
        
        if (isSelected) {
          highlights.push(
            <rect
              key={`selected-${row}-${col}`}
              x={x + 2}
              y={y + 2}
              width={cellSize - 4}
              height={cellSize - 4}
              fill="none"
              stroke="#000"
              strokeWidth={3}
            />
          );
        }
        
        // Highlight neighbors with pink
        if (isNeighbor && !isSelected) {
          highlights.push(
            <rect
              key={`neighbor-${row}-${col}`}
              x={x + 2}
              y={y + 2}
              width={cellSize - 4}
              height={cellSize - 4}
              fill="none"
              stroke="#ff4081"
              strokeWidth={3}
              strokeDasharray="4,2"
            />
          );
        }
        
        // Root indicator (only for non-vacant cells)
        if (isRoot && !isVacant) {
          cells.push(
            <circle
              key={`root-${row}-${col}`}
              cx={x + cellSize / 2}
              cy={y + cellSize / 2}
              r={cellSize / 6}
              fill="#000"
            />
          );
        }
      }
    }
    
    const totalSize = length * cellSize + padding * 2;
    
    return (
      <svg width={totalSize} height={totalSize}>
        {cells}
        {highlights}
      </svg>
    );
  };
  
  // Render solution graph view
  const renderSolutionGraphView = () => {
    if (!tiledGraph || !solution) return null;
    
    const dotRadius = 4;
    const graphCellSize = 30;
    const graphPadding = 20;
    
    const totalSize = tiledGraph.totalSize * graphCellSize + graphPadding * 2;
    
    const dots: React.ReactNode[] = [];
    const edges: React.ReactNode[] = [];
    const highlights: React.ReactNode[] = [];
    const gridLines: React.ReactNode[] = [];
    
    // Find equivalent nodes if one is selected
    const equivalentNodes = graphSelectedNode ? findEquivalentNodes(tiledGraph, graphSelectedNode) : [];
    
    // Draw faint grid lines
    for (let i = 0; i <= tiledGraph.totalSize; i++) {
      gridLines.push(
        <line
          key={`vline-${i}`}
          x1={graphPadding + i * graphCellSize}
          y1={graphPadding}
          x2={graphPadding + i * graphCellSize}
          y2={totalSize - graphPadding}
          stroke="#eee"
          strokeWidth={1}
        />
      );
      gridLines.push(
        <line
          key={`hline-${i}`}
          x1={graphPadding}
          y1={graphPadding + i * graphCellSize}
          x2={totalSize - graphPadding}
          y2={graphPadding + i * graphCellSize}
          stroke="#eee"
          strokeWidth={1}
        />
      );
    }
    
    // Draw edges (from each node to its parent) - skip edges involving vacant cells
    for (const edge of tiledGraph.edges) {
      const fromNode = tiledGraph.nodes[edge.fromId];
      const toNode = tiledGraph.nodes[edge.toId];
      
      // Skip edges involving vacant cells
      const fromKey = `${fromNode.fundamentalRow},${fromNode.fundamentalCol}`;
      const toKey = `${toNode.fundamentalRow},${toNode.fundamentalCol}`;
      if (solution.vacantCells.has(fromKey) || solution.vacantCells.has(toKey)) {
        continue;
      }
      
      const x1 = graphPadding + fromNode.absCol * graphCellSize + graphCellSize / 2;
      const y1 = graphPadding + fromNode.absRow * graphCellSize + graphCellSize / 2;
      const x2 = graphPadding + toNode.absCol * graphCellSize + graphCellSize / 2;
      const y2 = graphPadding + toNode.absRow * graphCellSize + graphCellSize / 2;
      
      edges.push(
        <line
          key={`edge-${edge.fromId}-${edge.toId}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={getRootColor(fromNode.rootIndex)}
          strokeWidth={2}
        />
      );
    }
    
    // Draw dots for each node - skip vacant cells (they are "empty squares" - no dot)
    for (const node of tiledGraph.nodes) {
      const cellKey = `${node.fundamentalRow},${node.fundamentalCol}`;
      if (solution.vacantCells.has(cellKey)) {
        continue; // Skip vacant cells - they render as empty (no dot)
      }
      
      const cx = graphPadding + node.absCol * graphCellSize + graphCellSize / 2;
      const cy = graphPadding + node.absRow * graphCellSize + graphCellSize / 2;
      
      dots.push(
        <circle
          key={`dot-${node.id}`}
          cx={cx}
          cy={cy}
          r={node.isRoot ? dotRadius * 1.5 : dotRadius}
          fill={getRootColor(node.rootIndex)}
          stroke={node.isRoot ? "#000" : "none"}
          strokeWidth={node.isRoot ? 2 : 0}
          style={{ cursor: "pointer" }}
          onClick={() => {
            if (graphSelectedNode?.id === node.id) {
              setGraphSelectedNode(null);
            } else {
              setGraphSelectedNode(node);
            }
          }}
        />
      );
    }
    
    // Highlight equivalent nodes and draw parent arrows
    if (graphSelectedNode) {
      for (const node of equivalentNodes) {
        const cx = graphPadding + node.absCol * graphCellSize + graphCellSize / 2;
        const cy = graphPadding + node.absRow * graphCellSize + graphCellSize / 2;
        
        // Highlight circle
        highlights.push(
          <circle
            key={`highlight-${node.id}`}
            cx={cx}
            cy={cy}
            r={dotRadius * 2}
            fill="none"
            stroke="#ff00ff"
            strokeWidth={2}
          />
        );
        
        // Parent arrow
        if (node.visualParentDirection && !node.isRoot) {
          const delta = DIRECTION_DELTA[node.visualParentDirection];
          const arrowLen = graphCellSize * 0.6;
          const ax2 = cx + delta.dCol * arrowLen;
          const ay2 = cy + delta.dRow * arrowLen;
          
          highlights.push(
            <line
              key={`arrow-${node.id}`}
              x1={cx}
              y1={cy}
              x2={ax2}
              y2={ay2}
              stroke="#ff00ff"
              strokeWidth={2}
              markerEnd="url(#arrowhead)"
            />
          );
        }
      }
    }
    
    return (
      <svg width={totalSize} height={totalSize}>
        <defs>
          <marker
            id="arrowhead"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 6 3, 0 6" fill="#ff00ff" />
          </marker>
        </defs>
        {gridLines}
        {edges}
        {dots}
        {highlights}
      </svg>
    );
  };
  
  return (
    <div className="wallpaper-maze-explorer">
      <h2>Wallpaper Maze Explorer</h2>
      
      <div style={{ display: "flex", gap: "40px", marginBottom: "20px" }}>
        {/* Left panel: Sketchpad and Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ margin: 0 }}>Sketchpad ({wallpaperGroup})</h3>
          
          {/* Tool selector */}
          <div style={{ display: "flex", gap: "5px", marginBottom: "10px" }}>
            <button
              onClick={() => setActiveTool("rootSetter")}
              style={{
                padding: "5px 10px",
                backgroundColor: activeTool === "rootSetter" ? "#4caf50" : "#e0e0e0",
                color: activeTool === "rootSetter" ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
              title="Click to set the root cell"
            >
              🎯 Root Setter
            </button>
            <button
              onClick={() => setActiveTool("neighborhoodViewer")}
              style={{
                padding: "5px 10px",
                backgroundColor: activeTool === "neighborhoodViewer" ? "#2196f3" : "#e0e0e0",
                color: activeTool === "neighborhoodViewer" ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
              title="Click to view neighbors (highlights in pink)"
            >
              🔍 Neighborhood Viewer
            </button>
            <button
              onClick={() => setActiveTool("blockSetter")}
              style={{
                padding: "5px 10px",
                backgroundColor: activeTool === "blockSetter" ? "#f44336" : "#e0e0e0",
                color: activeTool === "blockSetter" ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
              title="Click to toggle vacant/blocked cells"
            >
              ⬛ Block Setter
            </button>
          </div>
          
          {/* Sketchpad grid */}
          {renderSketchpad()}
          
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
              onChange={(e) => {
                const newLength = parseInt(e.target.value);
                setLength(newLength);
              }}
              style={{ marginLeft: "10px", width: "60px" }}
            />
          </label>
          
          <label>
            Wallpaper Group:
            <select
              value={wallpaperGroup}
              onChange={(e) => {
                setWallpaperGroup(e.target.value as WallpaperGroupName);
              }}
              style={{ marginLeft: "10px" }}
            >
              <option value="P1">P1 (Torus)</option>
              <option value="P2">P2 (180° Rotation)</option>
              <option value="pgg">pgg (Glide Reflections)</option>
              <option value="P3">P3 (3-fold Rotation)</option>
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
        
        {/* Right panel: Solution View (always shown once we have a solution) */}
        {solution && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h3 style={{ margin: 0 }}>Solution ({solution.wallpaperGroup})</h3>
            
            {/* Multiplier control (affects solution display) */}
            <label>
              Multiplier:
              <input
                type="number"
                min={1}
                max={5}
                value={multiplier}
                onChange={(e) => {
                  setMultiplier(parseInt(e.target.value));
                }}
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
            
            {/* Solution view - use P3RhombusRenderer for P3, standard renderers for others */}
            {solution.wallpaperGroup === "P3" ? (
              <P3RhombusRenderer
                length={length}
                multiplier={multiplier}
                cellSize={cellSize}
                parentOf={solution.parentOf}
                rootRow={rootRow}
                rootCol={rootCol}
                vacantCells={solution.vacantCells}
                wallpaperGroupName={solution.wallpaperGroup}
                tiledGraph={tiledGraph}
              />
            ) : (
              solutionViewMode === "maze" ? renderSolutionMazeView() : renderSolutionGraphView()
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
          </div>
        )}
      </div>
    </div>
  );
}
