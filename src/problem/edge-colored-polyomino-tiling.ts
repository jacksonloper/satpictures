/**
 * Edge-Colored Polyomino Tiling SAT Solver
 * 
 * Extends the basic polyomino tiling to support edge coloring.
 * Each edge of a polyomino cell can have one of up to 4 colors.
 * The SAT constraints ensure that:
 * 1. Each cell in the tiling grid is covered exactly once
 * 2. Adjacent cells (from the same or different tiles) have matching edge colors
 */

import type { SATSolver } from "../solvers/types";
import type { Placement } from "./polyomino-tiling";
import { gridToCoords, generateAllPlacements } from "./polyomino-tiling";

/** Edge direction in a polyomino cell */
export type EdgeDirection = "top" | "right" | "bottom" | "left";

/** Edge color (0-3, with 0 meaning "no color" or default) */
export type EdgeColor = 0 | 1 | 2 | 3;

/** Edge colors for a single cell */
export interface CellEdgeColors {
  top: EdgeColor;
  right: EdgeColor;
  bottom: EdgeColor;
  left: EdgeColor;
}

/** A cell with its edge colors */
export interface CellWithEdges {
  row: number;
  col: number;
  edges: CellEdgeColors;
}

/** Edge-colored polyomino tile definition */
export interface EdgeColoredTile {
  cells: boolean[][];
  /** Edge colors for filled cells, keyed by "row,col" */
  edgeColors: Map<string, CellEdgeColors>;
}

/** Placement with edge information */
export interface EdgeColoredPlacement extends Placement {
  /** Edge colors for each cell in the placement (absolute coordinates) */
  cellEdges: CellWithEdges[];
}

/** Result of edge-colored tiling attempt */
export interface EdgeColoredTilingResult {
  satisfiable: boolean;
  /** Placements that are used in the solution (if SAT) */
  placements?: EdgeColoredPlacement[];
  /** Stats about the SAT problem */
  stats: {
    numVariables: number;
    numClauses: number;
    numPlacements: number;
  };
  /** Global edge colors computed from the solution */
  edgeColors?: Map<string, EdgeColor>;
  /** Count of placements used for each tile type (when multiple tiles) */
  tileTypeCounts?: number[];
}

/**
 * Default edge colors (all zeros - no coloring)
 */
export function defaultEdgeColors(): CellEdgeColors {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * Get a key for an edge between two adjacent cells.
 * For horizontal edges (between cells vertically adjacent), use the top cell's bottom edge.
 * For vertical edges (between cells horizontally adjacent), use the left cell's right edge.
 * 
 * Edge key format: "row1,col1-row2,col2" where (row1,col1) < (row2,col2) lexicographically
 */
export function getEdgeKey(row1: number, col1: number, row2: number, col2: number): string {
  if (row1 < row2 || (row1 === row2 && col1 < col2)) {
    return `${row1},${col1}-${row2},${col2}`;
  } else {
    return `${row2},${col2}-${row1},${col1}`;
  }
}

/**
 * Rotate edge colors 90° clockwise.
 */
function rotateEdgeColors90(edges: CellEdgeColors): CellEdgeColors {
  return {
    top: edges.left,
    right: edges.top,
    bottom: edges.right,
    left: edges.bottom,
  };
}

/**
 * Flip edge colors horizontally (mirror across vertical axis).
 */
function flipEdgeColorsH(edges: CellEdgeColors): CellEdgeColors {
  return {
    top: edges.top,
    right: edges.left,
    bottom: edges.bottom,
    left: edges.right,
  };
}

/**
 * Apply a transform to edge colors.
 * @param edges Original edge colors
 * @param transformIndex 0-7: 0-3 are rotations, 4-7 are flipped + rotations
 */
function transformEdgeColors(edges: CellEdgeColors, transformIndex: number): CellEdgeColors {
  const rotations = transformIndex % 4;
  const isFlipped = transformIndex >= 4;
  
  let result = { ...edges };
  
  // Apply flip first (before rotations)
  if (isFlipped) {
    result = flipEdgeColorsH(result);
  }
  
  // Apply rotations
  for (let i = 0; i < rotations; i++) {
    result = rotateEdgeColors90(result);
  }
  
  return result;
}

/**
 * Rotate a coordinate 90° clockwise.
 */
function rotateCoord90(row: number, col: number): { row: number; col: number } {
  // (row, col) -> (col, -row)
  return { row: col, col: -row };
}

/**
 * Flip a coordinate horizontally.
 */
function flipCoordH(row: number, col: number): { row: number; col: number } {
  return { row, col: -col };
}

/**
 * Transform coordinates with a given transform index.
 * Returns unnormalized coordinates.
 */
function transformCoord(
  row: number,
  col: number,
  transformIndex: number
): { row: number; col: number } {
  const rotations = transformIndex % 4;
  const isFlipped = transformIndex >= 4;
  
  let r = row, c = col;
  
  // Apply flip first
  if (isFlipped) {
    const flipped = flipCoordH(r, c);
    r = flipped.row;
    c = flipped.col;
  }
  
  // Apply rotations
  for (let i = 0; i < rotations; i++) {
    const rotated = rotateCoord90(r, c);
    r = rotated.row;
    c = rotated.col;
  }
  
  return { row: r, col: c };
}

/**
 * Convert a tile with edge colors to normalized coordinates with transformed edge colors.
 */
export function getTileWithTransformedEdges(
  tile: EdgeColoredTile,
  transformIndex: number
): CellWithEdges[] {
  const coords = gridToCoords(tile.cells);
  if (coords.length === 0) return [];
  
  // Transform each cell coordinate and its edge colors
  const transformedCells: { row: number; col: number; edges: CellEdgeColors }[] = [];
  
  for (const coord of coords) {
    const key = `${coord.row},${coord.col}`;
    const originalEdges = tile.edgeColors.get(key) || defaultEdgeColors();
    
    const transformedCoord = transformCoord(coord.row, coord.col, transformIndex);
    const transformedEdges = transformEdgeColors(originalEdges, transformIndex);
    
    transformedCells.push({
      row: transformedCoord.row,
      col: transformedCoord.col,
      edges: transformedEdges,
    });
  }
  
  // Normalize to start at (0,0)
  let minRow = Infinity, minCol = Infinity;
  for (const c of transformedCells) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  return transformedCells.map(c => ({
    row: c.row - minRow,
    col: c.col - minCol,
    edges: c.edges,
  }));
}

/**
 * Generate all edge-colored placements for a tile.
 */
export function generateEdgeColoredPlacements(
  tile: EdgeColoredTile,
  tilingWidth: number,
  tilingHeight: number
): EdgeColoredPlacement[] {
  // First generate regular placements
  const coords = gridToCoords(tile.cells);
  const basePlacements = generateAllPlacements(coords, tilingWidth, tilingHeight);
  
  // Get all 8 transforms of the tile with edges
  const transformedTiles: Map<number, CellWithEdges[]> = new Map();
  for (let t = 0; t < 8; t++) {
    transformedTiles.set(t, getTileWithTransformedEdges(tile, t));
  }
  
  // Augment each placement with edge information
  const edgeColoredPlacements: EdgeColoredPlacement[] = [];
  
  for (const placement of basePlacements) {
    const transformedCells = transformedTiles.get(placement.transformIndex);
    if (!transformedCells) continue;
    
    // Translate transformed cells to placement position
    const cellEdges: CellWithEdges[] = transformedCells.map(tc => ({
      row: tc.row + placement.offset.row,
      col: tc.col + placement.offset.col,
      edges: tc.edges,
    }));
    
    edgeColoredPlacements.push({
      ...placement,
      cellEdges,
    });
  }
  
  return edgeColoredPlacements;
}

/**
 * Solve edge-colored polyomino tiling using SAT.
 * 
 * Variables:
 * - One boolean per placement (is this placement used?)
 * - One variable per (edge, color) pair for each grid edge
 * 
 * Constraints:
 * 1. Coverage: Each inner grid cell must be covered by exactly one placement
 * 2. Non-overlap: Each cell (including outer) can be covered by at most one placement
 * 3. Edge color implication: If a placement is used, its edges must have the specified colors
 * 4. Edge color uniqueness: Each edge has exactly one color (from the colors that appear)
 * 5. Edge color matching: Internal edges between tiles must have matching colors on both sides
 */
export function solveEdgeColoredPolyominoTiling(
  tiles: EdgeColoredTile[],
  tilingWidth: number,
  tilingHeight: number,
  solver: SATSolver,
  onStatsReady?: (stats: { numVars: number; numClauses: number }) => void
): EdgeColoredTilingResult {
  // Validate inputs
  if (tilingWidth < 1 || tilingHeight < 1) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Filter out empty tiles
  const nonEmptyTiles = tiles.filter(t => 
    t.cells.some(row => row.some(c => c))
  );
  
  if (nonEmptyTiles.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Generate all edge-colored placements for each tile
  let allPlacements: EdgeColoredPlacement[] = [];
  const placementsByTileType: number[][] = []; // placementsByTileType[tileIndex] = [placementId, ...]
  let placementId = 0;
  
  for (const tile of nonEmptyTiles) {
    const tilePlacements = generateEdgeColoredPlacements(tile, tilingWidth, tilingHeight);
    const tileTypePlacementIds: number[] = [];
    for (const p of tilePlacements) {
      p.id = placementId++;
      tileTypePlacementIds.push(p.id);
    }
    placementsByTileType.push(tileTypePlacementIds);
    allPlacements = allPlacements.concat(tilePlacements);
  }
  
  if (allPlacements.length === 0) {
    return {
      satisfiable: false,
      stats: { numVariables: 0, numClauses: 0, numPlacements: 0 },
    };
  }
  
  // Calculate bounding box for outer grid
  let maxBBWidth = 0, maxBBHeight = 0;
  for (const p of allPlacements) {
    for (const cell of p.cells) {
      maxBBWidth = Math.max(maxBBWidth, Math.abs(cell.col) + 1);
      maxBBHeight = Math.max(maxBBHeight, Math.abs(cell.row) + 1);
    }
  }
  
  // Create placement variables
  const placementVars: Map<number, number> = new Map();
  for (const p of allPlacements) {
    const varNum = solver.newVariable();
    placementVars.set(p.id, varNum);
  }
  
  // Build cell-to-placements index
  const cellToPlacements: Map<string, number[]> = new Map();
  for (const p of allPlacements) {
    for (const cell of p.cells) {
      const key = `${cell.row},${cell.col}`;
      if (!cellToPlacements.has(key)) {
        cellToPlacements.set(key, []);
      }
      cellToPlacements.get(key)!.push(p.id);
    }
  }
  
  // Collect all edges and their possible colors from placements
  // edgeToPlacementColors: Maps edge key to list of (placementId, color) pairs
  const edgeToPlacementColors: Map<string, { placementId: number; color: EdgeColor }[]> = new Map();
  
  for (const p of allPlacements) {
    const cellSet = new Set(p.cells.map(c => `${c.row},${c.col}`));
    
    for (const cellEdge of p.cellEdges) {
      const { row, col, edges } = cellEdge;
      
      // Top edge (shared with cell above)
      const topNeighborKey = `${row - 1},${col}`;
      if (!cellSet.has(topNeighborKey)) {
        // This is an external edge of the placement
        const edgeKey = getEdgeKey(row - 1, col, row, col);
        if (!edgeToPlacementColors.has(edgeKey)) {
          edgeToPlacementColors.set(edgeKey, []);
        }
        edgeToPlacementColors.get(edgeKey)!.push({ placementId: p.id, color: edges.top });
      }
      
      // Right edge (shared with cell to the right)
      const rightNeighborKey = `${row},${col + 1}`;
      if (!cellSet.has(rightNeighborKey)) {
        const edgeKey = getEdgeKey(row, col, row, col + 1);
        if (!edgeToPlacementColors.has(edgeKey)) {
          edgeToPlacementColors.set(edgeKey, []);
        }
        edgeToPlacementColors.get(edgeKey)!.push({ placementId: p.id, color: edges.right });
      }
      
      // Bottom edge (shared with cell below)
      const bottomNeighborKey = `${row + 1},${col}`;
      if (!cellSet.has(bottomNeighborKey)) {
        const edgeKey = getEdgeKey(row, col, row + 1, col);
        if (!edgeToPlacementColors.has(edgeKey)) {
          edgeToPlacementColors.set(edgeKey, []);
        }
        edgeToPlacementColors.get(edgeKey)!.push({ placementId: p.id, color: edges.bottom });
      }
      
      // Left edge (shared with cell to the left)
      const leftNeighborKey = `${row},${col - 1}`;
      if (!cellSet.has(leftNeighborKey)) {
        const edgeKey = getEdgeKey(row, col - 1, row, col);
        if (!edgeToPlacementColors.has(edgeKey)) {
          edgeToPlacementColors.set(edgeKey, []);
        }
        edgeToPlacementColors.get(edgeKey)!.push({ placementId: p.id, color: edges.left });
      }
    }
  }
  
  // Create edge color variables
  // For each edge, create variables for colors 0-3
  // edgeColorVars[edgeKey][color] = variable number
  const edgeColorVars: Map<string, Map<EdgeColor, number>> = new Map();
  
  for (const edgeKey of edgeToPlacementColors.keys()) {
    const colorVars = new Map<EdgeColor, number>();
    for (let color = 0; color < 4; color++) {
      colorVars.set(color as EdgeColor, solver.newVariable());
    }
    edgeColorVars.set(edgeKey, colorVars);
  }
  
  // CONSTRAINT 1: Coverage - each inner cell must be covered
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
  const outerMinRow = -maxBBHeight;
  const outerMaxRow = tilingHeight + maxBBHeight - 1;
  const outerMinCol = -maxBBWidth;
  const outerMaxCol = tilingWidth + maxBBWidth - 1;
  
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
  
  // CONSTRAINT 3: Edge color implication
  // If placement is used, it implies specific edge colors
  for (const [edgeKey, placementColors] of edgeToPlacementColors) {
    const colorVars = edgeColorVars.get(edgeKey)!;
    
    for (const { placementId, color } of placementColors) {
      const placementVar = placementVars.get(placementId)!;
      const colorVar = colorVars.get(color)!;
      // placement => edge has this color: ¬placement ∨ colorVar
      solver.addClause([-placementVar, colorVar]);
    }
  }
  
  // CONSTRAINT 4: Each edge has exactly one color
  for (const colorVars of edgeColorVars.values()) {
    const allColorVars = Array.from(colorVars.values());
    
    // At least one color
    solver.addClause(allColorVars);
    
    // At most one color (pairwise)
    for (let i = 0; i < allColorVars.length; i++) {
      for (let j = i + 1; j < allColorVars.length; j++) {
        solver.addClause([-allColorVars[i], -allColorVars[j]]);
      }
    }
  }
  
  // CONSTRAINT 5: Edge matching
  // If two placements share an edge, their edge colors must match
  // This is already handled by constraints 3 & 4: if two placements share an edge
  // and assign different colors, the "exactly one color" constraint will fail
  
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
  
  // Extract solution
  const usedPlacements: EdgeColoredPlacement[] = [];
  const usedPlacementIds = new Set<number>();
  for (const p of allPlacements) {
    const varNum = placementVars.get(p.id)!;
    if (result.assignment.get(varNum)) {
      usedPlacements.push(p);
      usedPlacementIds.add(p.id);
    }
  }
  
  // Count how many placements of each tile type were used
  const tileTypeCounts = placementsByTileType.map(tileTypePlacements => 
    tileTypePlacements.filter(pid => usedPlacementIds.has(pid)).length
  );
  
  // Extract edge colors from solution
  const solvedEdgeColors = new Map<string, EdgeColor>();
  for (const [edgeKey, colorVars] of edgeColorVars) {
    for (const [color, varNum] of colorVars) {
      if (result.assignment.get(varNum)) {
        solvedEdgeColors.set(edgeKey, color);
        break;
      }
    }
  }
  
  return {
    satisfiable: true,
    placements: usedPlacements,
    stats: { numVariables: numVars, numClauses: numClauses, numPlacements: allPlacements.length },
    edgeColors: solvedEdgeColors,
    tileTypeCounts,
  };
}

/**
 * Create an EdgeColoredTile from a boolean grid with default (no) edge colors.
 */
export function createEdgeColoredTile(cells: boolean[][]): EdgeColoredTile {
  const edgeColors = new Map<string, CellEdgeColors>();
  
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < (cells[row]?.length || 0); col++) {
      if (cells[row][col]) {
        edgeColors.set(`${row},${col}`, defaultEdgeColors());
      }
    }
  }
  
  return { cells, edgeColors };
}

/**
 * Update edge color for a specific cell and direction.
 */
export function setEdgeColor(
  tile: EdgeColoredTile,
  row: number,
  col: number,
  direction: EdgeDirection,
  color: EdgeColor
): EdgeColoredTile {
  const key = `${row},${col}`;
  const existingColors = tile.edgeColors.get(key) || defaultEdgeColors();
  
  const newColors: CellEdgeColors = {
    ...existingColors,
    [direction]: color,
  };
  
  const newEdgeColorsMap = new Map(tile.edgeColors);
  newEdgeColorsMap.set(key, newColors);
  
  return {
    cells: tile.cells,
    edgeColors: newEdgeColorsMap,
  };
}

/**
 * Get edge color for a specific cell and direction.
 */
export function getEdgeColor(
  tile: EdgeColoredTile,
  row: number,
  col: number,
  direction: EdgeDirection
): EdgeColor {
  const key = `${row},${col}`;
  const colors = tile.edgeColors.get(key);
  if (!colors) return 0;
  return colors[direction];
}
