/**
 * Trivial Solution Generator
 *
 * Creates a trivial solution for special cases like all-blank grids.
 */

import type { ColorGrid, Edge, GridSolution, GridType } from "./graph-types";
import { edgeKey, getNeighbors } from "./grid-neighbors";

/**
 * Create a trivial solution for an all-blank grid.
 * Assigns all cells to color 0 and keeps all edges (fully connected).
 * This satisfies the connectivity constraint trivially since all cells
 * are the same color and form one connected component.
 */
export function createTrivialSolution(width: number, height: number, gridType: GridType = "square"): GridSolution {
  const keptEdges: Edge[] = [];
  const wallEdges: Edge[] = [];
  const addedEdges = new Set<string>();

  // Keep all internal edges (no walls within the grid)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const neighbors = getNeighbors({ row, col }, width, height, gridType);
      for (const n of neighbors) {
        const key = edgeKey({ row, col }, n);
        if (!addedEdges.has(key)) {
          addedEdges.add(key);
          keptEdges.push({
            u: { row, col },
            v: n,
          });
        }
      }
    }
  }

  // Assign all cells to color 0
  const assignedColors: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0)
  );

  return { keptEdges, wallEdges, assignedColors, distanceLevels: null };
}

/**
 * Create a simple test grid for verification
 */
export function createTestGrid(): ColorGrid {
  return {
    width: 4,
    height: 4,
    colors: [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ],
  };
}
