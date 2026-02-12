/**
 * TiledGraph: A complete graph representation of a wallpaper maze in tiled space.
 * 
 * This module constructs the full graph (length² × multiplier² nodes) from the
 * fundamental domain solution. Once constructed, all rendering and coloring
 * operations work on this graph without needing to know about the wallpaper group.
 */

import type {
  WallpaperGroupName,
  Direction,
} from "./WallpaperGroups";
import {
  ALL_DIRECTIONS,
  DIRECTION_DELTA,
  getWallpaperGroup,
} from "./WallpaperGroups";

/**
 * A node in the tiled graph
 */
export interface TiledNode {
  /** Unique ID for this node in the tiled graph */
  id: number;
  
  /** Visual position in tiled space */
  absRow: number;
  absCol: number;
  
  /** Which copy this node belongs to */
  copyRow: number;
  copyCol: number;
  
  /** Type of copy (0 = unrotated, 1 = 180° for P2, etc.) */
  type: number;
  
  /** Coordinates in the fundamental domain */
  fundamentalRow: number;
  fundamentalCol: number;
  
  /** Is this the root of its local copy? */
  isRoot: boolean;
  
  /** Parent direction in the fundamental domain (null for root) */
  parentDirection: Direction | null;
  
  /** Visual parent direction in tiled space (transformed) */
  visualParentDirection: Direction | null;
  
  /** Parent node ID in the tiled graph (null for root, or if parent is outside bounds) */
  parentId: number | null;
  
  /** Which root this node connects to (index into roots array, or -1 for unconnected) */
  rootIndex: number;
}

/**
 * An edge in the tiled graph
 */
export interface TiledEdge {
  fromId: number;
  toId: number;
  fromAbsRow: number;
  fromAbsCol: number;
  toAbsRow: number;
  toAbsCol: number;
  /** True if this is a parent-child edge (passage in maze), false if wall */
  isPassage: boolean;
}

/**
 * A wall segment for maze rendering
 */
export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The complete tiled graph
 */
export interface TiledGraph {
  /** Length of fundamental domain (length × length) */
  length: number;
  
  /** Multiplier (multiplier × multiplier copies) */
  multiplier: number;
  
  /** Total size in each dimension */
  totalSize: number;
  
  /** Wallpaper group name */
  wallpaperGroupName: WallpaperGroupName;
  
  /** All nodes in the graph */
  nodes: TiledNode[];
  
  /** All edges (parent-child relationships only) */
  edges: TiledEdge[];
  
  /** Map from (absRow, absCol) to node ID */
  nodeAt: Map<string, number>;
  
  /** Root nodes (one per copy) */
  roots: TiledNode[];
  
  /** Root row in fundamental domain */
  rootRow: number;
  
  /** Root col in fundamental domain */
  rootCol: number;
}

/**
 * Key for a position in tiled space
 */
function posKey(absRow: number, absCol: number): string {
  return `${absRow},${absCol}`;
}

/**
 * Build the tiled graph from a fundamental domain solution
 */
export function buildTiledGraph(
  length: number,
  multiplier: number,
  wallpaperGroupName: WallpaperGroupName,
  rootRow: number,
  rootCol: number,
  parentOf: Map<string, { row: number; col: number } | null>,
  vacantCells: Set<string> = new Set()
): TiledGraph {
  const wpg = getWallpaperGroup(wallpaperGroupName);
  const totalSize = length * multiplier;
  
  const nodes: TiledNode[] = [];
  const nodeAt = new Map<string, number>();
  const roots: TiledNode[] = [];
  
  // Step 1: Create all nodes (including vacant ones - they're needed for grid structure)
  for (let copyRow = 0; copyRow < multiplier; copyRow++) {
    for (let copyCol = 0; copyCol < multiplier; copyCol++) {
      const type = wpg.getType(copyRow, copyCol);
      
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          // Transform position to visual space
          const transformed = wpg.transformPosition(row, col, length, type);
          const absRow = copyRow * length + transformed.row;
          const absCol = copyCol * length + transformed.col;
          
          // Check if this cell is vacant
          const fundamentalKey = `${row},${col}`;
          const isVacant = vacantCells.has(fundamentalKey);
          
          // Get parent info from fundamental domain (vacant cells have no parent)
          const parentCell = isVacant ? null : parentOf.get(fundamentalKey);
          const isRoot = !isVacant && row === rootRow && col === rootCol;
          
          // Determine parent direction in fundamental domain
          let parentDirection: Direction | null = null;
          if (parentCell) {
            // Find which direction the parent is in
            for (const dir of ALL_DIRECTIONS) {
              const neighbor = wpg.getWrappedNeighbor(row, col, dir, length);
              if (neighbor.row === parentCell.row && neighbor.col === parentCell.col) {
                parentDirection = dir;
                break;
              }
            }
          }
          
          // Transform direction to visual space
          const visualParentDirection = parentDirection
            ? wpg.transformDirection(parentDirection, type)
            : null;
          
          const nodeId = nodes.length;
          const node: TiledNode = {
            id: nodeId,
            absRow,
            absCol,
            copyRow,
            copyCol,
            type,
            fundamentalRow: row,
            fundamentalCol: col,
            isRoot,
            parentDirection,
            visualParentDirection,
            parentId: null, // Will be set in step 2
            rootIndex: -1, // Will be set in step 3
          };
          
          nodes.push(node);
          nodeAt.set(posKey(absRow, absCol), nodeId);
          
          if (isRoot) {
            roots.push(node);
          }
        }
      }
    }
  }
  
  // Step 2: Connect parent-child relationships using visual directions
  for (const node of nodes) {
    if (node.visualParentDirection) {
      const delta = DIRECTION_DELTA[node.visualParentDirection];
      const parentAbsRow = node.absRow + delta.dRow;
      const parentAbsCol = node.absCol + delta.dCol;
      
      // Only connect if parent is within bounds (no wrapping in tiled space)
      if (parentAbsRow >= 0 && parentAbsRow < totalSize &&
          parentAbsCol >= 0 && parentAbsCol < totalSize) {
        const parentKey = posKey(parentAbsRow, parentAbsCol);
        const parentId = nodeAt.get(parentKey);
        if (parentId !== undefined) {
          node.parentId = parentId;
        }
      }
    }
  }
  
  // Step 3: Build children index for efficient BFS
  const childrenOf = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      const children = childrenOf.get(node.parentId) || [];
      children.push(node.id);
      childrenOf.set(node.parentId, children);
    }
  }
  
  // Step 4: Compute root connections using BFS from each root
  for (let rootIdx = 0; rootIdx < roots.length; rootIdx++) {
    const rootNode = roots[rootIdx];
    rootNode.rootIndex = rootIdx;
    
    // BFS following child edges
    const visited = new Set<number>();
    const queue: number[] = [rootNode.id];
    let queueIdx = 0; // Use index instead of shift() for O(1) dequeue
    visited.add(rootNode.id);
    
    while (queueIdx < queue.length) {
      const currentId = queue[queueIdx++];
      
      // Find all children using the pre-built index
      const children = childrenOf.get(currentId) || [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          nodes[childId].rootIndex = rootIdx;
          queue.push(childId);
        }
      }
    }
  }
  
  // Step 5: Build edges list (parent-child only, for graph view)
  const edges: TiledEdge[] = [];
  for (const node of nodes) {
    if (node.parentId !== null) {
      const parent = nodes[node.parentId];
      edges.push({
        fromId: node.id,
        toId: node.parentId,
        fromAbsRow: node.absRow,
        fromAbsCol: node.absCol,
        toAbsRow: parent.absRow,
        toAbsCol: parent.absCol,
        isPassage: true,
      });
    }
  }
  
  return {
    length,
    multiplier,
    totalSize,
    wallpaperGroupName,
    nodes,
    edges,
    nodeAt,
    roots,
    rootRow,
    rootCol,
  };
}

/**
 * Edge key type for orbifold (fundamental domain) edges
 */
export type OrbifoldEdgeKey = string;

/**
 * Utility to create a canonical edge key (smaller coords first)
 */
export function makeOrbifoldEdgeKey(r1: number, c1: number, r2: number, c2: number): OrbifoldEdgeKey {
  const key1 = `${r1},${c1}`;
  const key2 = `${r2},${c2}`;
  return key1 < key2 ? `${key1}-${key2}` : `${key2}-${key1}`;
}

/**
 * Parse an edge key back to coordinates
 */
export function parseOrbifoldEdgeKey(key: OrbifoldEdgeKey): { r1: number; c1: number; r2: number; c2: number } {
  const [part1, part2] = key.split('-');
  const [r1, c1] = part1.split(',').map(Number);
  const [r2, c2] = part2.split(',').map(Number);
  return { r1, c1, r2, c2 };
}

/**
 * Build the tiled graph from an undirected edge set in the fundamental domain.
 * 
 * This is the new preferred method that:
 * 1. Creates all nodes in the tiled space
 * 2. Lifts the orbifold edge set to the tiled space
 * 3. Uses BFS from each root in the lifted graph to compute root indices
 * 
 * This allows adding/removing edges without the complications of an arborescence.
 */
export function buildTiledGraphFromEdgeSet(
  length: number,
  multiplier: number,
  wallpaperGroupName: WallpaperGroupName,
  rootRow: number,
  rootCol: number,
  orbifoldEdgeSet: Set<OrbifoldEdgeKey>,
  vacantCells: Set<string> = new Set()
): TiledGraph {
  const wpg = getWallpaperGroup(wallpaperGroupName);
  const totalSize = length * multiplier;
  
  const nodes: TiledNode[] = [];
  const nodeAt = new Map<string, number>();
  const roots: TiledNode[] = [];
  
  // Step 1: Create all nodes
  for (let copyRow = 0; copyRow < multiplier; copyRow++) {
    for (let copyCol = 0; copyCol < multiplier; copyCol++) {
      const type = wpg.getType(copyRow, copyCol);
      
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          // Transform position to visual space
          const transformed = wpg.transformPosition(row, col, length, type);
          const absRow = copyRow * length + transformed.row;
          const absCol = copyCol * length + transformed.col;
          
          // Check if this cell is vacant
          const fundamentalKey = `${row},${col}`;
          const isVacant = vacantCells.has(fundamentalKey);
          const isRoot = !isVacant && row === rootRow && col === rootCol;
          
          const nodeId = nodes.length;
          const node: TiledNode = {
            id: nodeId,
            absRow,
            absCol,
            copyRow,
            copyCol,
            type,
            fundamentalRow: row,
            fundamentalCol: col,
            isRoot,
            parentDirection: null, // Not used in edge-set mode
            visualParentDirection: null, // Not used in edge-set mode
            parentId: null, // Will be set during BFS
            rootIndex: -1, // Will be set during BFS
          };
          
          nodes.push(node);
          nodeAt.set(posKey(absRow, absCol), nodeId);
          
          if (isRoot) {
            roots.push(node);
          }
        }
      }
    }
  }
  
  // Step 2: Build adjacency lists in the LIFTED graph based on the orbifold edge set
  // For each pair of visually adjacent nodes in the lifted graph, check if the corresponding
  // orbifold edge exists in the edge set.
  // 
  // IMPORTANT: Due to rotational symmetries, cross-copy visual neighbors may have fundamental
  // coordinates that form INTERIOR edges (not wrapping edges). For example, in P2:
  // - Visual (1,3) in copy (0,0) has fundamental (1,3)
  // - Visual (1,4) in copy (0,1) type=1 has fundamental (2,3)
  // - (1,3) and (2,3) are adjacent in fundamental domain - an INTERIOR edge!
  // 
  // To keep copies disconnected, we must only allow interior edges between nodes in the SAME copy.
  // Cross-copy edges should only be allowed for wrapping edges (which we've excluded from the tree).
  const adjacency = new Map<number, number[]>();
  
  for (const node of nodes) {
    const neighbors: number[] = [];
    
    for (const dir of ALL_DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const neighborAbsRow = node.absRow + delta.dRow;
      const neighborAbsCol = node.absCol + delta.dCol;
      
      // Skip if out of bounds
      if (neighborAbsRow < 0 || neighborAbsRow >= totalSize ||
          neighborAbsCol < 0 || neighborAbsCol >= totalSize) {
        continue;
      }
      
      const neighborKey = posKey(neighborAbsRow, neighborAbsCol);
      const neighborId = nodeAt.get(neighborKey);
      if (neighborId === undefined) continue;
      
      const neighbor = nodes[neighborId];
      
      // Check if nodes are in the same copy
      const sameCopy = node.copyRow === neighbor.copyRow && node.copyCol === neighbor.copyCol;
      
      // Check if the fundamental coordinates are adjacent (interior edge) vs wrapping edge
      const fundRowDiff = Math.abs(node.fundamentalRow - neighbor.fundamentalRow);
      const fundColDiff = Math.abs(node.fundamentalCol - neighbor.fundamentalCol);
      const isInteriorEdge = (fundRowDiff + fundColDiff) === 1;
      
      // Interior edges only allowed within same copy
      // Wrapping edges (now excluded from tree) would be cross-copy
      if (!sameCopy && isInteriorEdge) {
        continue; // Skip interior edges between different copies
      }
      
      // Check if the orbifold edge exists between the fundamental coordinates
      const orbifoldEdgeKey = makeOrbifoldEdgeKey(
        node.fundamentalRow, node.fundamentalCol,
        neighbor.fundamentalRow, neighbor.fundamentalCol
      );
      
      if (orbifoldEdgeSet.has(orbifoldEdgeKey)) {
        neighbors.push(neighborId);
      }
    }
    
    adjacency.set(node.id, neighbors);
  }
  
  // Step 3: BFS from each root to compute root indices and parent relationships
  // Lowest root index wins when there's a tie
  for (let rootIdx = 0; rootIdx < roots.length; rootIdx++) {
    const rootNode = roots[rootIdx];
    
    // Skip if this root is already claimed by a lower-indexed root
    if (rootNode.rootIndex >= 0 && rootNode.rootIndex < rootIdx) {
      continue;
    }
    
    rootNode.rootIndex = rootIdx;
    
    const visited = new Set<number>();
    const queue: number[] = [rootNode.id];
    let queueIdx = 0;
    visited.add(rootNode.id);
    
    while (queueIdx < queue.length) {
      const currentId = queue[queueIdx++];
      
      const neighbors = adjacency.get(currentId) || [];
      for (const neighborId of neighbors) {
        const neighbor = nodes[neighborId];
        
        // Skip if already claimed by this or a lower root
        if (neighbor.rootIndex >= 0 && neighbor.rootIndex <= rootIdx) {
          continue;
        }
        
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          neighbor.rootIndex = rootIdx;
          neighbor.parentId = currentId;
          queue.push(neighborId);
        }
      }
    }
  }
  
  // Step 4: Build edges list for rendering
  const edges: TiledEdge[] = [];
  for (const node of nodes) {
    if (node.parentId !== null) {
      const parent = nodes[node.parentId];
      edges.push({
        fromId: node.id,
        toId: node.parentId,
        fromAbsRow: node.absRow,
        fromAbsCol: node.absCol,
        toAbsRow: parent.absRow,
        toAbsCol: parent.absCol,
        isPassage: true,
      });
    }
  }
  
  return {
    length,
    multiplier,
    totalSize,
    wallpaperGroupName,
    nodes,
    edges,
    nodeAt,
    roots,
    rootRow,
    rootCol,
  };
}

/**
 * Convert a parentOf map (arborescence) to an undirected edge set
 */
export function parentOfToEdgeSet(
  length: number,
  _wallpaperGroupName: WallpaperGroupName,
  parentOf: Map<string, { row: number; col: number } | null>
): Set<OrbifoldEdgeKey> {
  const edgeSet = new Set<OrbifoldEdgeKey>();
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const key = `${row},${col}`;
      const parent = parentOf.get(key);
      
      if (parent) {
        const edgeKey = makeOrbifoldEdgeKey(row, col, parent.row, parent.col);
        edgeSet.add(edgeKey);
      }
    }
  }
  
  return edgeSet;
}

/**
 * Convert an undirected edge set back to a parentOf map (arborescence) using BFS from root.
 * This is used for backwards compatibility with P3TiledGraph.
 */
export function edgeSetToParentOf(
  length: number,
  _wallpaperGroupName: WallpaperGroupName,
  rootRow: number,
  rootCol: number,
  orbifoldEdgeSet: Set<OrbifoldEdgeKey>,
  vacantCells: Set<string> = new Set()
): Map<string, { row: number; col: number } | null> {
  const parentOf = new Map<string, { row: number; col: number } | null>();
  
  // Build adjacency list from edge set
  const adjacency = new Map<string, string[]>();
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const key = `${row},${col}`;
      adjacency.set(key, []);
    }
  }
  
  for (const edgeKey of orbifoldEdgeSet) {
    const { r1, c1, r2, c2 } = parseOrbifoldEdgeKey(edgeKey);
    const key1 = `${r1},${c1}`;
    const key2 = `${r2},${c2}`;
    
    adjacency.get(key1)?.push(key2);
    adjacency.get(key2)?.push(key1);
  }
  
  // BFS from root to build parentOf
  const rootKey = `${rootRow},${rootCol}`;
  parentOf.set(rootKey, null);
  
  const visited = new Set<string>();
  visited.add(rootKey);
  const queue = [rootKey];
  let queueIdx = 0;
  
  while (queueIdx < queue.length) {
    const currentKey = queue[queueIdx++];
    const [currentRow, currentCol] = currentKey.split(',').map(Number);
    
    const neighbors = adjacency.get(currentKey) || [];
    for (const neighborKey of neighbors) {
      if (!visited.has(neighborKey) && !vacantCells.has(neighborKey)) {
        visited.add(neighborKey);
        parentOf.set(neighborKey, { row: currentRow, col: currentCol });
        queue.push(neighborKey);
      }
    }
  }
  
  return parentOf;
}

/**
 * Golden ratio for evenly spreading colors
 */
const GOLDEN_RATIO = 0.618033988749895;

/**
 * Get a color for a root index
 */
export function getRootColor(rootIndex: number): string {
  if (rootIndex < 0) {
    return "#d0d0d0"; // Gray for unconnected
  }
  // Use golden ratio to spread colors evenly
  const hue = ((rootIndex * GOLDEN_RATIO) % 1) * 360;
  const saturation = 65;
  const lightness = 50;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Compute wall segments for maze rendering.
 * Returns walls for edges where there is NO parent-child relationship.
 */
export function computeWallSegments(
  graph: TiledGraph,
  cellSize: number
): WallSegment[] {
  const walls: WallSegment[] = [];
  
  // For each node, check all 4 directions
  // Add a wall if:
  // 1. The neighbor exists (is within bounds)
  // 2. Neither this node is parent of neighbor, nor neighbor is parent of this node
  
  const processedEdges = new Set<string>();
  
  for (const node of graph.nodes) {
    const cx = node.absCol * cellSize + cellSize / 2;
    const cy = node.absRow * cellSize + cellSize / 2;
    
    for (const dir of ALL_DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const neighborAbsRow = node.absRow + delta.dRow;
      const neighborAbsCol = node.absCol + delta.dCol;
      
      // Skip if neighbor is out of bounds
      if (neighborAbsRow < 0 || neighborAbsRow >= graph.totalSize ||
          neighborAbsCol < 0 || neighborAbsCol >= graph.totalSize) {
        continue;
      }
      
      // Create edge key (sorted to avoid duplicates)
      const edgeKey = [
        posKey(node.absRow, node.absCol),
        posKey(neighborAbsRow, neighborAbsCol)
      ].sort().join("-");
      
      if (processedEdges.has(edgeKey)) continue;
      processedEdges.add(edgeKey);
      
      // Check if there's a parent-child relationship
      const neighborKey = posKey(neighborAbsRow, neighborAbsCol);
      const neighborId = graph.nodeAt.get(neighborKey);
      if (neighborId === undefined) continue;
      
      const neighbor = graph.nodes[neighborId];
      
      // Is this a passage? (one is parent of the other)
      const isPassage = node.parentId === neighborId || neighbor.parentId === node.id;
      
      if (!isPassage) {
        // Add wall segment
        const nx = neighborAbsCol * cellSize + cellSize / 2;
        const ny = neighborAbsRow * cellSize + cellSize / 2;
        
        // Wall is perpendicular to the line connecting centers, at the midpoint
        const midX = (cx + nx) / 2;
        const midY = (cy + ny) / 2;
        const halfWall = cellSize / 2;
        
        if (dir === "N" || dir === "S") {
          // Horizontal wall
          walls.push({
            x1: midX - halfWall,
            y1: midY,
            x2: midX + halfWall,
            y2: midY,
          });
        } else {
          // Vertical wall
          walls.push({
            x1: midX,
            y1: midY - halfWall,
            x2: midX,
            y2: midY + halfWall,
          });
        }
      }
    }
  }
  
  return walls;
}

/**
 * Find all nodes that are "the same" as a given node (same fundamental domain coords)
 */
export function findEquivalentNodes(graph: TiledGraph, node: TiledNode): TiledNode[] {
  return graph.nodes.filter(
    n => n.fundamentalRow === node.fundamentalRow &&
         n.fundamentalCol === node.fundamentalCol
  );
}

/**
 * A pair of neighboring nodes from different roots (a "cross-root" edge)
 */
export interface CrossRootNeighborPair {
  /** First node in the pair */
  node1: TiledNode;
  /** Second node in the pair */
  node2: TiledNode;
  /** The fundamental domain edge key (sorted "r1,c1-r2,c2") */
  fundamentalEdgeKey: string;
}

/**
 * Find all pairs of neighboring coordinates in the lifted graph (tiled space)
 * where the two nodes belong to *different* roots.
 * 
 * This is used for the "open boundary" feature - we can select a pair and
 * add an edge between them in the orbifold to merge two regions.
 */
export function findCrossRootNeighborPairs(graph: TiledGraph): CrossRootNeighborPair[] {
  const pairs: CrossRootNeighborPair[] = [];
  const seenEdges = new Set<string>();
  
  for (const node of graph.nodes) {
    // Skip nodes that aren't connected to any root
    if (node.rootIndex < 0) continue;
    
    // Check all 4 directions for neighbors
    for (const dir of ALL_DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const neighborAbsRow = node.absRow + delta.dRow;
      const neighborAbsCol = node.absCol + delta.dCol;
      
      // Skip if neighbor is out of bounds (we only consider edges within the lifted graph)
      if (neighborAbsRow < 0 || neighborAbsRow >= graph.totalSize ||
          neighborAbsCol < 0 || neighborAbsCol >= graph.totalSize) {
        continue;
      }
      
      // Look up the neighbor
      const neighborKey = posKey(neighborAbsRow, neighborAbsCol);
      const neighborId = graph.nodeAt.get(neighborKey);
      if (neighborId === undefined) continue;
      
      const neighbor = graph.nodes[neighborId];
      
      // Skip if neighbor isn't connected to any root
      if (neighbor.rootIndex < 0) continue;
      
      // Check if they have DIFFERENT roots
      if (node.rootIndex === neighbor.rootIndex) continue;
      
      // Create a sorted edge key to avoid duplicates
      const edgeKey = node.id < neighbor.id 
        ? `${node.id}-${neighbor.id}` 
        : `${neighbor.id}-${node.id}`;
      
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      
      // Compute the fundamental domain edge key (sorted by coordinates)
      const fundKey1 = `${node.fundamentalRow},${node.fundamentalCol}`;
      const fundKey2 = `${neighbor.fundamentalRow},${neighbor.fundamentalCol}`;
      const fundamentalEdgeKey = fundKey1 < fundKey2 
        ? `${fundKey1}-${fundKey2}` 
        : `${fundKey2}-${fundKey1}`;
      
      pairs.push({
        node1: node,
        node2: neighbor,
        fundamentalEdgeKey,
      });
    }
  }
  
  return pairs;
}

/**
 * Represents an edge to add in the fundamental domain to open a boundary
 */
export interface OrbifoldEdgeToAdd {
  /** First cell in the fundamental domain */
  cell1: { row: number; col: number };
  /** Second cell in the fundamental domain */
  cell2: { row: number; col: number };
  /** The root index that will be kept (other roots connected by this edge will merge into this one) */
  survivingRootIndex: number;
  /** The root index that will be absorbed */
  absorbedRootIndex: number;
}

/**
 * Given a cross-root neighbor pair, compute the edge to add in the orbifold (fundamental domain)
 * and which root should "win" (absorb the other).
 * 
 * By convention, the lower root index survives.
 */
export function computeOrbifoldEdgeToAdd(pair: CrossRootNeighborPair): OrbifoldEdgeToAdd {
  const { node1, node2 } = pair;
  
  // The lower root index survives
  const survivingRootIndex = Math.min(node1.rootIndex, node2.rootIndex);
  const absorbedRootIndex = Math.max(node1.rootIndex, node2.rootIndex);
  
  return {
    cell1: { row: node1.fundamentalRow, col: node1.fundamentalCol },
    cell2: { row: node2.fundamentalRow, col: node2.fundamentalCol },
    survivingRootIndex,
    absorbedRootIndex,
  };
}
