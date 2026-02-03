import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import WallpaperMazeWorker from "./problem/wallpaper-maze.worker?worker";
import type { WallpaperMazeRequest, WallpaperMazeResponse } from "./problem/wallpaper-maze.worker";
import "./App.css";

/**
 * Wallpaper Maze Explorer
 * 
 * Creates mazes on a square grid with wallpaper group symmetry.
 * Currently supports P1 (torus/regular wrapping) and P2 (180° rotation wrapping).
 * 
 * The user:
 * 1. Selects a grid length (length × length grid)
 * 2. Selects a multiplier (number of copies to display)
 * 3. Selects a wallpaper group (P1 or P2)
 * 4. Picks a root cell in the grid
 * 5. Clicks "Solve" to generate a spanning tree maze
 * 
 * The maze is rendered by placing walls on edges that don't have parent-child relationships.
 */

// Types
export type WallpaperGroup = "P1" | "P2";

interface GridCell {
  row: number;
  col: number;
}

interface MazeEdge {
  from: GridCell;
  to: GridCell;
  isKept: boolean; // true = passage, false = wall
}

interface MazeSolution {
  edges: MazeEdge[];
  parentOf: Map<string, GridCell | null>; // Maps "row,col" to parent cell (null for root)
  distanceFromRoot: Map<string, number>; // Maps "row,col" to distance from root
}

// Get canonical key for a cell
function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Get the 4 neighbors of a cell with wallpaper group wrapping.
 * Returns an object with NSEW labels mapping to the wrapped neighbor coordinates.
 */
function getWrappedNeighbors(
  row: number,
  col: number,
  length: number,
  wallpaperGroup: WallpaperGroup
): { N: GridCell; S: GridCell; E: GridCell; W: GridCell } {
  if (wallpaperGroup === "P1") {
    // P1: Regular torus wrapping
    return {
      N: { row: (row - 1 + length) % length, col },
      S: { row: (row + 1) % length, col },
      E: { row, col: (col + 1) % length },
      W: { row, col: (col - 1 + length) % length },
    };
  } else {
    // P2: 180° rotation at boundaries
    // Western edge of (row, 0) wraps to western edge of (length - 1 - row, 0)
    // Eastern edge of (row, length-1) wraps to eastern edge of (length - 1 - row, length-1)
    // Similarly for north/south edges
    let N: GridCell, S: GridCell, E: GridCell, W: GridCell;
    
    // North neighbor
    if (row === 0) {
      // Top edge wraps with 180° rotation
      N = { row: 0, col: (length - 1 - col) };
    } else {
      N = { row: row - 1, col };
    }
    
    // South neighbor
    if (row === length - 1) {
      // Bottom edge wraps with 180° rotation
      S = { row: length - 1, col: (length - 1 - col) };
    } else {
      S = { row: row + 1, col };
    }
    
    // West neighbor
    if (col === 0) {
      // Western edge wraps with 180° rotation
      W = { row: (length - 1 - row), col: 0 };
    } else {
      W = { row, col: col - 1 };
    }
    
    // East neighbor
    if (col === length - 1) {
      // Eastern edge wraps with 180° rotation
      E = { row: (length - 1 - row), col: length - 1 };
    } else {
      E = { row, col: col + 1 };
    }
    
    return { N, S, E, W };
  }
}


// Color palette based on distance from root (gradient from root color)
function getDistanceColor(distance: number, maxDistance: number): string {
  // Use HSL for smooth gradient
  // Map distance to a full hue rotation (0-360) across the maxDistance
  // This ensures unique colors for each distance level up to maxDistance
  const hue = (distance / Math.max(maxDistance, 1)) * 360;
  const saturation = 70;
  const lightness = 55; // Consistent lightness for readability
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export function WallpaperMazeExplorer() {
  const [length, setLength] = useState(4);
  const [multiplier, setMultiplier] = useState(2);
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroup>("P1");
  const [rootRow, setRootRow] = useState(0);
  const [rootCol, setRootCol] = useState(0);
  const [solution, setSolution] = useState<MazeSolution | null>(null);
  const [solving, setSolving] = useState(false);
  const [selectedCell, setSelectedCell] = useState<GridCell | null>(null);
  const [satStats, setSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Worker ref for cancel support
  const workerRef = useRef<Worker | null>(null);
  
  const cellSize = 40;
  const padding = 20;
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  // Handle solve button click - uses CadicalSolver via worker
  const handleSolve = useCallback(() => {
    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    
    setSolving(true);
    setSolution(null);
    setErrorMessage(null);
    setSatStats(null);
    
    // Create a new worker
    const worker = new WallpaperMazeWorker();
    workerRef.current = worker;
    
    worker.onmessage = (event: MessageEvent<WallpaperMazeResponse>) => {
      const response = event.data;
      
      if (response.messageType === "progress") {
        // Progress message with stats
        if (response.stats) {
          setSatStats(response.stats);
        }
        return;
      }
      
      // Result message
      if (response.success && response.result) {
        // Convert arrays back to Maps
        const parentOf = new Map<string, GridCell | null>(
          response.result.parentOf.map(([key, value]) => [key, value])
        );
        const distanceFromRoot = new Map<string, number>(response.result.distanceFromRoot);
        
        setSolution({
          edges: response.result.edges,
          parentOf,
          distanceFromRoot,
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
    
    // Send the request to the worker
    const request: WallpaperMazeRequest = {
      length,
      rootRow,
      rootCol,
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
  
  // Handle cell click for root selection or neighbor visualization
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
      setSolution(null); // Clear solution when root changes
    }
  }, [selectedCell]);
  
  // Get neighbor info for selected cell
  const neighborInfo = useMemo(() => {
    if (!selectedCell) return null;
    return getWrappedNeighbors(selectedCell.row, selectedCell.col, length, wallpaperGroup);
  }, [selectedCell, length, wallpaperGroup]);
  
  // Compute max distance for color scaling
  const maxDistance = useMemo(() => {
    if (!solution) return 1;
    let max = 0;
    for (const dist of solution.distanceFromRoot.values()) {
      if (dist > max) max = dist;
    }
    return Math.max(max, 1);
  }, [solution]);
  
  // Render a single maze grid
  const renderMazeGrid = (
    copyIndex: number,
    offsetX: number,
    offsetY: number
  ) => {
    const cells: React.ReactNode[] = [];
    const walls: React.ReactNode[] = [];
    const highlights: React.ReactNode[] = [];
    
    // Determine which cells are neighbors of the selected cell (for highlighting)
    const neighborCells = new Set<string>();
    if (selectedCell && neighborInfo) {
      neighborCells.add(cellKey(neighborInfo.N.row, neighborInfo.N.col));
      neighborCells.add(cellKey(neighborInfo.S.row, neighborInfo.S.col));
      neighborCells.add(cellKey(neighborInfo.E.row, neighborInfo.E.col));
      neighborCells.add(cellKey(neighborInfo.W.row, neighborInfo.W.col));
    }
    
    // Render cells
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        const x = offsetX + col * cellSize;
        const y = offsetY + row * cellSize;
        const isRoot = row === rootRow && col === rootCol;
        const isSelected = selectedCell && selectedCell.row === row && selectedCell.col === col;
        const isNeighbor = neighborCells.has(cellKey(row, col));
        
        // Determine cell color based on distance from root
        let fillColor: string;
        if (isRoot) {
          fillColor = "#ffeb3b"; // Yellow for root
        } else if (solution && solution.distanceFromRoot.has(cellKey(row, col))) {
          const dist = solution.distanceFromRoot.get(cellKey(row, col))!;
          fillColor = getDistanceColor(dist, maxDistance);
        } else {
          fillColor = "#e0e0e0"; // Gray for unsolved cells
        }
        
        cells.push(
          <rect
            key={`cell-${copyIndex}-${row}-${col}`}
            x={x}
            y={y}
            width={cellSize}
            height={cellSize}
            fill={fillColor}
            stroke="none"
            style={{ cursor: copyIndex === 0 ? "pointer" : "default" }}
            onClick={copyIndex === 0 ? () => handleCellClick(row, col) : undefined}
          />
        );
        
        // Highlight selected cell with a thick border
        if (copyIndex === 0 && isSelected) {
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
        
        // Highlight neighbor cells with a colored border
        if (copyIndex === 0 && isNeighbor && !isSelected) {
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
        
        // Show root indicator
        if (isRoot) {
          cells.push(
            <circle
              key={`root-${copyIndex}-${row}-${col}`}
              cx={x + cellSize / 2}
              cy={y + cellSize / 2}
              r={cellSize / 6}
              fill="#000"
            />
          );
        }
      }
    }
    
    // Render walls from solution (edges without parent-child relationship)
    if (solution) {
      for (const edge of solution.edges) {
        if (edge.isKept) continue; // No wall for kept edges
        
        // Find the wall position
        const { from, to } = edge;
        
        // Only draw walls that are on the boundary of this copy
        // For internal edges, draw the wall between cells
        const dr = to.row - from.row;
        const dc = to.col - from.col;
        
        // Handle wrapped edges differently
        const isWrap = Math.abs(dr) > 1 || Math.abs(dc) > 1;
        
        if (!isWrap) {
          // Internal edge - draw wall between adjacent cells
          let x1, y1, x2, y2;
          
          if (dc === 1) {
            // East wall from 'from' cell
            x1 = offsetX + from.col * cellSize + cellSize;
            y1 = offsetY + from.row * cellSize;
            x2 = x1;
            y2 = y1 + cellSize;
          } else if (dc === -1) {
            // West wall from 'from' cell
            x1 = offsetX + from.col * cellSize;
            y1 = offsetY + from.row * cellSize;
            x2 = x1;
            y2 = y1 + cellSize;
          } else if (dr === 1) {
            // South wall from 'from' cell
            x1 = offsetX + from.col * cellSize;
            y1 = offsetY + from.row * cellSize + cellSize;
            x2 = x1 + cellSize;
            y2 = y1;
          } else if (dr === -1) {
            // North wall from 'from' cell
            x1 = offsetX + from.col * cellSize;
            y1 = offsetY + from.row * cellSize;
            x2 = x1 + cellSize;
            y2 = y1;
          } else {
            continue;
          }
          
          walls.push(
            <line
              key={`wall-${copyIndex}-${from.row}-${from.col}-${to.row}-${to.col}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#000"
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        }
      }
      
      // Draw outer boundary walls for non-kept wrap edges
      for (const edge of solution.edges) {
        if (edge.isKept) continue;
        
        const { from, to } = edge;
        const dr = to.row - from.row;
        const dc = to.col - from.col;
        
        const isWrap = Math.abs(dr) > 1 || Math.abs(dc) > 1;
        if (!isWrap) continue;
        
        // This is a wrapped edge - draw walls on both boundaries
        // Draw on the boundary side where each cell is
        for (const cell of [from, to]) {
          let x1, y1, x2, y2;
          const cellX = offsetX + cell.col * cellSize;
          const cellY = offsetY + cell.row * cellSize;
          
          // Determine which edge this wrap is on
          if (cell === from) {
            if (dc > 1) {
              // West wrap from eastern edge
              x1 = cellX; y1 = cellY; x2 = cellX; y2 = cellY + cellSize;
            } else if (dc < -1) {
              // East wrap from western edge  
              x1 = cellX + cellSize; y1 = cellY; x2 = cellX + cellSize; y2 = cellY + cellSize;
            } else if (dr > 1) {
              // North wrap from southern edge
              x1 = cellX; y1 = cellY; x2 = cellX + cellSize; y2 = cellY;
            } else if (dr < -1) {
              // South wrap from northern edge
              x1 = cellX; y1 = cellY + cellSize; x2 = cellX + cellSize; y2 = cellY + cellSize;
            } else {
              continue;
            }
          } else {
            if (dc > 1) {
              // East wrap edge
              x1 = cellX + cellSize; y1 = cellY; x2 = cellX + cellSize; y2 = cellY + cellSize;
            } else if (dc < -1) {
              // West wrap edge
              x1 = cellX; y1 = cellY; x2 = cellX; y2 = cellY + cellSize;
            } else if (dr > 1) {
              // South wrap edge
              x1 = cellX; y1 = cellY + cellSize; x2 = cellX + cellSize; y2 = cellY + cellSize;
            } else if (dr < -1) {
              // North wrap edge
              x1 = cellX; y1 = cellY; x2 = cellX + cellSize; y2 = cellY;
            } else {
              continue;
            }
          }
          
          walls.push(
            <line
              key={`wrapwall-${copyIndex}-${cell.row}-${cell.col}-${from.row}-${from.col}-${to.row}-${to.col}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#000"
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        }
      }
    }
    
    return (
      <g key={`maze-${copyIndex}`}>
        {cells}
        {walls}
        {highlights}
      </g>
    );
  };
  
  // Calculate grid positions based on wallpaper group
  const getCopyPosition = (copyRow: number, copyCol: number): { x: number; y: number; rotation: number } => {
    const gridSize = length * cellSize;
    const x = padding + copyCol * gridSize;
    const y = padding + copyRow * gridSize;
    
    if (wallpaperGroup === "P1") {
      // P1: Simple translation
      return { x, y, rotation: 0 };
    } else {
      // P2: 180° rotation for odd positions
      const isRotated = (copyRow + copyCol) % 2 === 1;
      return { x, y, rotation: isRotated ? 180 : 0 };
    }
  };
  
  // Render all maze copies
  const renderAllMazes = () => {
    const mazes: React.ReactNode[] = [];
    const gridSize = length * cellSize;
    
    for (let row = 0; row < multiplier; row++) {
      for (let col = 0; col < multiplier; col++) {
        const copyIndex = row * multiplier + col;
        const { x, y, rotation } = getCopyPosition(row, col);
        
        if (rotation !== 0) {
          const centerX = x + gridSize / 2;
          const centerY = y + gridSize / 2;
          mazes.push(
            <g
              key={`maze-group-${copyIndex}`}
              transform={`rotate(${rotation}, ${centerX}, ${centerY})`}
            >
              {renderMazeGrid(copyIndex, x, y)}
            </g>
          );
        } else {
          mazes.push(renderMazeGrid(copyIndex, x, y));
        }
      }
    }
    
    return mazes;
  };
  
  const svgWidth = padding * 2 + multiplier * length * cellSize;
  const svgHeight = padding * 2 + multiplier * length * cellSize;
  
  return (
    <div className="app-container" style={{ padding: "20px" }}>
      <h1>🧱 Wallpaper Mazes</h1>
      <p>
        Create mazes on a square grid with wallpaper group symmetry.
        Select a grid size, wallpaper group, and root cell, then solve to generate a spanning tree maze.
      </p>
      
      <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
        <div>
          <label style={{ display: "block", marginBottom: "5px" }}>
            Grid Length: {length}
          </label>
          <input
            type="range"
            min="2"
            max="8"
            value={length}
            onChange={(e) => {
              const newLength = parseInt(e.target.value, 10);
              setLength(newLength);
              setRootRow(Math.min(rootRow, newLength - 1));
              setRootCol(Math.min(rootCol, newLength - 1));
              setSolution(null);
              setSelectedCell(null);
            }}
            style={{ width: "150px" }}
          />
        </div>
        
        <div>
          <label style={{ display: "block", marginBottom: "5px" }}>
            Multiplier: {multiplier}
          </label>
          <input
            type="range"
            min="1"
            max="4"
            value={multiplier}
            onChange={(e) => setMultiplier(parseInt(e.target.value, 10))}
            style={{ width: "150px" }}
          />
        </div>
        
        <div>
          <label style={{ display: "block", marginBottom: "5px" }}>
            Wallpaper Group:
          </label>
          <select
            value={wallpaperGroup}
            onChange={(e) => {
              setWallpaperGroup(e.target.value as WallpaperGroup);
              setSolution(null);
            }}
            style={{ padding: "5px", fontSize: "14px" }}
          >
            <option value="P1">P1 (Torus)</option>
            <option value="P2">P2 (180° Rotation)</option>
          </select>
        </div>
        
        <div>
          <label style={{ display: "block", marginBottom: "5px" }}>
            Root: ({rootRow}, {rootCol})
          </label>
          <button
            onClick={handleSetRoot}
            disabled={!selectedCell}
            style={{
              padding: "5px 10px",
              fontSize: "14px",
              cursor: selectedCell ? "pointer" : "not-allowed",
            }}
          >
            Set Selected as Root
          </button>
        </div>
        
        <div>
          <label style={{ display: "block", marginBottom: "5px" }}>&nbsp;</label>
          {solving ? (
            <button
              onClick={handleCancel}
              style={{
                padding: "10px 20px",
                fontSize: "16px",
                backgroundColor: "#e74c3c",
                color: "white",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleSolve}
              style={{
                padding: "10px 20px",
                fontSize: "16px",
                backgroundColor: "#3498db",
                color: "white",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              Solve
            </button>
          )}
        </div>
      </div>
      
      {/* Show solving status with SAT stats */}
      {solving && (
        <div style={{ 
          backgroundColor: "#fff3cd", 
          padding: "10px", 
          borderRadius: "5px",
          marginBottom: "20px",
          fontFamily: "monospace"
        }}>
          <strong>⏳ Solving with CaDiCaL...</strong>
          {satStats && (
            <span> ({satStats.numVars.toLocaleString()} variables, {satStats.numClauses.toLocaleString()} clauses)</span>
          )}
        </div>
      )}
      
      {/* Show error message */}
      {errorMessage && !solving && (
        <div style={{ 
          backgroundColor: "#f8d7da", 
          padding: "10px", 
          borderRadius: "5px",
          marginBottom: "20px",
          color: "#721c24"
        }}>
          {errorMessage}
        </div>
      )}
      
      {selectedCell && neighborInfo && (
        <div style={{ 
          backgroundColor: "#f0f0f0", 
          padding: "10px", 
          borderRadius: "5px",
          marginBottom: "20px",
          fontFamily: "monospace"
        }}
        role="status"
        aria-live="polite"
        >
          <strong>Selected: ({selectedCell.row}, {selectedCell.col})</strong> — 
          Adjacent cells are highlighted with a distinctive border pattern
          <span style={{ color: "#ff4081" }} aria-hidden="true"> (pink dashed)</span>
        </div>
      )}
      
      <div style={{ 
        border: "1px solid #ccc", 
        borderRadius: "5px", 
        backgroundColor: "#fff",
        display: "inline-block"
      }}>
        <svg width={svgWidth} height={svgHeight}>
          {renderAllMazes()}
        </svg>
      </div>
      
      {solution && (
        <div style={{ marginTop: "20px", color: "#2ecc71" }}>
          ✓ Maze solved! Cells colored by distance from root. Click cells to see neighbors.
        </div>
      )}
    </div>
  );
}

export default WallpaperMazeExplorer;
