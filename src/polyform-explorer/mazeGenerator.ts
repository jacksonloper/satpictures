/**
 * Maze Generator for Polyform Tilings
 * 
 * Given a solution (set of placements), this module:
 * 1. Builds an adjacency graph where nodes = placements, edges = shared walls
 * 2. Generates a random spanning tree
 * 3. Opens one random wall for each spanning tree edge
 * 4. Returns the remaining exterior walls
 */

import type { Placement, Coord } from "../problem/polyomino-tiling";

/** A wall between two cells or at the boundary */
export interface Wall {
  /** First cell coordinate */
  cell1: Coord;
  /** Direction from cell1 to cell2 (or outside if boundary) */
  direction: "top" | "bottom" | "left" | "right";
}

/** An edge in the adjacency graph (shared wall between two placements) */
interface AdjacencyEdge {
  /** Index of first placement */
  placement1: number;
  /** Index of second placement */
  placement2: number;
  /** All shared walls between these two placements */
  sharedWalls: Wall[];
}

/** Result of maze generation */
export interface MazeResult {
  /** Walls that remain after opening spanning tree paths */
  remainingWalls: Wall[];
  /** Edges in the spanning tree (for debugging/visualization) */
  spanningTreeEdges: Array<{ p1: number; p2: number; openedWall: Wall }>;
}

/**
 * Get the neighbor coordinate in a given direction (for square grid)
 */
function getNeighbor(coord: Coord, direction: "top" | "bottom" | "left" | "right"): Coord {
  switch (direction) {
    case "top":
      return { row: coord.row - 1, col: coord.col };
    case "bottom":
      return { row: coord.row + 1, col: coord.col };
    case "left":
      return { row: coord.row, col: coord.col - 1 };
    case "right":
      return { row: coord.row, col: coord.col + 1 };
  }
}

/**
 * Build a map from cell coordinate to placement index
 */
function buildCellToPlacementMap(placements: Placement[]): Map<string, number> {
  const map = new Map<string, number>();
  placements.forEach((p, index) => {
    for (const cell of p.cells) {
      map.set(`${cell.row},${cell.col}`, index);
    }
  });
  return map;
}

/**
 * Find all adjacency edges between placements (shared walls)
 */
function findAdjacencyEdges(placements: Placement[]): AdjacencyEdge[] {
  const cellToPlacement = buildCellToPlacementMap(placements);
  const edgeMap = new Map<string, AdjacencyEdge>();
  
  const directions: Array<"top" | "bottom" | "left" | "right"> = ["top", "bottom", "left", "right"];
  
  placements.forEach((p, pIndex) => {
    for (const cell of p.cells) {
      for (const dir of directions) {
        const neighbor = getNeighbor(cell, dir);
        const neighborKey = `${neighbor.row},${neighbor.col}`;
        const neighborPlacement = cellToPlacement.get(neighborKey);
        
        // Check if neighbor belongs to a different placement
        if (neighborPlacement !== undefined && neighborPlacement !== pIndex) {
          // Create a canonical edge key (smaller index first)
          const p1 = Math.min(pIndex, neighborPlacement);
          const p2 = Math.max(pIndex, neighborPlacement);
          const edgeKey = `${p1}-${p2}`;
          
          // The wall is defined from the current cell's perspective
          const wall: Wall = {
            cell1: cell,
            direction: dir,
          };
          
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              placement1: p1,
              placement2: p2,
              sharedWalls: [],
            });
          }
          
          // Only add wall once (from the lower-indexed placement's cell)
          if (pIndex === p1) {
            edgeMap.get(edgeKey)!.sharedWalls.push(wall);
          }
        }
      }
    }
  });
  
  return Array.from(edgeMap.values());
}

/**
 * Find all boundary/exterior walls for all placements
 */
function findAllBoundaryWalls(placements: Placement[]): Wall[] {
  const cellToPlacement = buildCellToPlacementMap(placements);
  const walls: Wall[] = [];
  const directions: Array<"top" | "bottom" | "left" | "right"> = ["top", "bottom", "left", "right"];
  
  placements.forEach((p, pIndex) => {
    for (const cell of p.cells) {
      for (const dir of directions) {
        const neighbor = getNeighbor(cell, dir);
        const neighborKey = `${neighbor.row},${neighbor.col}`;
        const neighborPlacement = cellToPlacement.get(neighborKey);
        
        // Wall exists if neighbor is outside (undefined) or belongs to a different placement
        if (neighborPlacement === undefined || neighborPlacement !== pIndex) {
          walls.push({
            cell1: cell,
            direction: dir,
          });
        }
      }
    }
  });
  
  return walls;
}

/**
 * Union-Find data structure for Kruskal's algorithm
 */
class UnionFind {
  private parent: number[];
  private rank: number[];
  
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }
  
  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // Path compression
    }
    return this.parent[x];
  }
  
  union(x: number, y: number): boolean {
    const px = this.find(x);
    const py = this.find(y);
    
    if (px === py) return false; // Already in same set
    
    // Union by rank
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py;
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      this.rank[px]++;
    }
    
    return true;
  }
}

/**
 * Shuffle an array in-place using Fisher-Yates algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Generate a random spanning tree using Kruskal's algorithm.
 * 
 * Note: If the placement graph is disconnected (rare in valid tilings),
 * this will return a spanning forest instead of a spanning tree.
 * In that case, the resulting maze will have isolated regions.
 */
function generateSpanningTree(numNodes: number, edges: AdjacencyEdge[]): AdjacencyEdge[] {
  if (numNodes <= 1) return [];
  
  const uf = new UnionFind(numNodes);
  const shuffledEdges = shuffleArray([...edges]);
  const spanningTree: AdjacencyEdge[] = [];
  
  for (const edge of shuffledEdges) {
    if (uf.union(edge.placement1, edge.placement2)) {
      spanningTree.push(edge);
      if (spanningTree.length === numNodes - 1) break;
    }
  }
  
  return spanningTree;
}

/**
 * Create a canonical wall key for deduplication
 */
function wallKey(wall: Wall): string {
  // Normalize by always representing the wall from the cell with smaller coordinates
  const neighbor = getNeighbor(wall.cell1, wall.direction);
  
  // For horizontal walls (top/bottom), use the cell above
  // For vertical walls (left/right), use the cell to the left
  if (wall.direction === "top" || wall.direction === "bottom") {
    const topCell = wall.direction === "top" ? neighbor : wall.cell1;
    return `h:${topCell.row},${topCell.col}`;
  } else {
    const leftCell = wall.direction === "left" ? neighbor : wall.cell1;
    return `v:${leftCell.row},${leftCell.col}`;
  }
}

/**
 * Generate a maze from a tiling solution
 * 
 * @param placements - The placements from the SAT solver solution
 * @returns MazeResult with remaining walls
 */
export function generateMaze(placements: Placement[]): MazeResult {
  if (placements.length === 0) {
    return { remainingWalls: [], spanningTreeEdges: [] };
  }
  
  // Step 1: Find all adjacency edges between placements
  const adjacencyEdges = findAdjacencyEdges(placements);
  
  // Step 2: Generate a random spanning tree
  const spanningTree = generateSpanningTree(placements.length, adjacencyEdges);
  
  // Step 3: For each spanning tree edge, open one random shared wall
  const wallsToOpen = new Set<string>();
  const spanningTreeEdges: Array<{ p1: number; p2: number; openedWall: Wall }> = [];
  
  for (const edge of spanningTree) {
    if (edge.sharedWalls.length > 0) {
      // Pick a random wall to open
      const randomIndex = Math.floor(Math.random() * edge.sharedWalls.length);
      const openedWall = edge.sharedWalls[randomIndex];
      wallsToOpen.add(wallKey(openedWall));
      
      spanningTreeEdges.push({
        p1: edge.placement1,
        p2: edge.placement2,
        openedWall,
      });
    }
  }
  
  // Step 4: Collect all walls and filter out opened ones
  const allWalls = findAllBoundaryWalls(placements);
  const wallsWithKeys = allWalls.map(w => ({ wall: w, key: wallKey(w) }));
  
  // Deduplicate walls (each wall appears twice, once from each side)
  const seenWalls = new Set<string>();
  const remainingWalls: Wall[] = [];
  
  for (const { wall, key } of wallsWithKeys) {
    if (!seenWalls.has(key) && !wallsToOpen.has(key)) {
      seenWalls.add(key);
      remainingWalls.push(wall);
    }
  }
  
  return { remainingWalls, spanningTreeEdges };
}
