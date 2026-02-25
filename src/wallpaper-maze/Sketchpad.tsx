/**
 * Sketchpad component - displays the editable fundamental domain grid
 */

import { useMemo } from "react";
import { getWallpaperGroup } from "./WallpaperGroups";
import type { WallpaperGroupName } from "./WallpaperGroups";
import type { GridCell, SketchpadTool } from "./types";
import { GRID_PADDING } from "./types";

interface SketchpadProps {
  length: number;
  cellSize: number;
  rootRow: number;
  rootCol: number;
  wallpaperGroup: WallpaperGroupName;
  activeTool: SketchpadTool;
  selectedCell: GridCell | null;
  vacantCells: Set<string>;
  onCellClick: (row: number, col: number) => void;
}

export function Sketchpad({
  length,
  cellSize,
  rootRow,
  rootCol,
  wallpaperGroup,
  activeTool,
  selectedCell,
  vacantCells,
  onCellClick,
}: SketchpadProps) {
  const padding = GRID_PADDING;

  // Get neighbor info for selected cell
  const neighborInfo = useMemo(() => {
    if (!selectedCell) return null;
    const wpg = getWallpaperGroup(wallpaperGroup);
    return {
      N: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "N", length),
      S: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "S", length),
      E: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "E", length),
      W: wpg.getWrappedNeighbor(selectedCell.row, selectedCell.col, "W", length),
    };
  }, [selectedCell, length, wallpaperGroup]);

  const cells: React.ReactNode[] = [];
  const highlights: React.ReactNode[] = [];

  // Determine which cells are neighbors of selected (when using neighborhood viewer)
  const neighborCells = new Set<string>();
  if (activeTool === "neighborhoodViewer" && selectedCell && neighborInfo) {
    neighborCells.add(`${neighborInfo.N.row},${neighborInfo.N.col}`);
    neighborCells.add(`${neighborInfo.S.row},${neighborInfo.S.col}`);
    neighborCells.add(`${neighborInfo.E.row},${neighborInfo.E.col}`);
    neighborCells.add(`${neighborInfo.W.row},${neighborInfo.W.col}`);
  }

  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const x = padding + col * cellSize;
      const y = padding + row * cellSize;
      const cellKey = `${row},${col}`;
      const isRoot = row === rootRow && col === rootCol;
      const isSelected = activeTool === "neighborhoodViewer" && selectedCell && selectedCell.row === row && selectedCell.col === col;
      const isNeighbor = neighborCells.has(cellKey);
      const isVacant = vacantCells.has(cellKey);

      // Determine fill color: vacant cells are black, root is orange, others are gray
      let fillColor = "#e0e0e0";
      if (isVacant) {
        fillColor = "#000";
      } else if (isRoot) {
        fillColor = "#ffa726";
      }

      cells.push(
        <rect
          key={`cell-${row}-${col}`}
          x={x}
          y={y}
          width={cellSize}
          height={cellSize}
          fill={fillColor}
          stroke="#ccc"
          strokeWidth={1}
          style={{ cursor: "pointer" }}
          onClick={() => onCellClick(row, col)}
        />
      );

      if (isSelected) {
        highlights.push(
          <rect
            key={`selected-${row}-${col}`}
            x={x + 2}
            y={y + 2}
            width={cellSize - 4}
            height={cellSize - 4}
            fill="none"
            stroke="#000"
            strokeWidth={3}
          />
        );
      }

      // Highlight neighbors with pink
      if (isNeighbor && !isSelected) {
        highlights.push(
          <rect
            key={`neighbor-${row}-${col}`}
            x={x + 2}
            y={y + 2}
            width={cellSize - 4}
            height={cellSize - 4}
            fill="none"
            stroke="#ff4081"
            strokeWidth={3}
            strokeDasharray="4,2"
          />
        );
      }

      // Root indicator (only for non-vacant cells)
      if (isRoot && !isVacant) {
        cells.push(
          <circle
            key={`root-${row}-${col}`}
            cx={x + cellSize / 2}
            cy={y + cellSize / 2}
            r={cellSize / 6}
            fill="#000"
          />
        );
      }
    }
  }

  const totalSize = length * cellSize + padding * 2;

  return (
    <svg width={totalSize} height={totalSize}>
      {cells}
      {highlights}
    </svg>
  );
}
