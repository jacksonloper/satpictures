import React from "react";
import type { ColorGrid, GridSolution, GridType } from "../solver";
import { Grid } from "./Grid";

interface SolutionGridProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  cellSize?: number;
  gridType?: GridType;
}

/**
 * SolutionGrid always shows the SAT-generated solution (solution mode).
 * This is a read-only view that displays the solver's output with walls.
 * If no solution exists, it shows blank cells.
 */
export const SolutionGrid: React.FC<SolutionGridProps> = ({
  grid,
  solution,
  cellSize = 40,
  gridType = "square",
}) => {
  // No-op handlers since solution view is read-only
  const noOp = () => {};

  return (
    <Grid
      grid={grid}
      solution={solution}
      selectedColor={null}
      onCellClick={noOp}
      onCellDrag={noOp}
      cellSize={cellSize}
      gridType={gridType}
      viewMode="solution"
    />
  );
};
