import React from "react";

/** Square grid for polyomino */
interface SquareGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
}

export const SquareGrid: React.FC<SquareGridProps> = ({ cells, onCellClick, cellSize = 40 }) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  return (
    <svg
      width={width * cellSize + 2}
      height={height * cellSize + 2}
      style={{ display: "block" }}
    >
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <rect
            key={`${rowIdx}-${colIdx}`}
            x={colIdx * cellSize + 1}
            y={rowIdx * cellSize + 1}
            width={cellSize - 1}
            height={cellSize - 1}
            fill={filled ? "#3498db" : "#ecf0f1"}
            stroke="#bdc3c7"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={() => onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
    </svg>
  );
};
