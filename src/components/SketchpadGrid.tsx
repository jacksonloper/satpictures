import React from "react";
import type { ColorGrid, GridSolution, GridType, ColorRoots, PathlengthConstraint } from "../problem";
import { Grid } from "./Grid";

interface SketchpadGridProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  selectedColor: number | null;
  onCellClick: (row: number, col: number) => void;
  onCellDrag: (row: number, col: number) => void;
  cellSize?: number;
  gridType?: GridType;
  colorRoots?: ColorRoots;
  distanceConstraint?: PathlengthConstraint;
}

/**
 * SketchpadGrid always shows the user's editable colors (sketchpad mode).
 * This is an editable view where users can paint cells.
 * It shows colors, roots, and distance constraints in a unified view.
 */
export const SketchpadGrid: React.FC<SketchpadGridProps> = ({
  grid,
  solution,
  selectedColor,
  onCellClick,
  onCellDrag,
  cellSize = 40,
  gridType = "square",
  colorRoots,
  distanceConstraint,
}) => {
  return (
    <Grid
      grid={grid}
      solution={solution}
      selectedColor={selectedColor}
      onCellClick={onCellClick}
      onCellDrag={onCellDrag}
      cellSize={cellSize}
      gridType={gridType}
      viewMode="sketchpad"
      colorRoots={colorRoots}
      distanceConstraint={distanceConstraint}
    />
  );
};
