/**
 * Triangle Maze Generator for Polyiamond Tilings
 * 
 * Given a solution (set of triangle placements), this module:
 * 1. Builds an adjacency graph where nodes = placements, edges = shared walls
 * 2. Generates a random spanning tree
 * 3. Opens one random wall for each spanning tree edge
 * 4. Returns the remaining walls (both interior and exterior walls that were not opened)
 */

import type { TriPlacement, TriCoord } from "../problem/polyiamond-tiling";

/** A triangle wall between two cells or at the boundary */
export interface TriWall {
  /** First cell coordinate (row, col) */
  cell1: TriCoord;
  /** Edge index (0-2) indicating which edge of the triangle */
  edgeIndex: number;
}

/** An edge in the adjacency graph (shared wall between two placements) */
interface AdjacencyEdge {
  /** Index of first placement */
  placement1: number;
  /** Index of second placement */
  placement2: number;
  /** All shared walls between these two placements */
  sharedWalls: TriWall[];
}

/** Result of triangle maze generation */
export interface TriMazeResult {
  /** Walls that remain after opening spanning tree paths */
  remainingWalls: TriWall[];
  /** Edges in the spanning tree (for debugging/visualization) */
  spanningTreeEdges: Array<{ p1: number; p2: number; openedWall: TriWall }>;
}

/**
 * Get the 3 neighbors with their corresponding edge indices.
 * Edge index tells which edge of the current triangle faces that neighbor.
 * 
 * For triangle cells, orientation alternates based on (row + col) % 2:
 * - UP triangles (row + col even): neighbors at left (col-1), right (col+1), and below (row+1)
 * - DOWN triangles (row + col odd): neighbors at left (col-1), right (col+1), and above (row-1)
 * 
 * Edge indices for consistency:
 * - Edge 0: left neighbor (col - 1)
 * - Edge 1: right neighbor (col + 1)  
 * - Edge 2: vertical neighbor (row ± 1 depending on orientation)
 */
function getTriNeighbors(row: number, col: number): Array<{ row: number; col: number; edgeIndex: number }> {
  const isUp = (row + col) % 2 === 0;
  return [
    { row, col: col - 1, edgeIndex: 0 },  // Left neighbor
    { row, col: col + 1, edgeIndex: 1 },  // Right neighbor
    { row: isUp ? row + 1 : row - 1, col, edgeIndex: 2 },  // Vertical neighbor (below for UP, above for DOWN)
  ];
}

/**
 * Build a map from cell coordinate to placement index
 */
function buildCellToPlacementMap(placements: TriPlacement[]): Map<string, number> {
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
function findAdjacencyEdges(placements: TriPlacement[]): AdjacencyEdge[] {
  const cellToPlacement = buildCellToPlacementMap(placements);
  const edgeMap = new Map<string, AdjacencyEdge>();
  
  placements.forEach((p, pIndex) => {
    for (const cell of p.cells) {
      const neighbors = getTriNeighbors(cell.row, cell.col);
      
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.row},${neighbor.col}`;
        const neighborPlacement = cellToPlacement.get(neighborKey);
        
        // Check if neighbor belongs to a different placement
        if (neighborPlacement !== undefined && neighborPlacement !== pIndex) {
          // Create a canonical edge key (smaller index first)
          const p1 = Math.min(pIndex, neighborPlacement);
          const p2 = Math.max(pIndex, neighborPlacement);
          const edgeKey = `${p1}-${p2}`;
          
          // The wall is defined from the current cell's perspective
          const wall: TriWall = {
            cell1: { row: cell.row, col: cell.col },
            edgeIndex: neighbor.edgeIndex,
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
function findAllBoundaryWalls(placements: TriPlacement[]): TriWall[] {
  const cellToPlacement = buildCellToPlacementMap(placements);
  const walls: TriWall[] = [];
  
  placements.forEach((p, pIndex) => {
    for (const cell of p.cells) {
      const neighbors = getTriNeighbors(cell.row, cell.col);
      
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.row},${neighbor.col}`;
        const neighborPlacement = cellToPlacement.get(neighborKey);
        
        // Wall exists if neighbor is outside (undefined) or belongs to a different placement
        if (neighborPlacement === undefined || neighborPlacement !== pIndex) {
          walls.push({
            cell1: { row: cell.row, col: cell.col },
            edgeIndex: neighbor.edgeIndex,
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
 * Get the opposite edge index for a triangle wall.
 * For triangles, each edge has a unique opposite:
 * - Edge 0 (left) connects to neighbor's edge 1 (right)
 * - Edge 1 (right) connects to neighbor's edge 0 (left)
 * - Edge 2 (vertical) connects to neighbor's edge 2 (vertical)
 */
function getOppositeEdge(edgeIndex: number): number {
  if (edgeIndex === 0) return 1;  // left ↔ right
  if (edgeIndex === 1) return 0;  // right ↔ left
  return 2;  // vertical ↔ vertical
}

/**
 * Create a canonical wall key for deduplication.
 * Triangle walls are identified by cell + edge index.
 * Each wall is shared by two cells - normalize by using the cell with smaller coords.
 */
function triWallKey(wall: TriWall): string {
  const { row, col } = wall.cell1;
  const neighbors = getTriNeighbors(row, col);
  const neighbor = neighbors.find(n => n.edgeIndex === wall.edgeIndex);
  
  if (!neighbor) {
    return `${row},${col}:${wall.edgeIndex}`;
  }
  
  // Normalize: use the cell with smaller (row, col) numerically
  // Compare row first, then col if row values are equal
  const useCell1 = (row < neighbor.row) || (row === neighbor.row && col < neighbor.col);
  
  if (useCell1) {
    return `${row},${col}:${wall.edgeIndex}`;
  } else {
    // Get the opposite edge index (the edge from neighbor's perspective)
    const oppositeEdge = getOppositeEdge(wall.edgeIndex);
    return `${neighbor.row},${neighbor.col}:${oppositeEdge}`;
  }
}

/**
 * Generate a triangle maze from a tiling solution
 * 
 * @param placements - The placements from the SAT solver solution
 * @returns TriMazeResult with remaining walls
 */
export function generateTriMaze(placements: TriPlacement[]): TriMazeResult {
  if (placements.length === 0) {
    return { remainingWalls: [], spanningTreeEdges: [] };
  }
  
  // Step 1: Find all adjacency edges between placements
  const adjacencyEdges = findAdjacencyEdges(placements);
  
  // Step 2: Generate a random spanning tree
  const spanningTree = generateSpanningTree(placements.length, adjacencyEdges);
  
  // Step 3: For each spanning tree edge, open one random shared wall
  const wallsToOpen = new Set<string>();
  const spanningTreeEdges: Array<{ p1: number; p2: number; openedWall: TriWall }> = [];
  
  for (const edge of spanningTree) {
    if (edge.sharedWalls.length > 0) {
      // Pick a random wall to open
      const randomIndex = Math.floor(Math.random() * edge.sharedWalls.length);
      const openedWall = edge.sharedWalls[randomIndex];
      wallsToOpen.add(triWallKey(openedWall));
      
      spanningTreeEdges.push({
        p1: edge.placement1,
        p2: edge.placement2,
        openedWall,
      });
    }
  }
  
  // Step 4: Collect all walls and filter out opened ones
  const allWalls = findAllBoundaryWalls(placements);
  const wallsWithKeys = allWalls.map(w => ({ wall: w, key: triWallKey(w) }));
  
  // Deduplicate walls (each wall appears twice, once from each side)
  const seenWalls = new Set<string>();
  const remainingWalls: TriWall[] = [];
  
  for (const { wall, key } of wallsWithKeys) {
    if (!seenWalls.has(key) && !wallsToOpen.has(key)) {
      seenWalls.add(key);
      remainingWalls.push(wall);
    }
  }
  
  return { remainingWalls, spanningTreeEdges };
}
