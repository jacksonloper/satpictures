/**
 * Utility functions for the Unified Polyform Tiling Solver
 * 
 * Contains coordinate conversion, edge state normalization, and placement generation.
 */

import type { GridDefinition, Coord, EdgeState } from "./types";
import { normalizeCoords, generateAllTransforms, getBoundingBox, isInGrid } from "./types";
import type { UnifiedPlacement } from "./unifiedTilingTypes";

/**
 * Canonical edge key for deduplication.
 * An edge is shared between two cells. We identify it by the smaller cell first.
 * Format: "q1,r1:edgeIdx1" where (q1,r1) is the smaller cell.
 */
export function getCanonicalEdgeKey(
  grid: GridDefinition,
  q1: number,
  r1: number,
  edgeIdx1: number
): string {
  // Get the neighbor cell
  const cellType = grid.getCellType({ q: q1, r: r1 });
  const neighbor = grid.neighbors[cellType][edgeIdx1];
  const q2 = q1 + neighbor.dq;
  const r2 = r1 + neighbor.dr;
  
  // Find the edge index from the neighbor's perspective
  const neighborCellType = grid.getCellType({ q: q2, r: r2 });
  const neighborEdges = grid.neighbors[neighborCellType];
  let edgeIdx2 = -1;
  for (let i = 0; i < neighborEdges.length; i++) {
    if (q2 + neighborEdges[i].dq === q1 && r2 + neighborEdges[i].dr === r1) {
      edgeIdx2 = i;
      break;
    }
  }
  
  // Use lexicographic ordering to get canonical form
  if (r1 < r2 || (r1 === r2 && q1 < q2)) {
    return `${q1},${r1}:${edgeIdx1}`;
  } else if (r2 < r1 || (r2 === r1 && q2 < q1)) {
    return `${q2},${r2}:${edgeIdx2}`;
  } else {
    // Same cell (shouldn't happen for valid edges)
    return `${q1},${r1}:${edgeIdx1}`;
  }
}

/**
 * Convert boolean[][] grid to array of coordinates of filled cells,
 * normalized according to the grid definition.
 */
export function gridToCoords(grid: GridDefinition, cells: boolean[][]): Coord[] {
  const coords: Coord[] = [];
  
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        // cells[row][col] corresponds to cells[r][q], so row=r, col=q
        coords.push({ q: col, r: row });
      }
    }
  }
  
  return normalizeCoords(grid, coords);
}

/**
 * Normalize edge state to match normalized tile coordinates.
 * 
 * When a tile is drawn at position (row, col) in the grid, its edge state
 * is at edgeState[row][col]. After normalization, the tile coordinates
 * are shifted so the first cell is at (0, 0). This function creates a new
 * edge state indexed by the normalized coordinates.
 * 
 * @param grid Grid definition
 * @param cells The tile cells (boolean grid)  
 * @param edgeState The edge state indexed by original grid coords
 * @returns EdgeState indexed by normalized tile coords
 */
export function normalizeEdgeState(
  grid: GridDefinition,
  cells: boolean[][],
  edgeState: EdgeState
): EdgeState {
  // Get original coordinates of filled cells (not yet normalized)
  const origCoords: Coord[] = [];
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      if (cells[row][col]) {
        origCoords.push({ q: col, r: row });
      }
    }
  }
  
  if (origCoords.length === 0) return [];
  
  // Find the offset used for normalization
  let minQ = Infinity, minR = Infinity;
  for (const c of origCoords) {
    minQ = Math.min(minQ, c.q);
    minR = Math.min(minR, c.r);
  }
  
  let offQ = -minQ;
  let offR = -minR;
  
  // For triangle grids, preserve (q+r) % 2 parity
  if (grid.numCellTypes === 2) {
    if ((offQ + offR) % 2 !== 0) {
      offR += 1;
    }
  }
  
  // Find bounds of normalized coordinates
  let maxNormQ = 0, maxNormR = 0;
  for (const c of origCoords) {
    const normQ = c.q + offQ;
    const normR = c.r + offR;
    maxNormQ = Math.max(maxNormQ, normQ);
    maxNormR = Math.max(maxNormR, normR);
  }
  
  // Create new edge state with normalized indexing
  // Index by [r][q] to match EdgeState type
  const normalizedEdgeState: EdgeState = [];
  for (let normR = 0; normR <= maxNormR; normR++) {
    const row: boolean[][] = [];
    for (let normQ = 0; normQ <= maxNormQ; normQ++) {
      // Map back to original coordinates
      const origQ = normQ - offQ;
      const origR = normR - offR;
      
      // Get edge state from original position
      const origEdges = edgeState[origR]?.[origQ];
      if (origEdges) {
        row.push([...origEdges]); // Copy the array
      } else {
        // No edge state at this position - use empty array
        // Use normalized coords for cell type since that's how the cell will be
        // addressed after normalization
        const cellType = grid.getCellType({ q: normQ, r: normR });
        const numEdges = grid.neighbors[cellType]?.length ?? 4;
        row.push(new Array(numEdges).fill(false));
      }
    }
    normalizedEdgeState.push(row);
  }
  
  return normalizedEdgeState;
}

/**
 * Generate all valid placements for tiling a grid.
 * 
 * A placement is valid if it covers at least one cell in the inner grid.
 * Placements can extend outside the inner grid (into a larger bounding area).
 * 
 * @param grid Grid definition
 * @param tileCoords Original tile coordinates (normalized)
 * @param tilingWidth Width of the tiling area
 * @param tilingHeight Height of the tiling area
 * @returns Array of placements, each with cells (placed coordinates) and originalCells (for edge lookup)
 */
export function generateAllPlacements(
  grid: GridDefinition,
  tileCoords: Coord[],
  tilingWidth: number,
  tilingHeight: number
): UnifiedPlacement[] {
  if (tileCoords.length === 0) return [];
  
  // Get all unique transforms using the grid definition
  const allTransforms = generateAllTransforms(grid, tileCoords);
  
  // Find the maximum bounding box across all transforms
  let maxTransformWidth = 0;
  let maxTransformHeight = 0;
  for (const t of allTransforms) {
    const bb = getBoundingBox(t.coords);
    maxTransformWidth = Math.max(maxTransformWidth, bb.width);
    maxTransformHeight = Math.max(maxTransformHeight, bb.height);
  }
  
  const placements: UnifiedPlacement[] = [];
  let placementId = 0;
  
  // For grids with parity constraints (like triangles), we need to be careful
  // about which translations preserve valid positions.
  // 
  // For square and hex grids, we can translate by any amount.
  // For triangle grids, translations must preserve (q + r) % 2 parity.
  
  for (const { coords: transformCoords, transformIndex, originalIndices } of allTransforms) {
    // Try all translations that might cover the inner grid
    // We use a range that ensures all valid placements are found
    
    for (let offsetR = -maxTransformHeight + 1; offsetR < tilingHeight; offsetR++) {
      for (let offsetQ = -maxTransformWidth + 1; offsetQ < tilingWidth + maxTransformWidth; offsetQ++) {
        // For grids with parity (numCellTypes > 1), check if this translation is valid
        if (grid.numCellTypes > 1) {
          // For triangle grids, translation must preserve parity
          // (offsetQ + offsetR) must be even
          if ((offsetQ + offsetR) % 2 !== 0) {
            continue;
          }
        }
        
        // Translate the coordinates
        const translatedCells = transformCoords.map(c => ({
          q: c.q + offsetQ,
          r: c.r + offsetR,
        }));
        
        // Check if this placement covers at least one cell in the inner grid
        let coversInnerGrid = false;
        for (const cell of translatedCells) {
          if (isInGrid(cell, tilingWidth, tilingHeight)) {
            coversInnerGrid = true;
            break;
          }
        }
        
        if (coversInnerGrid) {
          // Map original cells using the indices
          const originalCells = originalIndices.map(idx => tileCoords[idx]);
          
          placements.push({
            id: placementId++,
            transformIndex,
            cells: translatedCells,
            originalCells,
          });
        }
      }
    }
  }
  
  return placements;
}
