/**
 * P3TiledGraph: A complete graph representation for P3 wallpaper maze in tiled space.
 * 
 * For P3, the structure is:
 * - Hexagons arranged in a multiplier × multiplier grid
 * - Each hexagon contains 3 rhombi (rotated 0°, 120°, 240°)
 * - Each rhombus contains length × length cells
 * - Cells are connected via the P3 wallpaper group wrapping rules
 */

import { getWallpaperGroup } from "./WallpaperGroups";
import type { Direction } from "./WallpaperGroups";

// Shear constants (same as P3RhombusRenderer)
const SHEAR_X = 0.5;  // cos(60°)
const SHEAR_Y = Math.sqrt(3) / 2;  // sin(60°)

const P3_WALLPAPER_GROUP = getWallpaperGroup("P3");

/**
 * A node in the P3 tiled graph
 */
export interface P3TiledNode {
  /** Unique ID for this node */
  id: number;
  
  /** Hexagon position in the grid */
  hexRow: number;
  hexCol: number;
  
  /** Rhombus index within hexagon (0, 1, or 2) */
  rhombusIdx: number;
  
  /** Cell position in fundamental domain */
  fundamentalRow: number;
  fundamentalCol: number;
  
  /** Visual position (screen coordinates) */
  x: number;
  y: number;
  
  /** Is this the root of its local copy? */
  isRoot: boolean;
  
  /** Parent node ID (null for root or if parent is outside bounds) */
  parentId: number | null;
  
  /** Which root this node connects to (index into roots array, or -1 for unconnected) */
  rootIndex: number;
}

/**
 * An edge in the P3 tiled graph
 */
export interface P3TiledEdge {
  fromId: number;
  toId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/**
 * The complete P3 tiled graph
 */
export interface P3TiledGraph {
  /** Length of fundamental domain (length × length) */
  length: number;
  
  /** Multiplier for hexagon grid */
  multiplier: number;
  
  /** Cell size for rendering */
  cellSize: number;
  
  /** All nodes in the graph */
  nodes: P3TiledNode[];
  
  /** All edges (parent-child relationships) */
  edges: P3TiledEdge[];
  
  /** Map from (hexRow, hexCol, rhombusIdx, row, col) to node ID */
  nodeAt: Map<string, number>;
  
  /** Root nodes */
  roots: P3TiledNode[];
  
  /** Root position in fundamental domain */
  rootRow: number;
  rootCol: number;
  
  /** Bounding box for rendering */
  width: number;
  height: number;
}

/**
 * Key for a P3 node position
 */
function nodeKey(hexRow: number, hexCol: number, rhombusIdx: number, row: number, col: number): string {
  return `${hexRow},${hexCol},${rhombusIdx},${row},${col}`;
}

/**
 * Get the center position of a cell in local rhombus coordinates
 */
function getCellCenterLocal(row: number, col: number, cellSize: number): { x: number; y: number } {
  const baseWidth = cellSize;
  const baseHeight = cellSize * SHEAR_Y;
  
  const localX = col * baseWidth + row * baseWidth * SHEAR_X;
  const localY = row * baseHeight;
  
  return {
    x: localX + baseWidth * 0.5 + baseWidth * SHEAR_X * 0.5,
    y: localY + baseHeight * 0.5,
  };
}

/**
 * Apply rotation transform around a pivot point
 */
function applyRotation(
  point: { x: number; y: number },
  angle: number,
  pivot: { x: number; y: number }
): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  
  return {
    x: dx * cos - dy * sin + pivot.x,
    y: dx * sin + dy * cos + pivot.y,
  };
}

/**
 * Get the pivot point for P3 rotation
 */
function getPivotPoint(length: number, cellSize: number): { x: number; y: number } {
  return { x: length * cellSize, y: 0 };
}

/**
 * Compute the translation for a hexagon in the tiled grid
 */
function getHexagonTranslation(
  hexRow: number,
  hexCol: number,
  length: number,
  cellSize: number,
): { x: number; y: number } {
  const rhombusWidth = length * cellSize * (1 + SHEAR_X);
  const rhombusHeight = length * cellSize * SHEAR_Y;
  
  const horizSpacing = rhombusWidth;
  const vertSpacing = 2 * rhombusHeight;
  
  const x = hexCol * horizSpacing;
  const y = hexRow * vertSpacing + (hexCol % 2) * rhombusHeight;
  
  return { x, y };
}

/**
 * Get the screen position of a P3 node
 */
function getNodePosition(
  hexRow: number,
  hexCol: number,
  rhombusIdx: number,
  fundamentalRow: number,
  fundamentalCol: number,
  length: number,
  cellSize: number
): { x: number; y: number } {
  const localCenter = getCellCenterLocal(fundamentalRow, fundamentalCol, cellSize);
  const pivot = getPivotPoint(length, cellSize);
  const rotationAngle = rhombusIdx * 120;
  const rotatedCenter = applyRotation(localCenter, rotationAngle, pivot);
  const hexTranslation = getHexagonTranslation(hexRow, hexCol, length, cellSize);
  
  return {
    x: rotatedCenter.x + hexTranslation.x,
    y: rotatedCenter.y + hexTranslation.y,
  };
}

/**
 * Get the adjacent neighbor for a P3 node in a given direction.
 * This uses the corrected algorithm that properly handles cross-hexagon neighbors.
 */
function getAdjacentNeighbor(
  hexRow: number,
  hexCol: number,
  rhombusIdx: number,
  fundamentalRow: number,
  fundamentalCol: number,
  direction: Direction,
  length: number,
): { hexRow: number; hexCol: number; rhombusIdx: number; fundamentalRow: number; fundamentalCol: number } {
  // Get the fundamental neighbor using wallpaper group wrapping
  const neighborFund = P3_WALLPAPER_GROUP.getWrappedNeighbor(fundamentalRow, fundamentalCol, direction, length);
  
  // Check if we're crossing a boundary
  const isNorthBoundary = direction === "N" && fundamentalRow === 0;
  const isSouthBoundary = direction === "S" && fundamentalRow === length - 1;
  const isEastBoundary = direction === "E" && fundamentalCol === length - 1;
  const isWestBoundary = direction === "W" && fundamentalCol === 0;
  
  let neighborHexRow = hexRow;
  let neighborHexCol = hexCol;
  let neighborRhombusIdx = rhombusIdx;
  
  if (isNorthBoundary || isEastBoundary) {
    // These boundaries connect to another rhombus within the SAME hexagon
    if (isNorthBoundary) {
      neighborRhombusIdx = (rhombusIdx + 1) % 3;
    } else { // isEastBoundary
      neighborRhombusIdx = (rhombusIdx + 2) % 3;
    }
  } else if (isSouthBoundary || isWestBoundary) {
    // These boundaries connect to an ADJACENT hexagon
    if (rhombusIdx === 0) {
      if (isSouthBoundary) {
        neighborHexRow = hexRow + 1;
        neighborRhombusIdx = 1;
      } else { // isWestBoundary
        neighborHexCol = hexCol - 1;
        if (hexCol % 2 === 1) {
          neighborHexRow = hexRow + 1;
        }
        neighborRhombusIdx = 2;
      }
    } else if (rhombusIdx === 1) {
      if (isSouthBoundary) {
        if (hexCol % 2 === 0) {
          neighborHexRow = hexRow - 1;
        }
        neighborHexCol = hexCol - 1;
        neighborRhombusIdx = 2;
      } else { // isWestBoundary
        neighborHexRow = hexRow - 1;
        neighborRhombusIdx = 0;
      }
    } else { // rhombusIdx === 2
      if (isSouthBoundary) {
        neighborHexCol = hexCol + 1;
        if (hexCol % 2 === 0) {
          neighborHexRow = hexRow - 1;
        }
        neighborRhombusIdx = 0;
      } else { // isWestBoundary
        if (hexCol % 2 === 1) {
          neighborHexRow = hexRow + 1;
        }
        neighborHexCol = hexCol + 1;
        neighborRhombusIdx = 1;
      }
    }
  }
  
  return {
    hexRow: neighborHexRow,
    hexCol: neighborHexCol,
    rhombusIdx: neighborRhombusIdx,
    fundamentalRow: neighborFund.row,
    fundamentalCol: neighborFund.col,
  };
}

/**
 * Build the P3 tiled graph
 */
export function buildP3TiledGraph(
  length: number,
  multiplier: number,
  cellSize: number,
  rootRow: number,
  rootCol: number,
  parentOf: Map<string, { row: number; col: number } | null>,
  vacantCells: Set<string> = new Set()
): P3TiledGraph {
  const nodes: P3TiledNode[] = [];
  const nodeAtMap = new Map<string, number>();
  const roots: P3TiledNode[] = [];
  
  // Step 1: Create all nodes
  for (let hexRow = 0; hexRow < multiplier; hexRow++) {
    for (let hexCol = 0; hexCol < multiplier; hexCol++) {
      for (let rhombusIdx = 0; rhombusIdx < 3; rhombusIdx++) {
        for (let row = 0; row < length; row++) {
          for (let col = 0; col < length; col++) {
            const fundamentalKey = `${row},${col}`;
            const isVacant = vacantCells.has(fundamentalKey);
            const isRoot = !isVacant && row === rootRow && col === rootCol;
            
            const pos = getNodePosition(hexRow, hexCol, rhombusIdx, row, col, length, cellSize);
            
            const nodeId = nodes.length;
            const node: P3TiledNode = {
              id: nodeId,
              hexRow,
              hexCol,
              rhombusIdx,
              fundamentalRow: row,
              fundamentalCol: col,
              x: pos.x,
              y: pos.y,
              isRoot,
              parentId: null,
              rootIndex: -1,
            };
            
            nodes.push(node);
            nodeAtMap.set(nodeKey(hexRow, hexCol, rhombusIdx, row, col), nodeId);
            
            if (isRoot) {
              roots.push(node);
            }
          }
        }
      }
    }
  }
  
  // Step 2: Connect parent-child relationships
  const directions: Direction[] = ["N", "S", "E", "W"];
  
  for (const node of nodes) {
    const fundamentalKey = `${node.fundamentalRow},${node.fundamentalCol}`;
    if (vacantCells.has(fundamentalKey)) continue;
    
    const parentCell = parentOf.get(fundamentalKey);
    if (!parentCell) continue; // This is the root
    
    // Find which direction the parent is in
    for (const dir of directions) {
      const neighbor = getAdjacentNeighbor(
        node.hexRow, node.hexCol, node.rhombusIdx,
        node.fundamentalRow, node.fundamentalCol,
        dir, length
      );
      
      // Check if this neighbor matches the parent's fundamental coordinates
      if (neighbor.fundamentalRow === parentCell.row && neighbor.fundamentalCol === parentCell.col) {
        // Check if neighbor is within bounds
        if (neighbor.hexRow >= 0 && neighbor.hexRow < multiplier &&
            neighbor.hexCol >= 0 && neighbor.hexCol < multiplier) {
          const parentKey = nodeKey(
            neighbor.hexRow, neighbor.hexCol, neighbor.rhombusIdx,
            neighbor.fundamentalRow, neighbor.fundamentalCol
          );
          const parentId = nodeAtMap.get(parentKey);
          if (parentId !== undefined) {
            node.parentId = parentId;
          }
        }
        break;
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
    
    const visited = new Set<number>();
    const queue: number[] = [rootNode.id];
    let queueIdx = 0;
    visited.add(rootNode.id);
    
    while (queueIdx < queue.length) {
      const currentId = queue[queueIdx++];
      
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
  
  // Step 5: Build edges list
  const edges: P3TiledEdge[] = [];
  for (const node of nodes) {
    if (node.parentId !== null) {
      const parent = nodes[node.parentId];
      edges.push({
        fromId: node.id,
        toId: node.parentId,
        fromX: node.x,
        fromY: node.y,
        toX: parent.x,
        toY: parent.y,
      });
    }
  }
  
  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  
  // Add padding
  const padding = cellSize;
  
  return {
    length,
    multiplier,
    cellSize,
    nodes,
    edges,
    nodeAt: nodeAtMap,
    roots,
    rootRow,
    rootCol,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding,
  };
}

/**
 * Golden ratio for evenly spreading colors
 */
const GOLDEN_RATIO = 0.618033988749895;

/**
 * Get a color for a root index
 */
export function getP3RootColor(rootIndex: number): string {
  if (rootIndex < 0) {
    return "#d0d0d0"; // Gray for unconnected
  }
  const hue = ((rootIndex * GOLDEN_RATIO) % 1) * 360;
  const saturation = 65;
  const lightness = 50;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * A pair of neighboring P3 nodes from different roots (a "cross-root" edge)
 */
export interface P3CrossRootNeighborPair {
  /** First node in the pair */
  node1: P3TiledNode;
  /** Second node in the pair */
  node2: P3TiledNode;
  /** The fundamental domain edge key (sorted "r1,c1-r2,c2") */
  fundamentalEdgeKey: string;
}

/**
 * Find all pairs of neighboring coordinates in the lifted P3 graph
 * where the two nodes belong to *different* roots.
 */
export function findP3CrossRootNeighborPairs(graph: P3TiledGraph): P3CrossRootNeighborPair[] {
  const pairs: P3CrossRootNeighborPair[] = [];
  const seenEdges = new Set<string>();
  
  const directions: Direction[] = ["N", "S", "E", "W"];
  
  for (const node of graph.nodes) {
    // Skip nodes that aren't connected to any root
    if (node.rootIndex < 0) continue;
    
    // Check all 4 directions for neighbors
    for (const dir of directions) {
      const neighbor = getAdjacentNeighbor(
        node.hexRow, node.hexCol, node.rhombusIdx,
        node.fundamentalRow, node.fundamentalCol,
        dir, graph.length
      );
      
      // Check if neighbor is within bounds
      if (neighbor.hexRow < 0 || neighbor.hexRow >= graph.multiplier ||
          neighbor.hexCol < 0 || neighbor.hexCol >= graph.multiplier) {
        continue;
      }
      
      // Look up the neighbor node
      const neighborKey = nodeKey(
        neighbor.hexRow, neighbor.hexCol, neighbor.rhombusIdx,
        neighbor.fundamentalRow, neighbor.fundamentalCol
      );
      const neighborId = graph.nodeAt.get(neighborKey);
      if (neighborId === undefined) continue;
      
      const neighborNode = graph.nodes[neighborId];
      
      // Skip if neighbor isn't connected to any root
      if (neighborNode.rootIndex < 0) continue;
      
      // Check if they have DIFFERENT roots
      if (node.rootIndex === neighborNode.rootIndex) continue;
      
      // Create a sorted edge key to avoid duplicates
      const edgeKey = node.id < neighborNode.id 
        ? `${node.id}-${neighborNode.id}` 
        : `${neighborNode.id}-${node.id}`;
      
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      
      // Compute the fundamental domain edge key (sorted by coordinates)
      const fundKey1 = `${node.fundamentalRow},${node.fundamentalCol}`;
      const fundKey2 = `${neighborNode.fundamentalRow},${neighborNode.fundamentalCol}`;
      const fundamentalEdgeKey = fundKey1 < fundKey2 
        ? `${fundKey1}-${fundKey2}` 
        : `${fundKey2}-${fundKey1}`;
      
      pairs.push({
        node1: node,
        node2: neighborNode,
        fundamentalEdgeKey,
      });
    }
  }
  
  return pairs;
}

/**
 * Represents an edge to add in the fundamental domain to open a boundary (P3 version)
 */
export interface P3OrbifoldEdgeToAdd {
  /** First cell in the fundamental domain */
  cell1: { row: number; col: number };
  /** Second cell in the fundamental domain */
  cell2: { row: number; col: number };
  /** The root index that will be kept */
  survivingRootIndex: number;
  /** The root index that will be absorbed */
  absorbedRootIndex: number;
}

/**
 * Given a P3 cross-root neighbor pair, compute the edge to add in the orbifold
 */
export function computeP3OrbifoldEdgeToAdd(pair: P3CrossRootNeighborPair): P3OrbifoldEdgeToAdd {
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
