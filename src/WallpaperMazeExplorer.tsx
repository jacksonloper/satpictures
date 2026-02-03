import { useState, useCallback, useMemo } from "react";
import { MiniSatSolver } from "./solvers";
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

/**
 * Get all unique edges in the wrapped grid.
 * Each edge is stored once with a canonical ordering.
 */
function getAllEdges(
  length: number,
  wallpaperGroup: WallpaperGroup
): Array<{ from: GridCell; to: GridCell; direction: "N" | "S" | "E" | "W" }> {
  const edges: Array<{ from: GridCell; to: GridCell; direction: "N" | "S" | "E" | "W" }> = [];
  const seen = new Set<string>();
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      const directions = ["N", "S", "E", "W"] as const;
      
      for (const dir of directions) {
        const neighbor = neighbors[dir];
        // Create canonical edge key (sort by cell key)
        const fromKey = cellKey(row, col);
        const toKey = cellKey(neighbor.row, neighbor.col);
        const edgeId = fromKey < toKey ? `${fromKey}-${toKey}` : `${toKey}-${fromKey}`;
        
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({ from: { row, col }, to: neighbor, direction: dir });
        }
      }
    }
  }
  
  return edges;
}

/**
 * Build the SAT problem for the spanning tree maze.
 * Uses the Sinz encoding (unary distance representation) to ensure acyclicity.
 */
interface CNF {
  numVars: number;
  clauses: number[][];
  varOf: Map<string, number>;
}

function buildMazeSATCNF(
  length: number,
  rootRow: number,
  rootCol: number,
  wallpaperGroup: WallpaperGroup
): CNF {
  const cnf: CNF = {
    numVars: 0,
    clauses: [],
    varOf: new Map(),
  };
  
  // Helper to get or create a variable
  function v(name: string): number {
    if (cnf.varOf.has(name)) return cnf.varOf.get(name)!;
    const id = ++cnf.numVars;
    cnf.varOf.set(name, id);
    return id;
  }
  
  // Add a clause
  function addClause(lits: number[]): void {
    const s = new Set<number>();
    for (const lit of lits) {
      if (s.has(-lit)) return; // tautology
      s.add(lit);
    }
    cnf.clauses.push([...s]);
  }
  
  // Add implication: a -> b
  function addImp(a: number, b: number): void {
    addClause([-a, b]);
  }
  
  const N = length * length; // Total number of cells
  const rootKey = cellKey(rootRow, rootCol);
  
  // Variable definitions:
  // par(u,v) = "v is the parent of u" (u -> v in the tree)
  // dist_d(u) = "distance of u from root is >= d" (unary encoding)
  
  const parentVar = (uRow: number, uCol: number, vRow: number, vCol: number) =>
    v(`par(${cellKey(uRow, uCol)})->(${cellKey(vRow, vCol)})`);
  
  const distVar = (row: number, col: number, d: number) =>
    v(`dist(${cellKey(row, col)})>=${d}`);
  
  // Build adjacency for all cells
  const adjacency = new Map<string, GridCell[]>();
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      adjacency.set(cellKey(row, col), [neighbors.N, neighbors.S, neighbors.E, neighbors.W]);
    }
  }
  
  // Constraint 1: Root has distance 0 (dist_d(root) is false for all d >= 1)
  addClause([-distVar(rootRow, rootCol, 1)]);
  
  // Constraint 2: Root has no parent
  for (const neighbor of adjacency.get(rootKey)!) {
    addClause([-parentVar(rootRow, rootCol, neighbor.row, neighbor.col)]);
  }
  
  // Constraint 3: Unary distance chain - dist_d(u) -> dist_(d-1)(u) for d >= 2
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      for (let d = 2; d <= N; d++) {
        addImp(distVar(row, col, d), distVar(row, col, d - 1));
      }
    }
  }
  
  // Constraint 4: Global distance cap - dist_N(u) is false for all nodes
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      addClause([-distVar(row, col, N)]);
    }
  }
  
  // Constraint 5: Non-root nodes must have exactly one parent
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      if (row === rootRow && col === rootCol) continue;
      
      const neighbors = adjacency.get(cellKey(row, col))!;
      const parentLits = neighbors.map(n => parentVar(row, col, n.row, n.col));
      
      // At least one parent
      addClause(parentLits);
      
      // At most one parent (pairwise)
      for (let i = 0; i < parentLits.length; i++) {
        for (let j = i + 1; j < parentLits.length; j++) {
          addClause([-parentLits[i], -parentLits[j]]);
        }
      }
      
      // Non-root must have positive distance
      addClause([distVar(row, col, 1)]);
    }
  }
  
  // Constraint 6: Anti-parallel parent constraint
  // If u chooses v as parent, v cannot choose u as parent
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = adjacency.get(cellKey(row, col))!;
      for (const n of neighbors) {
        addClause([
          -parentVar(row, col, n.row, n.col),
          -parentVar(n.row, n.col, row, col)
        ]);
      }
    }
  }
  
  // Constraint 7: Distance increment - if v is parent of u, then dist(u) = dist(v) + 1
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = adjacency.get(cellKey(row, col))!;
      
      for (const v of neighbors) {
        const p = parentVar(row, col, v.row, v.col);
        
        // par(u,v) -> dist(u) >= 1
        addImp(p, distVar(row, col, 1));
        
        // par(u,v) ∧ dist(v)>=d -> dist(u)>=(d+1)
        for (let d = 1; d < N; d++) {
          addClause([-p, -distVar(v.row, v.col, d), distVar(row, col, d + 1)]);
        }
        
        // par(u,v) ∧ dist(u)>=d -> dist(v)>=(d-1)
        for (let d = 2; d <= N; d++) {
          addClause([-p, -distVar(row, col, d), distVar(v.row, v.col, d - 1)]);
        }
      }
    }
  }
  
  return cnf;
}

/**
 * Compute distances from root via BFS on kept edges
 */
function computeDistances(
  length: number,
  rootRow: number,
  rootCol: number,
  keptEdges: Set<string>,
  wallpaperGroup: WallpaperGroup
): Map<string, number> {
  const distances = new Map<string, number>();
  const rootKey = cellKey(rootRow, rootCol);
  distances.set(rootKey, 0);
  
  const queue: GridCell[] = [{ row: rootRow, col: rootCol }];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = cellKey(current.row, current.col);
    const currentDist = distances.get(currentKey)!;
    
    const neighbors = getWrappedNeighbors(current.row, current.col, length, wallpaperGroup);
    const allNeighbors = [neighbors.N, neighbors.S, neighbors.E, neighbors.W];
    
    for (const neighbor of allNeighbors) {
      const neighborKey = cellKey(neighbor.row, neighbor.col);
      
      // Check if edge is kept (in either direction)
      const edgeKey1 = `${currentKey}-${neighborKey}`;
      const edgeKey2 = `${neighborKey}-${currentKey}`;
      const isConnected = keptEdges.has(edgeKey1) || keptEdges.has(edgeKey2);
      
      if (isConnected && !distances.has(neighborKey)) {
        distances.set(neighborKey, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }
  
  return distances;
}

// Color palette based on distance from root (gradient from root color)
function getDistanceColor(distance: number, maxDistance: number): string {
  // Use HSL for smooth gradient
  // Root is bright, farther cells are darker/different hue
  const hue = (distance * 30) % 360; // Rotate hue based on distance
  const saturation = 70;
  const lightness = 60 - (distance / Math.max(maxDistance, 1)) * 20; // Slightly darker as distance increases
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Solve the maze using MiniSat solver
 */
function solveMaze(
  length: number,
  rootRow: number,
  rootCol: number,
  wallpaperGroup: WallpaperGroup
): MazeSolution | null {
  const cnf = buildMazeSATCNF(length, rootRow, rootCol, wallpaperGroup);
  
  const solver = new MiniSatSolver();
  
  // Create all variables
  for (let i = 1; i <= cnf.numVars; i++) {
    solver.newVariable();
  }
  
  // Add all clauses
  for (const clause of cnf.clauses) {
    solver.addClause(clause);
  }
  
  // Solve
  const result = solver.solve();
  
  if (!result.satisfiable) {
    return null;
  }
  
  const assignment = result.assignment!;
  
  const parentOf = new Map<string, GridCell | null>();
  parentOf.set(cellKey(rootRow, rootCol), null);
  
  // Extract parent relationships from solution
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      if (row === rootRow && col === rootCol) continue;
      
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      const directions = [neighbors.N, neighbors.S, neighbors.E, neighbors.W];
      
      for (const n of directions) {
        const varName = `par(${cellKey(row, col)})->(${cellKey(n.row, n.col)})`;
        const varId = cnf.varOf.get(varName);
        if (varId && assignment.get(varId)) {
          parentOf.set(cellKey(row, col), n);
          break;
        }
      }
    }
  }
  
  // Build edges with kept/wall status
  const allEdges = getAllEdges(length, wallpaperGroup);
  const edges: MazeEdge[] = allEdges.map(e => {
    const fromKey = cellKey(e.from.row, e.from.col);
    const toKey = cellKey(e.to.row, e.to.col);
    
    // Check if there's a parent-child relationship
    const parentOfFrom = parentOf.get(fromKey);
    const parentOfTo = parentOf.get(toKey);
    
    const isKept = Boolean(
      (parentOfFrom && cellKey(parentOfFrom.row, parentOfFrom.col) === toKey) ||
      (parentOfTo && cellKey(parentOfTo.row, parentOfTo.col) === fromKey)
    );
    
    return { from: e.from, to: e.to, isKept };
  });
  
  // Build set of kept edges for distance computation
  const keptEdgeSet = new Set<string>();
  for (const edge of edges) {
    if (edge.isKept) {
      const fromKey = cellKey(edge.from.row, edge.from.col);
      const toKey = cellKey(edge.to.row, edge.to.col);
      keptEdgeSet.add(`${fromKey}-${toKey}`);
      keptEdgeSet.add(`${toKey}-${fromKey}`);
    }
  }
  
  // Compute distances from root
  const distanceFromRoot = computeDistances(length, rootRow, rootCol, keptEdgeSet, wallpaperGroup);
  
  return { edges, parentOf, distanceFromRoot };
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
  
  const cellSize = 40;
  const padding = 20;
  
  // Handle solve button click
  const handleSolve = useCallback(() => {
    setSolving(true);
    setSolution(null);
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      const result = solveMaze(length, rootRow, rootCol, wallpaperGroup);
      setSolution(result);
      setSolving(false);
    }, 10);
  }, [length, rootRow, rootCol, wallpaperGroup]);
  
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
          <button
            onClick={handleSolve}
            disabled={solving}
            style={{
              padding: "10px 20px",
              fontSize: "16px",
              backgroundColor: "#3498db",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: solving ? "not-allowed" : "pointer",
            }}
          >
            {solving ? "Solving..." : "Solve"}
          </button>
        </div>
      </div>
      
      {selectedCell && neighborInfo && (
        <div style={{ 
          backgroundColor: "#f0f0f0", 
          padding: "10px", 
          borderRadius: "5px",
          marginBottom: "20px",
          fontFamily: "monospace"
        }}>
          <strong>Selected: ({selectedCell.row}, {selectedCell.col})</strong> — Neighbors highlighted with <span style={{ color: "#ff4081" }}>pink dashed border</span>
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
