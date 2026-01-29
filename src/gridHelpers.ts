import type { ColorGrid, PathlengthConstraint } from "./problem";
import { HATCH_COLOR } from "./problem";

/**
 * Creates an empty color grid with null values
 */
export function createEmptyGrid(width: number, height: number): ColorGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null)
    ),
  };
}

export interface MazeSetupResult {
  grid: ColorGrid;
  constraint: PathlengthConstraint;
}

/**
 * Creates a maze setup grid with borders and entrance/exit positions
 * - Orange hatch (HATCH_COLOR) all the way around the border (walls)
 * - One red square on far left border (entrance)
 * - One red square on far right border (exit)
 * - All other interior cells: red (color 0)
 * - Pathlength constraint from entrance to exit with distance >= max(width, height)
 */
export function createMazeSetupGrid(
  width: number,
  height: number
): MazeSetupResult {
  // Position the entrance and exit at the middle row of left/right borders
  const middleRow = Math.floor(height / 2);
  const entranceCol = 0;
  const exitCol = width - 1;
  
  const colors = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => {
      // Entrance on far left: red square in the left border
      if (row === middleRow && col === entranceCol) {
        return 0; // red
      }
      // Exit on far right: red square in the right border
      if (row === middleRow && col === exitCol) {
        return 0; // red
      }
      // Other border cells: orange hatch (walls)
      if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
        return HATCH_COLOR;
      }
      // Interior: red
      return 0;
    })
  );
  
  const grid: ColorGrid = { width, height, colors };
  
  // Create pathlength constraint with minimum distance at exit
  // Use max(width, height) as minimum distance to ensure a sufficiently long maze path
  const minDistance = Math.max(width, height);
  const constraint: PathlengthConstraint = {
    id: `maze_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    minDistances: {
      [`${middleRow},${exitCol}`]: minDistance,
    },
  };
  
  return { grid, constraint };
}

/** Generate a unique ID for a new pathlength constraint */
export function generateConstraintId(): string {
  return `plc_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
