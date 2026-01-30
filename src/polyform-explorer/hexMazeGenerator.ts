/**
 * Hex Maze Generator for Polyhex Tilings
 * 
 * Given a solution (set of hex placements), this module:
 * 1. Builds an adjacency graph where nodes = placements, edges = shared walls
 * 2. Generates a random spanning tree
 * 3. Opens one random wall for each spanning tree edge
 * 4. Returns the remaining walls (both interior and exterior walls that were not opened)
 */

import type { HexPlacement } from "../problem/polyhex-tiling";

/** Axial coordinate for hex */
interface AxialCoord {
  q: number;
  r: number;
}

/** A hex wall between two cells or at the boundary */
export interface HexWall {
  /** First cell coordinate (axial) */
  cell1: AxialCoord;
  /** Edge index (0-5) indicating which edge of the hexagon */
  edgeIndex: number;
}

/** An edge in the adjacency graph (shared wall between two placements) */
interface AdjacencyEdge {
  /** Index of first placement */
  placement1: number;
  /** Index of second placement */
  placement2: number;
  /** All shared walls between these two placements */
  sharedWalls: HexWall[];
}

/** Result of hex maze generation */
export interface HexMazeResult {
  /** Walls that remain after opening spanning tree paths */
  remainingWalls: HexWall[];
  /** Edges in the spanning tree (for debugging/visualization) */
  spanningTreeEdges: Array<{ p1: number; p2: number; openedWall: HexWall }>;
}

/**
 * Get the 6 axial neighbors with their corresponding edge indices.
 * Edge index tells which edge of the current hex faces that neighbor.
 * 
 * For pointy-top hex (matching HexTilingViewer):
 *   edge 0: SW neighbor, edge 1: W neighbor, edge 2: NW neighbor
 *   edge 3: NE neighbor, edge 4: E neighbor, edge 5: SE neighbor
 */
function getAxialNeighbors(q: number, r: number): Array<{ q: number; r: number; edgeIndex: number }> {
  return [
    { q: q + 1, r: r - 1, edgeIndex: 3 }, // Upper-right (NE) → edge 3
    { q: q + 1, r: r, edgeIndex: 4 },     // Right (E) → edge 4
    { q: q, r: r + 1, edgeIndex: 5 },     // Lower-right (SE) → edge 5
    { q: q - 1, r: r + 1, edgeIndex: 0 }, // Lower-left (SW) → edge 0
    { q: q - 1, r: r, edgeIndex: 1 },     // Left (W) → edge 1
    { q: q, r: r - 1, edgeIndex: 2 },     // Upper-left (NW) → edge 2
  ];
}

/**
 * Build a map from cell coordinate to placement index
 */
function buildCellToPlacementMap(placements: HexPlacement[]): Map<string, number> {
  const map = new Map<string, number>();
  placements.forEach((p, index) => {
    for (const cell of p.cells) {
      map.set(`${cell.q},${cell.r}`, index);
    }
  });
  return map;
}

/**
 * Find all adjacency edges between placements (shared walls)
 */
function findAdjacencyEdges(placements: HexPlacement[]): AdjacencyEdge[] {
  const cellToPlacement = buildCellToPlacementMap(placements);
  const edgeMap = new Map<string, AdjacencyEdge>();
  
  placements.forEach((p, pIndex) => {
    for (const cell of p.cells) {
      const neighbors = getAxialNeighbors(cell.q, cell.r);
      
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.q},${neighbor.r}`;
        const neighborPlacement = cellToPlacement.get(neighborKey);
        
        // Check if neighbor belongs to a different placement
        if (neighborPlacement !== undefined && neighborPlacement !== pIndex) {
          // Create a canonical edge key (smaller index first)
          const p1 = Math.min(pIndex, neighborPlacement);
          const p2 = Math.max(pIndex, neighborPlacement);
          const edgeKey = `${p1}-${p2}`;
          
          // The wall is defined from the current cell's perspective
          const wall: HexWall = {
            cell1: { q: cell.q, r: cell.r },
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
function findAllBoundaryWalls(placements: HexPlacement[]): HexWall[] {
  const cellToPlacement = buildCellToPlacementMap(placements);
  const walls: HexWall[] = [];
  
  placements.forEach((p, pIndex) => {
    for (const cell of p.cells) {
      const neighbors = getAxialNeighbors(cell.q, cell.r);
      
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.q},${neighbor.r}`;
        const neighborPlacement = cellToPlacement.get(neighborKey);
        
        // Wall exists if neighbor is outside (undefined) or belongs to a different placement
        if (neighborPlacement === undefined || neighborPlacement !== pIndex) {
          walls.push({
            cell1: { q: cell.q, r: cell.r },
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
 * Create a canonical wall key for deduplication.
 * Hex walls are identified by cell + edge index.
 * Each wall is shared by two cells - normalize by using the cell with smaller coords.
 */
function hexWallKey(wall: HexWall): string {
  const { q, r } = wall.cell1;
  const neighbors = getAxialNeighbors(q, r);
  const neighbor = neighbors.find(n => n.edgeIndex === wall.edgeIndex);
  
  if (!neighbor) {
    return `${q},${r}:${wall.edgeIndex}`;
  }
  
  // Normalize: use the cell with smaller (q, r) numerically
  // Compare q first, then r if q values are equal
  const useCell1 = (q < neighbor.q) || (q === neighbor.q && r < neighbor.r);
  
  if (useCell1) {
    return `${q},${r}:${wall.edgeIndex}`;
  } else {
    // Get the opposite edge index (the edge from neighbor's perspective)
    // Edges are opposite: 0↔3, 1↔4, 2↔5
    const oppositeEdge = (wall.edgeIndex + 3) % 6;
    return `${neighbor.q},${neighbor.r}:${oppositeEdge}`;
  }
}

/**
 * Generate a hex maze from a tiling solution
 * 
 * @param placements - The placements from the SAT solver solution
 * @returns HexMazeResult with remaining walls
 */
export function generateHexMaze(placements: HexPlacement[]): HexMazeResult {
  if (placements.length === 0) {
    return { remainingWalls: [], spanningTreeEdges: [] };
  }
  
  // Step 1: Find all adjacency edges between placements
  const adjacencyEdges = findAdjacencyEdges(placements);
  
  // Step 2: Generate a random spanning tree
  const spanningTree = generateSpanningTree(placements.length, adjacencyEdges);
  
  // Step 3: For each spanning tree edge, open one random shared wall
  const wallsToOpen = new Set<string>();
  const spanningTreeEdges: Array<{ p1: number; p2: number; openedWall: HexWall }> = [];
  
  for (const edge of spanningTree) {
    if (edge.sharedWalls.length > 0) {
      // Pick a random wall to open
      const randomIndex = Math.floor(Math.random() * edge.sharedWalls.length);
      const openedWall = edge.sharedWalls[randomIndex];
      wallsToOpen.add(hexWallKey(openedWall));
      
      spanningTreeEdges.push({
        p1: edge.placement1,
        p2: edge.placement2,
        openedWall,
      });
    }
  }
  
  // Step 4: Collect all walls and filter out opened ones
  const allWalls = findAllBoundaryWalls(placements);
  const wallsWithKeys = allWalls.map(w => ({ wall: w, key: hexWallKey(w) }));
  
  // Deduplicate walls (each wall appears twice, once from each side)
  const seenWalls = new Set<string>();
  const remainingWalls: HexWall[] = [];
  
  for (const { wall, key } of wallsWithKeys) {
    if (!seenWalls.has(key) && !wallsToOpen.has(key)) {
      seenWalls.add(key);
      remainingWalls.push(wall);
    }
  }
  
  return { remainingWalls, spanningTreeEdges };
}
