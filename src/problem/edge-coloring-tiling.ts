/**
 * Edge Coloring Polyomino Tiling SAT Solver
 * 
 * Tiles a WxH region with a polyomino while matching edge colors.
 * Each edge of the tile has a color, and when tiles are placed adjacent to each other,
 * the shared edges must have matching colors.
 * 
 * Uses CaDiCaL for SAT solving.
 */

import type { SATSolver } from "../solvers/types";
import type { Coord, Placement } from "./polyomino-tiling";

/** Edge direction for a cell */
export type EdgeDirection = "top" | "right" | "bottom" | "left";

/** Edge color assignment for a tile */
export interface EdgeColor {
  /** Cell index within the tile */
  cellIndex: number;
  /** Direction of the edge */
  direction: EdgeDirection;
  /** Color (0-based index) */
  color: number;
}

/** Tile definition with edge colors */
export interface ColoredTile {
  /** Cells that make up the tile (boolean grid) */
  cells: boolean[][];
  /** Colors for each edge (external edges only have meaning at tile boundaries) */
  edgeColors: EdgeColor[];
  /** Number of distinct colors used */
  numColors: number;
}

/** Result of edge coloring tiling attempt */
export interface EdgeColoringResult {
  satisfiable: boolean;
  /** Placements that are used in the solution (if SAT) */
  placements?: EdgeColoringPlacement[];
  /** Stats about the SAT problem */
  stats: {
    numVariables: number;
    numClauses: number;
    numPlacements: number;
  };
}

/** A placement with color information */
export interface EdgeColoringPlacement extends Placement {
  /** Colors at each edge after transform is applied */
  edgeColors: Map<string, number>; // key: "row,col,direction" -> color
}

/**
 * Convert boolean[][] grid to array of coordinates of filled cells,
 * normalized to (0,0) at top-left of bounding box.
 */
function gridToCoords(cells: boolean[][]): Coord[] {
  const coords: Coord[] = [];
  
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        coords.push({ row, col });
      }
    }
  }
  
  // Normalize to top-left
  if (coords.length === 0) return [];
  
  let minRow = Infinity, minCol = Infinity;
  for (const c of coords) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  return coords.map(c => ({
    row: c.row - minRow,
    col: c.col - minCol,
  }));
}

/**
 * Get the opposite direction
 */
function oppositeDirection(dir: EdgeDirection): EdgeDirection {
  switch (dir) {
    case "top": return "bottom";
    case "bottom": return "top";
    case "left": return "right";
    case "right": return "left";
  }
}

/**
 * Get the neighbor coordinate for a given direction
 */
function getNeighborCoord(row: number, col: number, dir: EdgeDirection): { row: number; col: number } {
  switch (dir) {
    case "top": return { row: row - 1, col };
    case "bottom": return { row: row + 1, col };
    case "left": return { row, col: col - 1 };
    case "right": return { row, col: col + 1 };
  }
}

/**
 * Rotate a coordinate 90° clockwise around origin
 */
function rotateCoord90(row: number, col: number): { row: number; col: number } {
  return { row: col, col: -row };
}

/**
 * Flip a coordinate horizontally around origin
 */
function flipCoordH(row: number, col: number): { row: number; col: number } {
  return { row, col: -col };
}

/**
 * Rotate an edge direction 90° clockwise
 */
function rotateDirection90(dir: EdgeDirection): EdgeDirection {
  switch (dir) {
    case "top": return "right";
    case "right": return "bottom";
    case "bottom": return "left";
    case "left": return "top";
  }
}

/**
 * Flip an edge direction horizontally
 */
function flipDirectionH(dir: EdgeDirection): EdgeDirection {
  switch (dir) {
    case "left": return "right";
    case "right": return "left";
    default: return dir; // top and bottom unchanged
  }
}

/**
 * Normalize coordinates to start at (0,0)
 */
function normalizeCoords(coords: { row: number; col: number }[]): { coords: { row: number; col: number }[]; offset: { row: number; col: number } } {
  if (coords.length === 0) return { coords: [], offset: { row: 0, col: 0 } };
  
  let minRow = Infinity, minCol = Infinity;
  for (const c of coords) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  return {
    coords: coords.map(c => ({ row: c.row - minRow, col: c.col - minCol })),
    offset: { row: minRow, col: minCol }
  };
}

/** Transform index encoding: 0-3 are rotations, 4-7 are flipped + rotations */
interface TransformResult {
  coords: Coord[];
  // Map from original cell coord to transformed coord
  coordMap: Map<string, { row: number; col: number }>;
  // Direction mapping: original direction -> transformed direction
  directionMap: (dir: EdgeDirection) => EdgeDirection;
}

/**
 * Apply a transform to coordinates and track the mapping
 */
function applyTransform(baseCoords: Coord[], transformIndex: number): TransformResult {
  const flip = transformIndex >= 4;
  const rotations = transformIndex % 4;
  
  let currentCoords = baseCoords.map(c => ({ row: c.row, col: c.col }));
  let directionTransform: (dir: EdgeDirection) => EdgeDirection = (d) => d;
  
  // First flip if needed
  if (flip) {
    currentCoords = currentCoords.map(c => flipCoordH(c.row, c.col));
    const prevTransform = directionTransform;
    directionTransform = (d) => flipDirectionH(prevTransform(d));
  }
  
  // Then rotate
  for (let i = 0; i < rotations; i++) {
    currentCoords = currentCoords.map(c => rotateCoord90(c.row, c.col));
    const prevTransform = directionTransform;
    directionTransform = (d) => rotateDirection90(prevTransform(d));
  }
  
  // Normalize
  const normalized = normalizeCoords(currentCoords);
  
  // Build coordinate map
  const coordMap = new Map<string, { row: number; col: number }>();
  for (let i = 0; i < baseCoords.length; i++) {
    coordMap.set(`${baseCoords[i].row},${baseCoords[i].col}`, normalized.coords[i]);
  }
  
  return {
    coords: normalized.coords,
    coordMap,
    directionMap: directionTransform,
  };
}

/**
 * Check if two coordinate sets are equal
 */
function coordSetsEqual(a: Coord[], b: Coord[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map(c => `${c.row},${c.col}`));
  const setB = new Set(b.map(c => `${c.row},${c.col}`));
  if (setA.size !== setB.size) return false;
  for (const key of setA) {
    if (!setB.has(key)) return false;
  }
  return true;
}

/**
 * Generate all unique placements for the colored tile
 */
function generateColoredPlacements(
  tile: ColoredTile,
  tilingWidth: number,
  tilingHeight: number
): EdgeColoringPlacement[] {
  const baseCoords = gridToCoords(tile.cells);
  if (baseCoords.length === 0) return [];
  
  // Build edge color lookup for base tile
  // Key: "row,col,direction" -> color
  const baseEdgeColors = new Map<string, number>();
  for (const ec of tile.edgeColors) {
    // Find the actual coordinate of the cell
    let idx = 0;
    for (let row = 0; row < tile.cells.length; row++) {
      for (let col = 0; col < tile.cells[row].length; col++) {
        if (tile.cells[row][col]) {
          if (idx === ec.cellIndex) {
            // Normalize the coordinate
            const normalizedCoords = gridToCoords(tile.cells);
            const normalizedCoord = normalizedCoords[idx];
            baseEdgeColors.set(`${normalizedCoord.row},${normalizedCoord.col},${ec.direction}`, ec.color);
          }
          idx++;
        }
      }
    }
  }
  
  // Generate all 8 transforms and deduplicate
  const seenTransforms: { coords: Coord[]; transformIndex: number }[] = [];
  
  for (let t = 0; t < 8; t++) {
    const result = applyTransform(baseCoords, t);
    
    // Check if this transform is unique
    let isDuplicate = false;
    for (const seen of seenTransforms) {
      if (coordSetsEqual(result.coords, seen.coords)) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      seenTransforms.push({ coords: result.coords, transformIndex: t });
    }
  }
  
  // Get max bounding box
  let maxWidth = 0, maxHeight = 0;
  for (const { coords } of seenTransforms) {
    for (const c of coords) {
      maxWidth = Math.max(maxWidth, c.col + 1);
      maxHeight = Math.max(maxHeight, c.row + 1);
    }
  }
  
  const placements: EdgeColoringPlacement[] = [];
  let placementId = 0;
  
  for (const { coords: transformedCoords, transformIndex } of seenTransforms) {
    const transformResult = applyTransform(baseCoords, transformIndex);
    
    // Try all translations
    for (let offsetRow = -maxHeight + 1; offsetRow < tilingHeight; offsetRow++) {
      for (let offsetCol = -maxWidth + 1; offsetCol < tilingWidth; offsetCol++) {
        // Translate the coordinates
        const translatedCells = transformedCoords.map(c => ({
          row: c.row + offsetRow,
          col: c.col + offsetCol,
        }));
        
        // Check if this placement covers at least one cell in the inner grid
        let coversInnerGrid = false;
        for (const cell of translatedCells) {
          if (cell.row >= 0 && cell.row < tilingHeight &&
              cell.col >= 0 && cell.col < tilingWidth) {
            coversInnerGrid = true;
            break;
          }
        }
        
        if (coversInnerGrid) {
          // Build transformed edge colors
          const edgeColors = new Map<string, number>();
          
          for (const [key, color] of baseEdgeColors) {
            const [rowStr, colStr, dirStr] = key.split(",");
            const baseRow = parseInt(rowStr);
            const baseCol = parseInt(colStr);
            const baseDir = dirStr as EdgeDirection;
            
            // Get transformed coordinate
            const transformedCoord = transformResult.coordMap.get(`${baseRow},${baseCol}`);
            if (transformedCoord) {
              const transformedDir = transformResult.directionMap(baseDir);
              const finalRow = transformedCoord.row + offsetRow;
              const finalCol = transformedCoord.col + offsetCol;
              edgeColors.set(`${finalRow},${finalCol},${transformedDir}`, color);
            }
          }
          
          placements.push({
            id: placementId++,
            offset: { row: offsetRow, col: offsetCol },
            transformIndex,
            cells: translatedCells,
            edgeColors,
          });
        }
      }
    }
  }
  
  return placements;
}

/**
 * Solve the edge coloring tiling problem using a SAT solver.
 * 
 * Variables:
 * - One boolean variable per placement (is this placement used?)
 * 
 * Constraints:
 * 1. Coverage: Each cell in the inner (W,H) grid must be covered by exactly one placement.
 * 2. Non-overlap: Each cell can be covered by at most one placement.
 * 3. Edge color matching: Adjacent tiles must have matching colors on shared edges.
 */
export function solveEdgeColoringTiling(
  tile: ColoredTile,
  tilingWidth: number,
  tilingHeight: number,
  solver: SATSolver,
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void
): EdgeColoringResult {
  // Validate inputs
  if (tilingWidth < 1 || tilingHeight < 1 || !Number.isInteger(tilingWidth) || !Number.isInteger(tilingHeight)) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  const allPlacements = generateColoredPlacements(tile, tilingWidth, tilingHeight);
  
  if (allPlacements.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Create SAT variables for each placement
  const placementVars = new Map<number, number>();
  for (const p of allPlacements) {
    const varNum = solver.newVariable();
    placementVars.set(p.id, varNum);
  }
  
  // Find the outer bounds (including all possible tile extensions)
  let outerMinRow = 0, outerMaxRow = tilingHeight - 1;
  let outerMinCol = 0, outerMaxCol = tilingWidth - 1;
  for (const p of allPlacements) {
    for (const cell of p.cells) {
      outerMinRow = Math.min(outerMinRow, cell.row);
      outerMaxRow = Math.max(outerMaxRow, cell.row);
      outerMinCol = Math.min(outerMinCol, cell.col);
      outerMaxCol = Math.max(outerMaxCol, cell.col);
    }
  }
  
  // Build index: for each coordinate, which placements cover it?
  const cellToPlacements = new Map<string, number[]>();
  for (const p of allPlacements) {
    for (const cell of p.cells) {
      const key = `${cell.row},${cell.col}`;
      if (!cellToPlacements.has(key)) {
        cellToPlacements.set(key, []);
      }
      cellToPlacements.get(key)!.push(p.id);
    }
  }
  
  // CONSTRAINT 1: Coverage - each cell in inner grid must be covered
  for (let row = 0; row < tilingHeight; row++) {
    for (let col = 0; col < tilingWidth; col++) {
      const key = `${row},${col}`;
      const coveringPlacements = cellToPlacements.get(key) || [];
      
      if (coveringPlacements.length === 0) {
        // No placement can cover this cell - UNSAT
        solver.addClause([]);
      } else {
        // At least one of these placements must be active
        const literals = coveringPlacements.map(pid => placementVars.get(pid)!);
        solver.addClause(literals);
      }
    }
  }
  
  // CONSTRAINT 2: Non-overlap - each cell can be covered by at most one placement
  for (let row = outerMinRow; row <= outerMaxRow; row++) {
    for (let col = outerMinCol; col <= outerMaxCol; col++) {
      const key = `${row},${col}`;
      const coveringPlacements = cellToPlacements.get(key) || [];
      
      // Pairwise: at most one
      for (let i = 0; i < coveringPlacements.length; i++) {
        for (let j = i + 1; j < coveringPlacements.length; j++) {
          const var1 = placementVars.get(coveringPlacements[i])!;
          const var2 = placementVars.get(coveringPlacements[j])!;
          solver.addClause([-var1, -var2]);
        }
      }
    }
  }
  
  // CONSTRAINT 3: Edge color matching
  // For each pair of placements that could be adjacent, if both are used,
  // their shared edges must have matching colors.
  // Build an index of edges: key = "row,col,direction" -> list of (placementId, color)
  const edgeIndex = new Map<string, { placementId: number; color: number }[]>();
  
  for (const p of allPlacements) {
    for (const [edgeKey, color] of p.edgeColors) {
      if (!edgeIndex.has(edgeKey)) {
        edgeIndex.set(edgeKey, []);
      }
      edgeIndex.get(edgeKey)!.push({ placementId: p.id, color });
    }
  }
  
  // For each edge in the tiling region, find all placements with that edge
  // and add constraints that adjacent placements must have matching colors
  const directions: EdgeDirection[] = ["top", "right", "bottom", "left"];
  
  for (let row = outerMinRow; row <= outerMaxRow; row++) {
    for (let col = outerMinCol; col <= outerMaxCol; col++) {
      for (const dir of directions) {
        const edgeKey = `${row},${col},${dir}`;
        const edgePlacements = edgeIndex.get(edgeKey) || [];
        
        // Get the neighbor's opposite edge
        const neighbor = getNeighborCoord(row, col, dir);
        const oppDir = oppositeDirection(dir);
        const neighborEdgeKey = `${neighbor.row},${neighbor.col},${oppDir}`;
        const neighborPlacements = edgeIndex.get(neighborEdgeKey) || [];
        
        // For each pair of placements (one with this edge, one with neighbor edge),
        // if they have different colors, they cannot both be selected
        for (const { placementId: pid1, color: c1 } of edgePlacements) {
          for (const { placementId: pid2, color: c2 } of neighborPlacements) {
            if (pid1 !== pid2 && c1 !== c2) {
              // These two placements cannot both be selected
              const var1 = placementVars.get(pid1)!;
              const var2 = placementVars.get(pid2)!;
              solver.addClause([-var1, -var2]);
            }
          }
        }
      }
    }
  }
  
  const numVars = solver.getVariableCount();
  const numClauses = solver.getClauseCount();
  
  // Report stats before solving
  if (onStatsReady) {
    onStatsReady({ numVars, numClauses });
  }
  
  // Solve
  const result = solver.solve();
  
  if (!result.satisfiable) {
    return {
      satisfiable: false,
      stats: { numVariables: numVars, numClauses: numClauses, numPlacements: allPlacements.length },
    };
  }
  
  // Extract solution: which placements are used?
  const usedPlacements: EdgeColoringPlacement[] = [];
  for (const p of allPlacements) {
    const varNum = placementVars.get(p.id)!;
    if (result.assignment.get(varNum)) {
      usedPlacements.push(p);
    }
  }
  
  return {
    satisfiable: true,
    placements: usedPlacements,
    stats: { numVariables: numVars, numClauses: numClauses, numPlacements: allPlacements.length },
  };
}
