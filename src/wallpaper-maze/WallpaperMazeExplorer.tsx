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
}

// View mode type
type ViewMode = "maze" | "graph";

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
  const [viewMode, setViewMode] = useState<ViewMode>("maze");
  const [graphSelectedNode, setGraphSelectedNode] = useState<TiledNode | null>(null);
  
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
  
  // Reset solution and ensure root is valid when grid parameters change
  useEffect(() => {
    setSolution(null);
    setGraphSelectedNode(null);
    // Always set root to (0,0) when length or wallpaper group changes
    // This ensures a valid root exists even if previous state was corrupted
    setRootRow(0);
    setRootCol(0);
  }, [length, wallpaperGroup]);
  
  // Build the tiled graph when solution changes
  const tiledGraph = useMemo<TiledGraph | null>(() => {
    if (!solution) return null;
    return buildTiledGraph(
      length,
      multiplier,
      wallpaperGroup,
      rootRow,
      rootCol,
      solution.parentOf
    );
  }, [solution, length, multiplier, wallpaperGroup, rootRow, rootCol]);
  
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
    
    // Ensure root is within bounds (state updates from useEffect may be async)
    // We compute safe values here and use them for the worker, then also update
    // state to keep UI in sync (even though this update is also async, it ensures
    // the UI will eventually reflect the actual values sent to the worker)
    const safeRootRow = rootRow >= length ? 0 : rootRow;
    const safeRootCol = rootCol >= length ? 0 : rootCol;
    if (safeRootRow !== rootRow) setRootRow(safeRootRow);
    if (safeRootCol !== rootCol) setRootCol(safeRootCol);
    
    setSolving(true);
    setSolution(null);
    setErrorMessage(null);
    setSatStats(null);
    setGraphSelectedNode(null);
    
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
        
        setSolution({ parentOf, distanceFromRoot });
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
    };
    worker.postMessage(request);
  }, [length, rootRow, rootCol, wallpaperGroup]);
  
  // Handle cancel button click
  const handleCancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setSolving(false);
      setErrorMessage("Solving cancelled");
    }
  }, []);
  
  // Handle cell click for root selection (in maze view)
  const handleCellClick = useCallback((row: number, col: number) => {
    if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
      setSelectedCell(null);
    } else {
      setSelectedCell({ row, col });
    }
  }, [selectedCell]);
  
  // Handle setting root
  const handleSetRoot = useCallback(() => {
    if (selectedCell) {
      setRootRow(selectedCell.row);
      setRootCol(selectedCell.col);
      setSolution(null);
    }
  }, [selectedCell]);
  
  // Compute wall segments from tiled graph
  const wallSegments = useMemo(() => {
    if (!tiledGraph) return [];
    return computeWallSegments(tiledGraph, cellSize);
  }, [tiledGraph, cellSize]);
  
  // Render maze view using tiled graph
  const renderMazeView = () => {
    if (!tiledGraph) {
      // Render empty grid for unsolved state
      return renderUnsolvedMazeView();
    }
    
    const cells: React.ReactNode[] = [];
    const walls: React.ReactNode[] = [];
    const highlights: React.ReactNode[] = [];
    
    // Determine which fundamental domain cells are neighbors of selected
    const neighborCells = new Set<string>();
    if (selectedCell && neighborInfo) {
      neighborCells.add(`${neighborInfo.N.row},${neighborInfo.N.col}`);
      neighborCells.add(`${neighborInfo.S.row},${neighborInfo.S.col}`);
      neighborCells.add(`${neighborInfo.E.row},${neighborInfo.E.col}`);
      neighborCells.add(`${neighborInfo.W.row},${neighborInfo.W.col}`);
    }
    
    // Render cells from tiled graph
    for (const node of tiledGraph.nodes) {
      const x = padding + node.absCol * cellSize;
      const y = padding + node.absRow * cellSize;
      
      // Color by root connection
      const fillColor = getRootColor(node.rootIndex);
      
      // Check if this is in the fundamental domain (copy 0,0) for interactivity
      const isInFundamentalDomain = node.copyRow === 0 && node.copyCol === 0;
      const isSelected = isInFundamentalDomain && selectedCell && 
                         selectedCell.row === node.fundamentalRow && 
                         selectedCell.col === node.fundamentalCol;
      const isNeighbor = isInFundamentalDomain && 
                         neighborCells.has(`${node.fundamentalRow},${node.fundamentalCol}`);
      
      cells.push(
        <rect
          key={`cell-${node.id}`}
          x={x}
          y={y}
          width={cellSize}
          height={cellSize}
          fill={fillColor}
          stroke="none"
          style={{ cursor: isInFundamentalDomain ? "pointer" : "default" }}
          onClick={isInFundamentalDomain ? () => handleCellClick(node.fundamentalRow, node.fundamentalCol) : undefined}
        />
      );
      
      // Root indicator
      if (node.isRoot) {
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
      
      // Highlight selected cell
      if (isSelected) {
        highlights.push(
          <rect
            key={`selected-${node.id}`}
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
      
      // Highlight neighbors
      if (isNeighbor && !isSelected) {
        highlights.push(
          <rect
            key={`neighbor-${node.id}`}
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
        {highlights}
      </svg>
    );
  };
  
  // Render unsolved maze view (empty grid)
  const renderUnsolvedMazeView = () => {
    const cells: React.ReactNode[] = [];
    const highlights: React.ReactNode[] = [];
    
    // Determine which cells are neighbors of selected
    const neighborCells = new Set<string>();
    if (selectedCell && neighborInfo) {
      neighborCells.add(`${neighborInfo.N.row},${neighborInfo.N.col}`);
      neighborCells.add(`${neighborInfo.S.row},${neighborInfo.S.col}`);
      neighborCells.add(`${neighborInfo.E.row},${neighborInfo.E.col}`);
      neighborCells.add(`${neighborInfo.W.row},${neighborInfo.W.col}`);
    }
    
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        const x = padding + col * cellSize;
        const y = padding + row * cellSize;
        const isRoot = row === rootRow && col === rootCol;
        const isSelected = selectedCell && selectedCell.row === row && selectedCell.col === col;
        const isNeighbor = neighborCells.has(`${row},${col}`);
        
        cells.push(
          <rect
            key={`cell-${row}-${col}`}
            x={x}
            y={y}
            width={cellSize}
            height={cellSize}
            fill={isRoot ? "#ffa726" : "#e0e0e0"}
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
        
        if (isRoot) {
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
  
  // Render graph view
  const renderGraphView = () => {
    if (!tiledGraph) return null;
    
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
    
    // Draw edges (from each node to its parent)
    for (const edge of tiledGraph.edges) {
      const fromNode = tiledGraph.nodes[edge.fromId];
      const toNode = tiledGraph.nodes[edge.toId];
      
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
    
    // Draw dots for each node
    for (const node of tiledGraph.nodes) {
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
      
      <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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
                // Root will be reset to (0,0) by useEffect when length changes
                // No need to set it here - the useEffect handles it
              }}
              style={{ marginLeft: "10px", width: "60px" }}
            />
          </label>
          
          <label>
            Multiplier:
            <input
              type="number"
              min={1}
              max={5}
              value={multiplier}
              onChange={(e) => {
                setMultiplier(parseInt(e.target.value));
                setSolution(null);
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
                setSolution(null);
              }}
              style={{ marginLeft: "10px" }}
            >
              <option value="P1">P1 (Torus)</option>
              <option value="P2">P2 (180° Rotation)</option>
            </select>
          </label>
          
          <div style={{ marginTop: "10px" }}>
            <strong>Root:</strong> ({rootRow}, {rootCol})
            {selectedCell && (
              <button
                onClick={handleSetRoot}
                style={{ marginLeft: "10px" }}
                disabled={selectedCell.row === rootRow && selectedCell.col === rootCol}
              >
                Set ({selectedCell.row}, {selectedCell.col}) as Root
              </button>
            )}
          </div>
          
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
          
          {solution && (
            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button
                onClick={() => setViewMode("maze")}
                style={{ 
                  padding: "5px 15px",
                  backgroundColor: viewMode === "maze" ? "#1976d2" : "#e0e0e0",
                  color: viewMode === "maze" ? "white" : "black",
                }}
              >
                Maze
              </button>
              <button
                onClick={() => setViewMode("graph")}
                style={{ 
                  padding: "5px 15px",
                  backgroundColor: viewMode === "graph" ? "#1976d2" : "#e0e0e0",
                  color: viewMode === "graph" ? "white" : "black",
                }}
              >
                Graph
              </button>
            </div>
          )}
          
          {/* Selected node info for graph view */}
          {viewMode === "graph" && graphSelectedNode && (
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
        
        {/* Grid */}
        <div>
          {viewMode === "maze" || !solution ? (
            renderMazeView()
          ) : (
            renderGraphView()
          )}
        </div>
      </div>
      
      {/* Info panel */}
      {selectedCell && !solution && (
        <div style={{ marginTop: "10px" }}>
          <strong>Selected Cell:</strong> ({selectedCell.row}, {selectedCell.col})
          <span style={{ marginLeft: "20px", color: "#ff4081" }}>
            Neighbors highlighted in pink
          </span>
        </div>
      )}
    </div>
  );
}
