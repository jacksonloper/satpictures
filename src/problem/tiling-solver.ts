/**
 * Polyform Tiling SAT Solver
 * 
 * Uses CaDiCaL to attempt to tile a grid of size (W,H) by placing
 * rotations/translations/flips of a user-drawn polyform tile.
 * 
 * Variables: is the tile placed at this translation/transformation?
 * Constraints:
 *   1. Non-overlap: For every point in extended (W+2A,H+2B) grid, 
 *      all pairs of placements covering it cannot both be on.
 *   2. Coverage: For every point in central (W,H) grid, 
 *      at least one placement covering it must be on.
 */

import type { SATSolver } from "../solvers/types";
import { CadicalFormulaBuilder } from "../solvers/cadical-solver";

/** Polyform type determines grid geometry and number of transforms */
export type PolyformType = "polyomino" | "polyhex" | "polyiamond";

/** A single cell position in the grid */
export interface Cell {
  row: number;
  col: number;
}

/** A placement represents a tile at a specific position with a specific transform */
export interface Placement {
  /** Index of the transform (0-7 for polyomino, 0-11 for hex/tri) */
  transformIndex: number;
  /** Translation offset */
  offsetRow: number;
  offsetCol: number;
  /** Cells covered by this placement in the target grid */
  coveredCells: Cell[];
}

/** Result of the tiling solver */
export interface TilingSolverResult {
  satisfiable: boolean;
  /** Placements that are selected (if satisfiable) */
  placements: Placement[];
  /** Statistics */
  stats: {
    numVars: number;
    numClauses: number;
    numPlacements: number;
    numTransforms: number;
  };
}

/**
 * Extract filled cells from a boolean grid
 */
function getFilledCells(cells: boolean[][]): Cell[] {
  const result: Cell[] = [];
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < (cells[row]?.length ?? 0); col++) {
      if (cells[row][col]) {
        result.push({ row, col });
      }
    }
  }
  return result;
}

/**
 * Normalize cells to have minimum row/col at 0
 */
function normalizeCells(cells: Cell[]): Cell[] {
  if (cells.length === 0) return [];
  
  let minRow = Infinity, minCol = Infinity;
  for (const cell of cells) {
    minRow = Math.min(minRow, cell.row);
    minCol = Math.min(minCol, cell.col);
  }
  
  return cells.map(c => ({ row: c.row - minRow, col: c.col - minCol }));
}

/**
 * Get bounding box dimensions of cells
 */
function getBoundingBox(cells: Cell[]): { width: number; height: number } {
  if (cells.length === 0) return { width: 0, height: 0 };
  
  let maxRow = -Infinity, maxCol = -Infinity;
  for (const cell of cells) {
    maxRow = Math.max(maxRow, cell.row);
    maxCol = Math.max(maxCol, cell.col);
  }
  
  return { width: maxCol + 1, height: maxRow + 1 };
}

/**
 * Convert cells to a string key for deduplication
 */
function cellsToKey(cells: Cell[]): string {
  const normalized = normalizeCells(cells);
  normalized.sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
  return normalized.map(c => `${c.row},${c.col}`).join(';');
}

// ============ POLYOMINO TRANSFORMS ============

/**
 * Rotate polyomino cells 90° clockwise
 */
function rotatePolyomino90(cells: Cell[]): Cell[] {
  // (row, col) -> (col, -row) then normalize
  const rotated = cells.map(c => ({ row: c.col, col: -c.row }));
  return normalizeCells(rotated);
}

/**
 * Flip polyomino cells horizontally
 */
function flipPolyominoH(cells: Cell[]): Cell[] {
  const flipped = cells.map(c => ({ row: c.row, col: -c.col }));
  return normalizeCells(flipped);
}

/**
 * Generate all 8 unique transforms for a polyomino (4 rotations × 2 reflections)
 */
function getPolyominoTransforms(originalCells: Cell[]): Cell[][] {
  const transforms: Cell[][] = [];
  const seen = new Set<string>();
  
  let current = normalizeCells(originalCells);
  
  // Try all 4 rotations
  for (let r = 0; r < 4; r++) {
    // Add current rotation
    const key = cellsToKey(current);
    if (!seen.has(key)) {
      seen.add(key);
      transforms.push([...current]);
    }
    
    // Add horizontal flip of current rotation
    const flipped = flipPolyominoH(current);
    const flippedKey = cellsToKey(flipped);
    if (!seen.has(flippedKey)) {
      seen.add(flippedKey);
      transforms.push([...flipped]);
    }
    
    // Rotate for next iteration
    current = rotatePolyomino90(current);
  }
  
  return transforms;
}

// ============ POLYHEX TRANSFORMS ============

/**
 * Convert offset coords (row, col) to axial coords (q, r)
 * Using odd-r offset layout
 */
function offsetToAxial(row: number, col: number): { q: number; r: number } {
  const q = col - Math.floor(row / 2);
  const r = row;
  return { q, r };
}

/**
 * Convert axial coords (q, r) to offset coords (row, col)
 */
function axialToOffset(q: number, r: number): { row: number; col: number } {
  const row = r;
  const col = q + Math.floor(r / 2);
  return { row, col };
}

/**
 * Rotate hex cells 60° clockwise in cube coordinates
 * cube(x,y,z) where x+y+z=0, rotation: (x,y,z) -> (-z,-x,-y)
 */
function rotateHex60(cells: Cell[]): Cell[] {
  const rotated = cells.map(c => {
    const { q, r } = offsetToAxial(c.row, c.col);
    // Convert axial to cube: x=q, z=r, y=-x-z (y is implied by x+y+z=0)
    const x = q;
    const z = r;
    // Rotate 60° CW: (x,y,z) -> (-z,-x,-y)
    // Since y = -x-z, we have: newX = -z, newZ = -(-x-z) = x+z
    const newX = -z;
    const newZ = x + z;
    // Convert back to axial: q=newX, r=newZ
    const newQ = newX;
    const newR = newZ;
    // Convert axial to offset
    return axialToOffset(newQ, newR);
  });
  return normalizeCells(rotated);
}

/**
 * Flip hex cells horizontally (reflect across vertical axis)
 */
function flipHexH(cells: Cell[]): Cell[] {
  const flipped = cells.map(c => {
    const { q, r } = offsetToAxial(c.row, c.col);
    // Horizontal flip in axial: q' = -q - r, r' = r
    const newQ = -q - r;
    const newR = r;
    return axialToOffset(newQ, newR);
  });
  return normalizeCells(flipped);
}

/**
 * Generate all 12 unique transforms for a polyhex (6 rotations × 2 reflections)
 */
function getPolyhexTransforms(originalCells: Cell[]): Cell[][] {
  const transforms: Cell[][] = [];
  const seen = new Set<string>();
  
  let current = normalizeCells(originalCells);
  
  // Try all 6 rotations
  for (let r = 0; r < 6; r++) {
    // Add current rotation
    const key = cellsToKey(current);
    if (!seen.has(key)) {
      seen.add(key);
      transforms.push([...current]);
    }
    
    // Add horizontal flip of current rotation
    const flipped = flipHexH(current);
    const flippedKey = cellsToKey(flipped);
    if (!seen.has(flippedKey)) {
      seen.add(flippedKey);
      transforms.push([...flipped]);
    }
    
    // Rotate for next iteration
    current = rotateHex60(current);
  }
  
  return transforms;
}

// ============ POLYIAMOND TRANSFORMS ============

type Vertex = { X: number; Y: number }; // integer "half-edge" coords
type UV = { u: number; v: number };

function toUV(p: Vertex): UV {
  // Our triangle vertices always satisfy (X - Y) is ODD
  // Use the "odd sublattice" mapping: u = (X - Y - 1)/2, v = Y
  return { u: (p.X - p.Y - 1) / 2, v: p.Y };
}

function fromUV(p: UV): Vertex {
  // Inverse: X = 2u + v + 1, Y = v
  return { X: 2 * p.u + p.v + 1, Y: p.v };
}

/**
 * Get triangle vertices in half-edge coords
 */
function getTriangleVertices(row: number, col: number): Vertex[] {
  const isUp = (row + col) % 2 === 0;
  if (isUp) {
    // Up triangle: apex at top
    return [
      { X: col + 1, Y: row },
      { X: col, Y: row + 1 },
      { X: col + 2, Y: row + 1 },
    ];
  } else {
    // Down triangle: apex at bottom
    return [
      { X: col, Y: row },
      { X: col + 2, Y: row },
      { X: col + 1, Y: row + 1 },
    ];
  }
}

/**
 * Convert transformed vertices back to cell coordinates
 */
function verticesToCell(verts: Vertex[]): Cell | null {
  const Ys = verts.map(p => p.Y);
  const minY = Math.min(...Ys);
  const maxY = Math.max(...Ys);
  
  if (maxY - minY !== 1) return null;
  
  const low = verts.filter(p => p.Y === minY);
  const high = verts.filter(p => p.Y === maxY);
  
  if (low.length === 1 && high.length === 2) {
    // Up triangle
    const col = Math.min(high[0].X, high[1].X);
    const row = minY;
    return { row, col };
  } else if (low.length === 2 && high.length === 1) {
    // Down triangle
    const col = Math.min(low[0].X, low[1].X);
    const row = minY;
    return { row, col };
  }
  
  return null;
}

/**
 * Rotate polyiamond cells 60° clockwise
 */
function rotateIamond60(cells: Cell[]): Cell[] {
  const resultCells: Cell[] = [];
  
  for (const c of cells) {
    const verts = getTriangleVertices(c.row, c.col);
    const transformedVerts = verts.map(v => {
      const uv = toUV(v);
      // rot60 CW: (u,v) -> (u+v, -u)
      const newUV: UV = { u: uv.u + uv.v, v: -uv.u };
      return fromUV(newUV);
    });
    const cell = verticesToCell(transformedVerts);
    if (cell) {
      resultCells.push(cell);
    }
  }
  
  return normalizeIamondCells(resultCells);
}

/**
 * Flip polyiamond cells horizontally
 */
function flipIamondH(cells: Cell[]): Cell[] {
  const resultCells: Cell[] = [];
  
  for (const c of cells) {
    const verts = getTriangleVertices(c.row, c.col);
    const transformedVerts = verts.map(v => {
      const uv = toUV(v);
      // flipH: (u,v) -> (-u - v, v)
      const newUV: UV = { u: -uv.u - uv.v, v: uv.v };
      return fromUV(newUV);
    });
    const cell = verticesToCell(transformedVerts);
    if (cell) {
      resultCells.push(cell);
    }
  }
  
  return normalizeIamondCells(resultCells);
}

/**
 * Normalize iamond cells preserving triangle parity
 */
function normalizeIamondCells(cells: Cell[]): Cell[] {
  if (cells.length === 0) return [];
  
  let minRow = Infinity, minCol = Infinity;
  for (const c of cells) {
    minRow = Math.min(minRow, c.row);
    minCol = Math.min(minCol, c.col);
  }
  
  // Adjust offsets to preserve (row + col) % 2 parity
  const offRow = -minRow;
  let offCol = -minCol;
  
  if (((offRow + offCol) & 1) !== 0) {
    offCol += 1;
  }
  
  return cells.map(c => ({ row: c.row + offRow, col: c.col + offCol }));
}

/**
 * Generate all 12 unique transforms for a polyiamond (6 rotations × 2 reflections)
 */
function getPolyiamondTransforms(originalCells: Cell[]): Cell[][] {
  const transforms: Cell[][] = [];
  const seen = new Set<string>();
  
  let current = normalizeIamondCells(originalCells);
  
  // Try all 6 rotations
  for (let r = 0; r < 6; r++) {
    // Add current rotation
    const key = cellsToKey(current);
    if (!seen.has(key)) {
      seen.add(key);
      transforms.push([...current]);
    }
    
    // Add horizontal flip of current rotation
    const flipped = flipIamondH(current);
    const flippedKey = cellsToKey(flipped);
    if (!seen.has(flippedKey)) {
      seen.add(flippedKey);
      transforms.push([...flipped]);
    }
    
    // Rotate for next iteration
    current = rotateIamond60(current);
  }
  
  return transforms;
}

// ============ MAIN SOLVER ============

/**
 * Get all transforms for a polyform based on its type
 */
function getAllTransforms(cells: Cell[], polyformType: PolyformType): Cell[][] {
  switch (polyformType) {
    case "polyomino":
      return getPolyominoTransforms(cells);
    case "polyhex":
      return getPolyhexTransforms(cells);
    case "polyiamond":
      return getPolyiamondTransforms(cells);
  }
}

/**
 * Generate all valid placements of the tile in the target grid.
 * Only placements where ALL cells are fully inside the target grid are included.
 */
function generatePlacements(
  transforms: Cell[][],
  targetWidth: number,
  targetHeight: number,
  tileWidth: number,
  tileHeight: number
): Placement[] {
  const placements: Placement[] = [];
  
  // Iterate over all possible offset positions. We use an extended range
  // to check all positions, but only keep placements where all cells fit.
  const minOffsetRow = -(tileHeight - 1);
  const maxOffsetRow = targetHeight - 1;
  const minOffsetCol = -(tileWidth - 1);
  const maxOffsetCol = targetWidth - 1;
  
  for (let transformIndex = 0; transformIndex < transforms.length; transformIndex++) {
    const tileCells = transforms[transformIndex];
    
    // For each possible translation
    for (let offsetRow = minOffsetRow; offsetRow <= maxOffsetRow; offsetRow++) {
      for (let offsetCol = minOffsetCol; offsetCol <= maxOffsetCol; offsetCol++) {
        // Compute covered cells in target grid
        const coveredCells: Cell[] = [];
        let allInGrid = true;
        
        for (const cell of tileCells) {
          const targetRow = cell.row + offsetRow;
          const targetCol = cell.col + offsetCol;
          coveredCells.push({ row: targetRow, col: targetCol });
          
          // Check if this cell is within the target grid
          if (targetRow < 0 || targetRow >= targetHeight ||
              targetCol < 0 || targetCol >= targetWidth) {
            allInGrid = false;
          }
        }
        
        // Only add placement if ALL cells are in the target grid
        if (allInGrid) {
          placements.push({
            transformIndex,
            offsetRow,
            offsetCol,
            coveredCells,
          });
        }
      }
    }
  }
  
  return placements;
}

/**
 * Build SAT constraints for the tiling problem
 */
function buildTilingConstraints(
  solver: SATSolver,
  placements: Placement[],
  targetWidth: number,
  targetHeight: number
): Map<number, Placement> {
  const formula = new CadicalFormulaBuilder(solver);
  
  // Create a variable for each placement
  const placementVars = new Map<number, number>();
  const varToPlacement = new Map<number, Placement>();
  
  for (let i = 0; i < placements.length; i++) {
    const varNum = solver.newVariable();
    placementVars.set(i, varNum);
    varToPlacement.set(varNum, placements[i]);
  }
  
  // Build index: for each point, which placements cover it?
  const coveringPlacements = new Map<string, number[]>();
  
  for (let i = 0; i < placements.length; i++) {
    for (const cell of placements[i].coveredCells) {
      const key = `${cell.row},${cell.col}`;
      if (!coveringPlacements.has(key)) {
        coveringPlacements.set(key, []);
      }
      coveringPlacements.get(key)!.push(i);
    }
  }
  
  // Constraint 1: Non-overlap
  // For every point in the target grid, at most one placement can cover it
  // (Since all placements are fully inside the grid, we only need to check target cells)
  for (let row = 0; row < targetHeight; row++) {
    for (let col = 0; col < targetWidth; col++) {
      const key = `${row},${col}`;
      const covering = coveringPlacements.get(key);
      if (covering && covering.length >= 2) {
        // At most one of these placements can be active
        const literals = covering.map(i => placementVars.get(i)!);
        formula.addAtMostOne(literals);
      }
    }
  }
  
  // Constraint 2: Coverage
  // For every point in the target grid, at least one placement must cover it
  for (let row = 0; row < targetHeight; row++) {
    for (let col = 0; col < targetWidth; col++) {
      const key = `${row},${col}`;
      const covering = coveringPlacements.get(key);
      if (covering && covering.length > 0) {
        // At least one of these placements must be active
        const literals = covering.map(i => placementVars.get(i)!);
        formula.addOr(literals);
      } else {
        // No placements cover this cell - unsatisfiable
        // Add empty clause to make it UNSAT
        solver.addClause([]);
      }
    }
  }
  
  return varToPlacement;
}

/**
 * Solve the polyform tiling problem
 */
export function solveTiling(
  tileCells: boolean[][],
  polyformType: PolyformType,
  targetWidth: number,
  targetHeight: number,
  solver: SATSolver
): TilingSolverResult {
  // Extract filled cells from the tile
  const filledCells = getFilledCells(tileCells);
  
  if (filledCells.length === 0) {
    return {
      satisfiable: false,
      placements: [],
      stats: {
        numVars: 0,
        numClauses: 0,
        numPlacements: 0,
        numTransforms: 0,
      },
    };
  }
  
  // Normalize to get minimal bounding box
  const normalizedCells = normalizeCells(filledCells);
  const { width: tileWidth, height: tileHeight } = getBoundingBox(normalizedCells);
  
  // Generate all transforms
  const transforms = getAllTransforms(normalizedCells, polyformType);
  
  // Generate all valid placements
  const placements = generatePlacements(
    transforms,
    targetWidth,
    targetHeight,
    tileWidth,
    tileHeight
  );
  
  // Build SAT constraints
  const varToPlacement = buildTilingConstraints(
    solver,
    placements,
    targetWidth,
    targetHeight
  );
  
  // Solve
  const result = solver.solve();
  
  // Extract selected placements
  const selectedPlacements: Placement[] = [];
  if (result.satisfiable) {
    for (const [varNum, placement] of varToPlacement) {
      if (result.assignment.get(varNum)) {
        selectedPlacements.push(placement);
      }
    }
  }
  
  return {
    satisfiable: result.satisfiable,
    placements: selectedPlacements,
    stats: {
      numVars: solver.getVariableCount(),
      numClauses: solver.getClauseCount(),
      numPlacements: placements.length,
      numTransforms: transforms.length,
    },
  };
}
