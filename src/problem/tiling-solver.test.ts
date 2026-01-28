/**
 * Tests for the tiling solver.
 *
 * These tests verify that:
 * 1. An L-shape (4-point) tile can fill an 8x8 grid on both square and hex grids
 * 2. None of the placements overlap (by pairwise inspection)
 * 3. All cells in the target grid are filled
 */

import { describe, it, expect } from "vitest";
import { solveTiling } from "./tiling-solver";
import type { TilePoint, TilingSolution } from "./tiling-sat";
import type { GridType } from "./graph-types";

/**
 * L-shaped tetromino (4 cells):
 * X
 * X
 * X X
 */
const L_SHAPE_TILE: TilePoint[] = [
  { row: 0, col: 0 },
  { row: 1, col: 0 },
  { row: 2, col: 0 },
  { row: 2, col: 1 },
];

/**
 * Check that no two placements in the solution overlap (share any cell)
 */
function checkNoOverlap(solution: TilingSolution): { ok: boolean; message: string } {
  const { usedPlacements } = solution;
  
  for (let i = 0; i < usedPlacements.length; i++) {
    const cells1 = new Set(usedPlacements[i].cells.map((c) => `${c.row},${c.col}`));
    
    for (let j = i + 1; j < usedPlacements.length; j++) {
      for (const cell of usedPlacements[j].cells) {
        const key = `${cell.row},${cell.col}`;
        if (cells1.has(key)) {
          return {
            ok: false,
            message: `Placements ${i} (${usedPlacements[i].id}) and ${j} (${usedPlacements[j].id}) overlap at cell (${cell.row}, ${cell.col})`,
          };
        }
      }
    }
  }
  
  return { ok: true, message: "No overlaps found" };
}

/**
 * Check that all cells in the target grid are filled exactly once
 */
function checkAllFilled(
  solution: TilingSolution,
  targetWidth: number,
  targetHeight: number
): { ok: boolean; message: string; filledCount: number } {
  const { cellPlacements } = solution;
  
  let filledCount = 0;
  const missing: string[] = [];
  
  for (let row = 0; row < targetHeight; row++) {
    for (let col = 0; col < targetWidth; col++) {
      if (cellPlacements[row][col] >= 0) {
        filledCount++;
      } else {
        missing.push(`(${row},${col})`);
      }
    }
  }
  
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Cells not filled: ${missing.join(", ")}`,
      filledCount,
    };
  }
  
  return {
    ok: true,
    message: `All ${filledCount} cells filled`,
    filledCount,
  };
}

/**
 * Count total cells covered by placements (including cells outside target grid)
 */
function countTotalPlacementCells(solution: TilingSolution): number {
  let total = 0;
  for (const p of solution.usedPlacements) {
    total += p.cells.length;
  }
  return total;
}

/**
 * Count cells covered within the target grid only
 */
function countCellsInGrid(
  solution: TilingSolution,
  targetWidth: number,
  targetHeight: number
): number {
  let count = 0;
  for (const p of solution.usedPlacements) {
    for (const cell of p.cells) {
      if (cell.row >= 0 && cell.row < targetHeight && cell.col >= 0 && cell.col < targetWidth) {
        count++;
      }
    }
  }
  return count;
}

describe("Tiling Solver - L-shape on 8x8", () => {
  describe("Square Grid", () => {
    const gridType: GridType = "square";
    const targetWidth = 8;
    const targetHeight = 8;
    
    it("should find a solution for L-shape on 8x8 square grid", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      
      expect(solution).not.toBeNull();
      expect(solution!.usedPlacements.length).toBeGreaterThan(0);
      
      // 8x8 = 64 cells, L-shape has 4 cells, so we need 16 placements
      expect(solution!.usedPlacements.length).toBe(16);
    });
    
    it("should have no overlapping placements (pairwise check)", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      expect(solution).not.toBeNull();
      
      const overlapCheck = checkNoOverlap(solution!);
      expect(overlapCheck.ok).toBe(true);
    });
    
    it("should fill all cells in the 8x8 grid", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      expect(solution).not.toBeNull();
      
      const fillCheck = checkAllFilled(solution!, targetWidth, targetHeight);
      expect(fillCheck.ok).toBe(true);
      expect(fillCheck.filledCount).toBe(64);
    });
    
    it("should use exactly the right number of cells (16 L-shapes × 4 cells = 64)", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      expect(solution).not.toBeNull();
      
      // Each L-shape has 4 cells
      const totalCells = countTotalPlacementCells(solution!);
      expect(totalCells).toBe(64);
    });
  });
  
  describe("Hex Grid", () => {
    const gridType: GridType = "hex";
    const targetWidth = 8;
    const targetHeight = 8;
    
    it("should find a solution for L-shape on 8x8 hex grid", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      
      expect(solution).not.toBeNull();
      expect(solution!.usedPlacements.length).toBeGreaterThan(0);
    });
    
    it("should have no overlapping placements (pairwise check)", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      expect(solution).not.toBeNull();
      
      const overlapCheck = checkNoOverlap(solution!);
      expect(overlapCheck.ok).toBe(true);
    });
    
    it("should fill all cells in the 8x8 grid", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      expect(solution).not.toBeNull();
      
      const fillCheck = checkAllFilled(solution!, targetWidth, targetHeight);
      expect(fillCheck.ok).toBe(true);
      expect(fillCheck.filledCount).toBe(64);
    });
    
    it("should cover exactly 64 cells within the target grid", () => {
      const solution = solveTiling(L_SHAPE_TILE, targetWidth, targetHeight, gridType);
      expect(solution).not.toBeNull();
      
      // Count only cells that fall within the target grid
      const cellsInGrid = countCellsInGrid(solution!, targetWidth, targetHeight);
      expect(cellsInGrid).toBe(64);
    });
  });
});

describe("Tiling Solver - Edge Cases", () => {
  it("should solve a simple domino tiling", () => {
    // 2-cell domino on 4x4 grid
    const domino: TilePoint[] = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ];
    
    const solution = solveTiling(domino, 4, 4, "square");
    expect(solution).not.toBeNull();
    
    // 16 cells / 2 cells per domino = 8 dominoes
    expect(solution!.usedPlacements.length).toBe(8);
    
    const fillCheck = checkAllFilled(solution!, 4, 4);
    expect(fillCheck.ok).toBe(true);
    
    const overlapCheck = checkNoOverlap(solution!);
    expect(overlapCheck.ok).toBe(true);
  });
  
  it("should solve a 6x6 grid with L-shape (square) with no overlaps and all cells filled", () => {
    // 6x6 = 36 cells - verify no overlaps and all filled
    const solution = solveTiling(L_SHAPE_TILE, 6, 6, "square");
    expect(solution).not.toBeNull();
    
    const fillCheck = checkAllFilled(solution!, 6, 6);
    expect(fillCheck.ok).toBe(true);
    expect(fillCheck.filledCount).toBe(36);
    
    const overlapCheck = checkNoOverlap(solution!);
    expect(overlapCheck.ok).toBe(true);
    
    // Verify all 36 cells within the grid are covered
    const cellsInGrid = countCellsInGrid(solution!, 6, 6);
    expect(cellsInGrid).toBe(36);
  });
});
