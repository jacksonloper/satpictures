import React from "react";

/** Triangle grid for polyiamond */
interface TriangleGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
}

export const TriangleGrid: React.FC<TriangleGridProps> = ({ cells, onCellClick, cellSize = 40 }) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Triangle geometry:
  // - triWidth: base of the equilateral triangle = cellSize
  // - triHeight: height = base * sqrt(3)/2 (standard equilateral triangle ratio)
  // - Triangles overlap horizontally by half their width (tessellation)
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  
  const svgWidth = (width + 1) * (triWidth / 2) + 10;
  const svgHeight = height * triHeight + 10;
  
  // Create triangle path (up-pointing or down-pointing)
  // Orientation alternates based on (row + col) % 2 for tessellation
  const createTriPath = (row: number, col: number): string => {
    const isUp = (row + col) % 2 === 0;
    const x = col * (triWidth / 2) + 5;
    const y = row * triHeight + 5;
    
    if (isUp) {
      // Up-pointing triangle: apex at top
      const p1 = `${x + triWidth / 2},${y}`;
      const p2 = `${x},${y + triHeight}`;
      const p3 = `${x + triWidth},${y + triHeight}`;
      return `M ${p1} L ${p2} L ${p3} Z`;
    } else {
      // Down-pointing triangle: apex at bottom
      const p1 = `${x},${y}`;
      const p2 = `${x + triWidth},${y}`;
      const p3 = `${x + triWidth / 2},${y + triHeight}`;
      return `M ${p1} L ${p2} L ${p3} Z`;
    }
  };
  
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: "block" }}
    >
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <path
            key={`${rowIdx}-${colIdx}`}
            d={createTriPath(rowIdx, colIdx)}
            fill={filled ? "#e74c3c" : "#ecf0f1"}
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
