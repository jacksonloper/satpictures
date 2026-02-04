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



// Get a color for a specific root index (used to color cells by which root they connect to)
function getRootColor(rootIndex: number): string {
  // Use golden ratio to spread colors evenly
  const goldenRatio = 0.618033988749895;
  const hue = ((rootIndex * goldenRatio) % 1) * 360;
  const saturation = 65;
  const lightness = 50;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Key for a cell in the full tiled space (includes copy coordinates)
 */
function tiledCellKey(copyRow: number, copyCol: number, row: number, col: number): string {
  return `${copyRow},${copyCol},${row},${col}`;
}

/**
 * Get the child directions for a cell - these are the directions of cells that have THIS cell as parent.
 * For P2 with rotated copies (copyRow + copyCol is odd), directions are flipped.
 * 
 * Returns an array of { direction, childRow, childCol } for children in the fundamental domain.
 */
function getChildrenInFundamentalDomain(
  row: number,
  col: number,
  length: number,
  wallpaperGroup: WallpaperGroup,
  parentOf: Map<string, GridCell | null>
): Array<{ direction: "N" | "S" | "E" | "W"; row: number; col: number }> {
  const children: Array<{ direction: "N" | "S" | "E" | "W"; row: number; col: number }> = [];
  
  // Check all 4 neighbors to see if they have this cell as parent
  const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
  const directions: Array<{ dir: "N" | "S" | "E" | "W"; neighbor: GridCell }> = [
    { dir: "N", neighbor: neighbors.N },
    { dir: "S", neighbor: neighbors.S },
    { dir: "E", neighbor: neighbors.E },
    { dir: "W", neighbor: neighbors.W },
  ];
  
  for (const { dir, neighbor } of directions) {
    const neighborKey = cellKey(neighbor.row, neighbor.col);
    const neighborParent = parentOf.get(neighborKey);
    
    // If neighbor's parent is this cell, then neighbor is a child
    if (neighborParent && neighborParent.row === row && neighborParent.col === col) {
      children.push({ direction: dir, row: neighbor.row, col: neighbor.col });
    }
  }
  
  return children;
}

/**
 * Get the visual direction in tiled space (accounting for P2 rotation).
 * For rotated copies in P2, directions are flipped.
 */
function getVisualDirection(
  direction: "N" | "S" | "E" | "W",
  copyRow: number,
  copyCol: number,
  wallpaperGroup: WallpaperGroup
): "N" | "S" | "E" | "W" {
  if (wallpaperGroup === "P2" && (copyRow + copyCol) % 2 === 1) {
    const flipMap: Record<string, "N" | "S" | "E" | "W"> = {
      "N": "S", "S": "N", "E": "W", "W": "E"
    };
    return flipMap[direction];
  }
  return direction;
}

/**
 * Compute which root each cell connects to by tracing DOWN from each root.
 * Uses BFS from each root, following child edges in ordinary cardinal directions.
 * NO WRAPPING - cells outside the visible tiled space are not colored.
 * Returns a map from tiledCellKey to root index, or undefined for uncolored cells.
 */
function computeRootConnections(
  length: number,
  multiplier: number,
  wallpaperGroup: WallpaperGroup,
  rootRow: number,
  rootCol: number,
  parentOf: Map<string, GridCell | null>
): Map<string, number> {
  const rootConnections = new Map<string, number>();
  const totalSize = multiplier * length;
  
  // For each root position in the tiled space
  for (let rootCopyRow = 0; rootCopyRow < multiplier; rootCopyRow++) {
    for (let rootCopyCol = 0; rootCopyCol < multiplier; rootCopyCol++) {
      const rootIdx = rootCopyRow * multiplier + rootCopyCol;
      
      // BFS from this root position
      // Queue entries: { copyRow, copyCol, row, col, absRow, absCol }
      // absRow/absCol are the visual positions in the full tiled space
      
      // Calculate the visual position of the root in tiled space
      let rootAbsRow = rootCopyRow * length + rootRow;
      let rootAbsCol = rootCopyCol * length + rootCol;
      if (wallpaperGroup === "P2" && (rootCopyRow + rootCopyCol) % 2 === 1) {
        rootAbsRow = rootCopyRow * length + (length - 1 - rootRow);
        rootAbsCol = rootCopyCol * length + (length - 1 - rootCol);
      }
      
      const queue: Array<{
        copyRow: number;
        copyCol: number;
        row: number;
        col: number;
        absRow: number;
        absCol: number;
      }> = [{ 
        copyRow: rootCopyRow, 
        copyCol: rootCopyCol, 
        row: rootRow, 
        col: rootCol,
        absRow: rootAbsRow,
        absCol: rootAbsCol
      }];
      
      const visited = new Set<string>();
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        const key = tiledCellKey(current.copyRow, current.copyCol, current.row, current.col);
        
        // Skip if already visited or already colored by another root
        if (visited.has(key)) continue;
        if (rootConnections.has(key)) continue;
        
        visited.add(key);
        rootConnections.set(key, rootIdx);
        
        // Find children in the fundamental domain
        const children = getChildrenInFundamentalDomain(
          current.row, current.col, length, wallpaperGroup, parentOf
        );
        
        for (const child of children) {
          // Check if this is a simple adjacent edge (direction moves by 1 in that axis)
          // or a wrapped edge (P2 boundary wrapping within fundamental domain)
          const isAdjacentN = child.direction === "N" && child.row === current.row - 1;
          const isAdjacentS = child.direction === "S" && child.row === current.row + 1;
          const isAdjacentE = child.direction === "E" && child.col === current.col + 1;
          const isAdjacentW = child.direction === "W" && child.col === current.col - 1;
          const isSimpleAdjacent = isAdjacentN || isAdjacentS || isAdjacentE || isAdjacentW;
          
          if (isSimpleAdjacent) {
            // Simple adjacent edge - calculate new absolute position by direction
            const visualDir = getVisualDirection(
              child.direction, current.copyRow, current.copyCol, wallpaperGroup
            );
            
            let newAbsRow = current.absRow;
            let newAbsCol = current.absCol;
            switch (visualDir) {
              case "N": newAbsRow--; break;
              case "S": newAbsRow++; break;
              case "E": newAbsCol++; break;
              case "W": newAbsCol--; break;
            }
            
            // Check bounds - NO WRAPPING across copies
            if (newAbsRow < 0 || newAbsRow >= totalSize || 
                newAbsCol < 0 || newAbsCol >= totalSize) {
              continue; // Out of bounds, don't color
            }
            
            // Convert back to copy + cell coordinates
            const newCopyRow = Math.floor(newAbsRow / length);
            const newCopyCol = Math.floor(newAbsCol / length);
            let newRow = newAbsRow % length;
            let newCol = newAbsCol % length;
            
            // For rotated copies, convert visual position back to logical cell coordinates
            if (wallpaperGroup === "P2" && (newCopyRow + newCopyCol) % 2 === 1) {
              newRow = length - 1 - newRow;
              newCol = length - 1 - newCol;
            }
            
            // Verify this matches the expected child
            if (newRow !== child.row || newCol !== child.col) {
              continue;
            }
            
            queue.push({
              copyRow: newCopyRow,
              copyCol: newCopyCol,
              row: newRow,
              col: newCol,
              absRow: newAbsRow,
              absCol: newAbsCol
            });
          } else {
            // P2 wrapped edge - child is in the SAME copy but via boundary wrapping
            // Calculate child's absolute position within the same copy
            const isRotated = wallpaperGroup === "P2" && (current.copyRow + current.copyCol) % 2 === 1;
            const newAbsRow = current.copyRow * length + (isRotated ? (length - 1 - child.row) : child.row);
            const newAbsCol = current.copyCol * length + (isRotated ? (length - 1 - child.col) : child.col);
            
            queue.push({
              copyRow: current.copyRow,
              copyCol: current.copyCol,
              row: child.row,
              col: child.col,
              absRow: newAbsRow,
              absCol: newAbsCol
            });
          }
        }
      }
    }
  }
  
  return rootConnections;
}

// View mode type
type ViewMode = "maze" | "graph";

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
  const [viewMode, setViewMode] = useState<ViewMode>("maze");
  const [graphSelectedCell, setGraphSelectedCell] = useState<GridCell | null>(null);
  
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
        const parentOf = new Map<string, GridCell | null>(response.result.parentOf);
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
  
  // Compute root connections for all cells in the tiled space
  const rootConnections = useMemo(() => {
    if (!solution) return null;
    return computeRootConnections(
      length, multiplier, wallpaperGroup, rootRow, rootCol, solution.parentOf
    );
  }, [solution, length, multiplier, wallpaperGroup, rootRow, rootCol]);
  
  // Render a single maze grid
  const renderMazeGrid = (
    copyIndex: number,
    offsetX: number,
    offsetY: number
  ) => {
    const cells: React.ReactNode[] = [];
    const walls: React.ReactNode[] = [];
    const highlights: React.ReactNode[] = [];
    
    // Get copy coordinates from index
    const copyRow = Math.floor(copyIndex / multiplier);
    const copyCol = copyIndex % multiplier;
    
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
        
        // Determine cell color using precomputed root connections
        let fillColor: string;
        if (rootConnections) {
          const key = tiledCellKey(copyRow, copyCol, row, col);
          const rootIdx = rootConnections.get(key);
          if (rootIdx !== undefined) {
            fillColor = getRootColor(rootIdx);
          } else {
            fillColor = "#d0d0d0"; // Gray for cells not reachable from any visible root
          }
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
  
  // Render the graph view showing dots for cells and arrows for parent relationships
  const renderGraphView = () => {
    if (!solution) return null;
    
    const dotRadius = 4;
    const graphPadding = 20;
    const graphCellSize = 30; // Smaller spacing for graph view
    
    const gridSize = length * graphCellSize;
    const totalWidth = graphPadding * 2 + multiplier * gridSize;
    const totalHeight = graphPadding * 2 + multiplier * gridSize;
    
    // Helper to get position for a cell within a single grid
    const getPos = (row: number, col: number, offsetX: number, offsetY: number) => ({
      x: offsetX + col * graphCellSize + graphCellSize / 2,
      y: offsetY + row * graphCellSize + graphCellSize / 2,
    });
    
    // Render a single graph grid
    const renderSingleGraph = (copyIndex: number, offsetX: number, offsetY: number) => {
      const dots: React.ReactNode[] = [];
      const arrows: React.ReactNode[] = [];
      const gridLines: React.ReactNode[] = [];
      
      // Draw grid lines for reference
      for (let i = 0; i <= length; i++) {
        gridLines.push(
          <line
            key={`vline-${copyIndex}-${i}`}
            x1={offsetX + i * graphCellSize}
            y1={offsetY}
            x2={offsetX + i * graphCellSize}
            y2={offsetY + gridSize}
            stroke="#eee"
            strokeWidth={1}
          />
        );
        gridLines.push(
          <line
            key={`hline-${copyIndex}-${i}`}
            x1={offsetX}
            y1={offsetY + i * graphCellSize}
            x2={offsetX + gridSize}
            y2={offsetY + i * graphCellSize}
            stroke="#eee"
            strokeWidth={1}
          />
        );
      }
      
      // Get copy coordinates from index
      const copyRow = Math.floor(copyIndex / multiplier);
      const copyCol = copyIndex % multiplier;
      
      // Draw dots for each cell
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          const { x, y } = getPos(row, col, offsetX, offsetY);
          const isRoot = row === rootRow && col === rootCol;
          
          // Use precomputed root connections for color
          const key = tiledCellKey(copyRow, copyCol, row, col);
          const rootIdx = rootConnections?.get(key);
          const cellColor = rootIdx !== undefined ? getRootColor(rootIdx) : "#d0d0d0";
          
          // Check if this cell is part of the selected equivalence class
          const isEquivalentToSelected = graphSelectedCell && 
            graphSelectedCell.row === row && graphSelectedCell.col === col;
          
          dots.push(
            <circle
              key={`dot-${copyIndex}-${row}-${col}`}
              cx={x}
              cy={y}
              r={isRoot ? dotRadius + 2 : dotRadius}
              fill={cellColor}
              stroke={isEquivalentToSelected ? "#ff00ff" : (isRoot ? "#000" : "#333")}
              strokeWidth={isEquivalentToSelected ? 3 : (isRoot ? 2 : 1)}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                if (graphSelectedCell && graphSelectedCell.row === row && graphSelectedCell.col === col) {
                  setGraphSelectedCell(null);
                } else {
                  setGraphSelectedCell({ row, col });
                }
              }}
            />
          );
          
          // If this is an equivalent cell, draw parent arrow pointing in the appropriate direction
          if (isEquivalentToSelected && !isRoot) {
            const parent = solution.parentOf.get(cellKey(row, col));
            if (parent) {
              // Find the direction to parent in the fundamental domain
              const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
              let parentDir: "N" | "S" | "E" | "W" | null = null;
              if (neighbors.N.row === parent.row && neighbors.N.col === parent.col) parentDir = "N";
              else if (neighbors.S.row === parent.row && neighbors.S.col === parent.col) parentDir = "S";
              else if (neighbors.E.row === parent.row && neighbors.E.col === parent.col) parentDir = "E";
              else if (neighbors.W.row === parent.row && neighbors.W.col === parent.col) parentDir = "W";
              
              if (parentDir) {
                // Use the raw parentDir - SVG transform handles rotation for P2 copies
                // (since the entire <g> group is rotated 180° for rotated copies)
                
                // Calculate arrow endpoint in the fundamental domain direction
                let dx = 0, dy = 0;
                const arrowLength = graphCellSize * 0.7;
                switch (parentDir) {
                  case "N": dy = -arrowLength; break;
                  case "S": dy = arrowLength; break;
                  case "E": dx = arrowLength; break;
                  case "W": dx = -arrowLength; break;
                }
                
                const arrowHeadSize = 6;
                const endX = x + dx;
                const endY = y + dy;
                
                // Calculate arrow head points
                let headAngle = 0;
                switch (parentDir) {
                  case "N": headAngle = Math.PI / 2; break;
                  case "S": headAngle = -Math.PI / 2; break;
                  case "E": headAngle = Math.PI; break;
                  case "W": headAngle = 0; break;
                }
                
                const leftX = endX + arrowHeadSize * Math.cos(headAngle - Math.PI / 6);
                const leftY = endY + arrowHeadSize * Math.sin(headAngle - Math.PI / 6);
                const rightX = endX + arrowHeadSize * Math.cos(headAngle + Math.PI / 6);
                const rightY = endY + arrowHeadSize * Math.sin(headAngle + Math.PI / 6);
                
                dots.push(
                  <g key={`parent-arrow-${copyIndex}-${row}-${col}`}>
                    <line
                      x1={x}
                      y1={y}
                      x2={endX}
                      y2={endY}
                      stroke="#ff00ff"
                      strokeWidth={2}
                    />
                    <polygon
                      points={`${endX},${endY} ${leftX},${leftY} ${rightX},${rightY}`}
                      fill="#ff00ff"
                    />
                  </g>
                );
              }
            }
          }
        }
      }
      
      // Draw lines from each cell to its children (direction we traverse when coloring)
      // This matches the direction we traced down from the root
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          const children = getChildrenInFundamentalDomain(
            row, col, length, wallpaperGroup, solution.parentOf
          );
          
          if (children.length === 0) continue;
          
          const parentPos = getPos(row, col, offsetX, offsetY);
          const parentKey = tiledCellKey(copyRow, copyCol, row, col);
          const parentRootIdx = rootConnections?.get(parentKey);
          const edgeColor = parentRootIdx !== undefined ? getRootColor(parentRootIdx) : "#d0d0d0";
          
          for (const child of children) {
            // Check if this is a simple adjacent edge or a P2 wrapped edge
            const isAdjacentN = child.direction === "N" && child.row === row - 1;
            const isAdjacentS = child.direction === "S" && child.row === row + 1;
            const isAdjacentE = child.direction === "E" && child.col === col + 1;
            const isAdjacentW = child.direction === "W" && child.col === col - 1;
            const isSimpleAdjacent = isAdjacentN || isAdjacentS || isAdjacentE || isAdjacentW;
            
            if (isSimpleAdjacent) {
              // Simple adjacent edge - draw line in the visual direction
              const visualDir = getVisualDirection(
                child.direction, copyRow, copyCol, wallpaperGroup
              );
              
              let dx = 0, dy = 0;
              switch (visualDir) {
                case "N": dy = -graphCellSize; break;
                case "S": dy = graphCellSize; break;
                case "E": dx = graphCellSize; break;
                case "W": dx = -graphCellSize; break;
              }
              
              const endX = parentPos.x + dx;
              const endY = parentPos.y + dy;
              
              // Check if endpoint is within the total tiled area
              const isRotated = wallpaperGroup === "P2" && (copyRow + copyCol) % 2 === 1;
              const parentAbsRow = copyRow * length + (isRotated ? (length - 1 - row) : row);
              const parentAbsCol = copyCol * length + (isRotated ? (length - 1 - col) : col);
              let targetAbsRow = parentAbsRow, targetAbsCol = parentAbsCol;
              switch (visualDir) {
                case "N": targetAbsRow--; break;
                case "S": targetAbsRow++; break;
                case "E": targetAbsCol++; break;
                case "W": targetAbsCol--; break;
              }
              
              const totalSize = multiplier * length;
              if (targetAbsRow < 0 || targetAbsRow >= totalSize || 
                  targetAbsCol < 0 || targetAbsCol >= totalSize) {
                continue; // Edge goes out of bounds - don't draw
              }
              
              arrows.push(
                <line
                  key={`edge-${copyIndex}-${row}-${col}-${child.direction}`}
                  x1={parentPos.x}
                  y1={parentPos.y}
                  x2={endX}
                  y2={endY}
                  stroke={edgeColor}
                  strokeWidth={2}
                />
              );
            } else {
              // P2 wrapped edge - draw line directly to child's position within same copy
              const childPos = getPos(child.row, child.col, offsetX, offsetY);
              
              arrows.push(
                <line
                  key={`edge-${copyIndex}-${row}-${col}-${child.direction}`}
                  x1={parentPos.x}
                  y1={parentPos.y}
                  x2={childPos.x}
                  y2={childPos.y}
                  stroke={edgeColor}
                  strokeWidth={2}
                />
              );
            }
          }
        }
      }
      
      return (
        <g key={`graph-${copyIndex}`}>
          {gridLines}
          {arrows}
          {dots}
        </g>
      );
    };
    
    // Calculate grid positions based on wallpaper group
    const getGraphCopyPosition = (copyRow: number, copyCol: number): { x: number; y: number; rotation: number } => {
      const x = graphPadding + copyCol * gridSize;
      const y = graphPadding + copyRow * gridSize;
      
      if (wallpaperGroup === "P1") {
        // P1: Simple translation
        return { x, y, rotation: 0 };
      } else {
        // P2: 180° rotation for odd positions
        const isRotated = (copyRow + copyCol) % 2 === 1;
        return { x, y, rotation: isRotated ? 180 : 0 };
      }
    };
    
    // Render all graph copies
    const allGraphs: React.ReactNode[] = [];
    
    for (let row = 0; row < multiplier; row++) {
      for (let col = 0; col < multiplier; col++) {
        const copyIndex = row * multiplier + col;
        const { x, y, rotation } = getGraphCopyPosition(row, col);
        
        if (rotation !== 0) {
          const centerX = x + gridSize / 2;
          const centerY = y + gridSize / 2;
          allGraphs.push(
            <g
              key={`graph-group-${copyIndex}`}
              transform={`rotate(${rotation}, ${centerX}, ${centerY})`}
            >
              {renderSingleGraph(copyIndex, x, y)}
            </g>
          );
        } else {
          allGraphs.push(renderSingleGraph(copyIndex, x, y));
        }
      }
    }
    
    return (
      <div>
        <svg width={totalWidth} height={totalHeight} style={{ backgroundColor: "#fff" }}>
          {allGraphs}
        </svg>
        {graphSelectedCell && (
          <div style={{ 
            marginTop: "10px", 
            padding: "10px", 
            backgroundColor: "#f0f0ff", 
            borderRadius: "4px",
            border: "1px solid #ccc",
            display: "inline-block"
          }}>
            <strong>Selected cell (fundamental domain):</strong> ({graphSelectedCell.row}, {graphSelectedCell.col})
            {(() => {
              const parent = solution.parentOf.get(cellKey(graphSelectedCell.row, graphSelectedCell.col));
              if (parent) {
                return (
                  <span style={{ marginLeft: "10px" }}>
                    | Parent: ({parent.row}, {parent.col})
                  </span>
                );
              }
              return null;
            })()}
            {graphSelectedCell.row === rootRow && graphSelectedCell.col === rootCol && (
              <span style={{ marginLeft: "10px", color: "#666" }}>| <em>This is a root</em></span>
            )}
          </div>
        )}
      </div>
    );
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
        
        {/* View mode toggle */}
        {solution && (
          <div>
            <label style={{ display: "block", marginBottom: "5px" }}>
              View Mode:
            </label>
            <div style={{ display: "flex", gap: "5px" }}>
              <button
                onClick={() => setViewMode("maze")}
                style={{
                  padding: "5px 10px",
                  fontSize: "14px",
                  backgroundColor: viewMode === "maze" ? "#3498db" : "#e0e0e0",
                  color: viewMode === "maze" ? "white" : "#333",
                  border: "none",
                  borderRadius: "5px 0 0 5px",
                  cursor: "pointer",
                }}
              >
                Maze
              </button>
              <button
                onClick={() => setViewMode("graph")}
                style={{
                  padding: "5px 10px",
                  fontSize: "14px",
                  backgroundColor: viewMode === "graph" ? "#3498db" : "#e0e0e0",
                  color: viewMode === "graph" ? "white" : "#333",
                  border: "none",
                  borderRadius: "0 5px 5px 0",
                  cursor: "pointer",
                }}
              >
                Graph
              </button>
            </div>
          </div>
        )}
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
      
      {selectedCell && neighborInfo && viewMode === "maze" && (
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
        {viewMode === "maze" ? (
          <svg width={svgWidth} height={svgHeight}>
            {renderAllMazes()}
          </svg>
        ) : (
          renderGraphView()
        )}
      </div>
      
      {solution && (
        <div style={{ marginTop: "20px", color: "#2ecc71" }}>
          ✓ Maze solved! {viewMode === "maze" 
            ? "Cells colored by distance from root. Click cells to see neighbors." 
            : "Graph shows arrows pointing from each cell to its parent in the spanning tree."}
        </div>
      )}
    </div>
  );
}

export default WallpaperMazeExplorer;
