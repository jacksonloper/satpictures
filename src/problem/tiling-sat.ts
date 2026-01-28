/**
 * Tiling SAT CNF Builder
 *
 * Encodes the tile placement problem as a SAT formula:
 * - User defines a "tile" (set of grid cells)
 * - User specifies a target grid (width × height)
 * - Solver finds placements (translations and rotations) of the tile that:
 *   1. Cover every cell in the target grid
 *   2. Do not overlap (even beyond the grid boundaries)
 *
 * Variables:
 * - placement_p: "placement p is used"
 * - occupied_{row},{col}: "cell (row, col) is covered by some placement"
 *
 * Constraints:
 * 1. For each placement p covering cell (r, c): placement_p → occupied_{r},{c}
 * 2. For each cell (r, c) in target grid: at least one placement covers it
 * 3. For each pair of overlapping placements p1, p2: at most one can be used
 */

import type { GridType } from "./graph-types";

/**
 * A point on the tile (relative coordinates)
 */
export interface TilePoint {
  row: number;
  col: number;
}

/**
 * A placement is a specific position and rotation of the tile
 */
export interface Placement {
  /** Unique identifier for this placement */
  id: string;
  /** Row offset for the placement */
  rowOffset: number;
  /** Column offset for the placement */
  colOffset: number;
  /** Rotation index (0-3 for square, 0-5 for hex) */
  rotation: number;
  /** The cells this placement covers (absolute coordinates) */
  cells: TilePoint[];
}

/**
 * Input configuration for building the tiling SAT CNF
 */
export interface TilingSatInput {
  /** The tile shape: list of relative (row, col) coordinates */
  tile: TilePoint[];
  /** Target grid width */
  targetWidth: number;
  /** Target grid height */
  targetHeight: number;
  /** Grid type (square or hex) */
  gridType: GridType;
}

/**
 * Result of building the tiling SAT CNF
 */
export interface TilingSatResult {
  /** Total number of variables in the CNF */
  numVars: number;
  /** List of clauses, each clause is an array of literals */
  clauses: number[][];
  /** Map from variable name to variable ID */
  varOf: Map<string, number>;
  /** Map from variable ID to variable name */
  nameOf: Map<number, string>;
  /** DIMACS format string of the CNF */
  dimacs: string;
  /** List of all placements considered */
  placements: Placement[];
  /** Metadata about the encoding */
  meta: {
    targetWidth: number;
    targetHeight: number;
    gridType: GridType;
    numPlacements: number;
  };
}

/**
 * Internal CNF builder class
 */
class CNF {
  numVars = 0;
  clauses: number[][] = [];
  varOf = new Map<string, number>();
  nameOf = new Map<number, string>();

  v(name: string): number {
    if (this.varOf.has(name)) return this.varOf.get(name)!;
    const id = ++this.numVars;
    this.varOf.set(name, id);
    this.nameOf.set(id, name);
    return id;
  }

  addClause(lits: number[]): void {
    const s = new Set<number>();
    for (const lit of lits) {
      if (s.has(-lit)) return; // tautology
      s.add(lit);
    }
    if (s.size > 0) {
      this.clauses.push([...s]);
    }
  }

  addUnit(lit: number): void {
    this.addClause([lit]);
  }

  addImp(a: number, b: number): void {
    this.addClause([-a, b]);
  }

  addAtMostOnePairwise(lits: number[]): void {
    for (let i = 0; i < lits.length; i++) {
      for (let j = i + 1; j < lits.length; j++) {
        this.addClause([-lits[i], -lits[j]]);
      }
    }
  }

  toDimacs(): string {
    let out = `p cnf ${this.numVars} ${this.clauses.length}\n`;
    for (const cl of this.clauses) out += `${cl.join(" ")} 0\n`;
    return out;
  }
}

/**
 * Rotate a point 90 degrees clockwise around origin for square grid
 */
function rotateSquare(p: TilePoint, times: number): TilePoint {
  let { row, col } = p;
  for (let i = 0; i < times; i++) {
    // 90 degree clockwise: (row, col) -> (col, -row)
    const newRow = col;
    const newCol = -row;
    row = newRow;
    col = newCol;
  }
  return { row, col };
}

/**
 * Rotate a point 60 degrees clockwise around origin for hex grid.
 * Uses axial coordinates where the hex grid has "odd-r" offset.
 * For simplicity, we convert to cube coordinates, rotate, and convert back.
 */
function rotateHex(p: TilePoint, times: number): TilePoint {
  // Convert offset coordinates to cube coordinates
  // Using "odd-r" offset: col = x, row = z + (x - (x&1)) / 2
  // x = col, z = row - (col - (col&1)) / 2, y = -x - z
  let x = p.col;
  let z = p.row - Math.floor((p.col - (p.col & 1)) / 2);
  let y = -x - z;

  // Rotate 60 degrees clockwise, `times` times
  for (let i = 0; i < times; i++) {
    // 60 degree clockwise in cube coords: (x, y, z) -> (-z, -x, -y)
    const newX = -z;
    const newY = -x;
    const newZ = -y;
    x = newX;
    y = newY;
    z = newZ;
  }

  // Convert back to offset coordinates
  const col = x;
  const row = z + Math.floor((x - (x & 1)) / 2);
  return { row, col };
}

/**
 * Get all rotations of a tile
 */
function getTileRotations(tile: TilePoint[], gridType: GridType): TilePoint[][] {
  const numRotations = gridType === "hex" ? 6 : 4;
  const rotations: TilePoint[][] = [];
  const seen = new Set<string>();

  for (let r = 0; r < numRotations; r++) {
    const rotated = tile.map((p) =>
      gridType === "hex" ? rotateHex(p, r) : rotateSquare(p, r)
    );

    // Normalize to origin (min row/col = 0)
    const minRow = Math.min(...rotated.map((p) => p.row));
    const minCol = Math.min(...rotated.map((p) => p.col));
    const normalized = rotated.map((p) => ({
      row: p.row - minRow,
      col: p.col - minCol,
    }));

    // Sort for canonical form
    normalized.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

    // Check for duplicates
    const key = JSON.stringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      rotations.push(normalized);
    }
  }

  return rotations;
}

/**
 * Get the bounding box of a tile
 */
function getTileBounds(tile: TilePoint[]): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
  const rows = tile.map((p) => p.row);
  const cols = tile.map((p) => p.col);
  return {
    minRow: Math.min(...rows),
    maxRow: Math.max(...rows),
    minCol: Math.min(...cols),
    maxCol: Math.max(...cols),
  };
}

/**
 * Check if two placements overlap (share any cell)
 */
function placementsOverlap(p1: Placement, p2: Placement): boolean {
  const cells1 = new Set(p1.cells.map((c) => `${c.row},${c.col}`));
  return p2.cells.some((c) => cells1.has(`${c.row},${c.col}`));
}

/**
 * Generate all valid placements of a tile on the grid.
 * "Valid" means at least one cell of the tile falls within the target grid.
 * We extend the placement range to detect overlaps that occur beyond boundaries.
 */
function generatePlacements(
  tile: TilePoint[],
  targetWidth: number,
  targetHeight: number,
  gridType: GridType
): Placement[] {
  const placements: Placement[] = [];
  const rotations = getTileRotations(tile, gridType);

  // For each rotation, find its bounds
  for (let rotIdx = 0; rotIdx < rotations.length; rotIdx++) {
    const rotatedTile = rotations[rotIdx];
    const bounds = getTileBounds(rotatedTile);
    const tileHeight = bounds.maxRow - bounds.minRow + 1;
    const tileWidth = bounds.maxCol - bounds.minCol + 1;

    // Placement offsets: we need to consider placements where the tile
    // extends beyond the grid to check for overlaps.
    // Range: from -(tileSize-1) to (gridSize-1) to ensure all overlapping scenarios
    const rowStart = -(tileHeight - 1);
    const rowEnd = targetHeight - 1;
    const colStart = -(tileWidth - 1);
    const colEnd = targetWidth - 1;

    for (let rowOff = rowStart; rowOff <= rowEnd; rowOff++) {
      for (let colOff = colStart; colOff <= colEnd; colOff++) {
        // Translate the tile to this position
        const cells = rotatedTile.map((p) => ({
          row: p.row + rowOff,
          col: p.col + colOff,
        }));

        // Check if at least one cell is within the target grid
        const hasGridCell = cells.some(
          (c) =>
            c.row >= 0 && c.row < targetHeight && c.col >= 0 && c.col < targetWidth
        );

        if (hasGridCell) {
          placements.push({
            id: `p_r${rotIdx}_${rowOff}_${colOff}`,
            rowOffset: rowOff,
            colOffset: colOff,
            rotation: rotIdx,
            cells,
          });
        }
      }
    }
  }

  return placements;
}

/**
 * Build a SAT CNF formula for the tiling problem.
 *
 * @param input - Configuration specifying tile, target grid, and grid type
 * @returns The CNF formula and metadata
 */
export function buildTilingSatCNF(input: TilingSatInput): TilingSatResult {
  const { tile, targetWidth, targetHeight, gridType } = input;

  if (tile.length === 0) {
    throw new Error("Tile must have at least one cell");
  }

  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new Error("Target grid must have positive dimensions");
  }

  const cnf = new CNF();

  // Generate all placements
  const placements = generatePlacements(tile, targetWidth, targetHeight, gridType);

  // Variables for each placement
  const placementVar = (p: Placement): number => cnf.v(`placement(${p.id})`);

  // For each cell in the target grid, track which placements cover it
  const coveringPlacements = new Map<string, Placement[]>();
  for (let row = 0; row < targetHeight; row++) {
    for (let col = 0; col < targetWidth; col++) {
      coveringPlacements.set(`${row},${col}`, []);
    }
  }

  for (const p of placements) {
    for (const cell of p.cells) {
      const key = `${cell.row},${cell.col}`;
      if (coveringPlacements.has(key)) {
        coveringPlacements.get(key)!.push(p);
      }
    }
  }

  // Constraint 1: For each cell in target grid, at least one placement must cover it
  for (let row = 0; row < targetHeight; row++) {
    for (let col = 0; col < targetWidth; col++) {
      const covering = coveringPlacements.get(`${row},${col}`)!;
      if (covering.length === 0) {
        // No placement can cover this cell - unsatisfiable
        cnf.addClause([]);
      } else {
        // At least one of the covering placements must be used
        cnf.addClause(covering.map((p) => placementVar(p)));
      }
    }
  }

  // Constraint 2: For each pair of overlapping placements, at most one can be used
  // This is the "no overlap" constraint, including overlaps beyond grid boundaries
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (placementsOverlap(placements[i], placements[j])) {
        // At most one of these two can be on
        cnf.addClause([-placementVar(placements[i]), -placementVar(placements[j])]);
      }
    }
  }

  return {
    numVars: cnf.numVars,
    clauses: cnf.clauses,
    varOf: cnf.varOf,
    nameOf: cnf.nameOf,
    dimacs: cnf.toDimacs(),
    placements,
    meta: {
      targetWidth,
      targetHeight,
      gridType,
      numPlacements: placements.length,
    },
  };
}

/**
 * Solution for the tiling problem
 */
export interface TilingSolution {
  /** Which placements were used */
  usedPlacements: Placement[];
  /** The assigned color for each cell (placement index) */
  cellPlacements: number[][];
  /** SAT statistics */
  stats: {
    numVars: number;
    numClauses: number;
  };
}

/**
 * Extract a tiling solution from SAT solver results
 */
export function extractTilingSolution(
  cnfResult: TilingSatResult,
  assignment: Map<number, boolean>
): TilingSolution {
  const { placements, meta, numVars, clauses } = cnfResult;
  const { targetWidth, targetHeight } = meta;

  // Find which placements are used
  const usedPlacements: Placement[] = [];
  for (const p of placements) {
    const varName = `placement(${p.id})`;
    const varId = cnfResult.varOf.get(varName);
    if (varId !== undefined && assignment.get(varId)) {
      usedPlacements.push(p);
    }
  }

  // Build cell-to-placement mapping for visualization
  const cellPlacements: number[][] = Array.from({ length: targetHeight }, () =>
    Array.from({ length: targetWidth }, () => -1)
  );

  for (let pIdx = 0; pIdx < usedPlacements.length; pIdx++) {
    const p = usedPlacements[pIdx];
    for (const cell of p.cells) {
      if (
        cell.row >= 0 &&
        cell.row < targetHeight &&
        cell.col >= 0 &&
        cell.col < targetWidth
      ) {
        cellPlacements[cell.row][cell.col] = pIdx;
      }
    }
  }

  return {
    usedPlacements,
    cellPlacements,
    stats: {
      numVars,
      numClauses: clauses.length,
    },
  };
}
