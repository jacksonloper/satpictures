/**
 * Helper functions for the PolyformExplorer component.
 * 
 * Includes grid definition lookup and placement conversion utilities.
 */

import type { UnifiedPlacement } from "./polyform-explorer/grids/unifiedTiling";
import {
  squareGridDefinition,
  hexGridDefinition,
  triGridDefinition,
  type EdgeState,
  createEmptyEdgeState,
} from "./polyform-explorer";
import { createEmptyBooleanGrid, type PolyformType } from "./utils/polyformTransforms";

/**
 * Get the grid definition for a polyform type.
 */
export function getGridDef(type: PolyformType) {
  switch (type) {
    case 'polyomino': return squareGridDefinition;
    case 'polyhex': return hexGridDefinition;
    case 'polyiamond': return triGridDefinition;
    default: return squareGridDefinition;
  }
}

/**
 * Convert unified placements (q,r) to legacy square grid placements (row,col).
 * For square grids: q = col, r = row
 */
export function toSquarePlacements(placements: UnifiedPlacement[]) {
  return placements.map(p => ({
    id: p.id,
    transformIndex: p.transformIndex,
    offset: { row: 0, col: 0 }, // Not used by viewers but required by type
    cells: p.cells.map(c => ({ row: c.r, col: c.q })),
    tileTypeIndex: p.tileTypeIndex ?? 0,
  }));
}

/**
 * Convert unified placements (q,r) to legacy hex placements.
 * Hex coordinates use the same q,r format.
 */
export function toHexPlacements(placements: UnifiedPlacement[]) {
  return placements.map(p => ({
    id: p.id,
    transformIndex: p.transformIndex,
    offset: { q: 0, r: 0 }, // Not used by viewers but required by type
    cells: p.cells.map(c => ({ q: c.q, r: c.r })),
  }));
}

/**
 * Convert unified placements to legacy triangle placements.
 * Triangle coordinates use (row, col) where row=r, col=q.
 */
export function toTriPlacements(placements: UnifiedPlacement[]) {
  return placements.map(p => ({
    id: p.id,
    transformIndex: p.transformIndex,
    cells: p.cells.map(c => ({ row: c.r, col: c.q })),
  }));
}

/** Represents a single tile with its grid and dimensions */
export interface TileState {
  cells: boolean[][];
  edgeState: EdgeState;
  gridWidth: number;
  gridHeight: number;
  widthInput: string;
  heightInput: string;
  widthError: boolean;
  heightError: boolean;
}

/** Create a new empty tile state */
export function createEmptyTileState(width: number = 8, height: number = 8, type: PolyformType = 'polyomino'): TileState {
  const grid = getGridDef(type);
  return {
    cells: createEmptyBooleanGrid(width, height),
    edgeState: createEmptyEdgeState(grid, width, height),
    gridWidth: width,
    gridHeight: height,
    widthInput: String(width),
    heightInput: String(height),
    widthError: false,
    heightError: false,
  };
}
