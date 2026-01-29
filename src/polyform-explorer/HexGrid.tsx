import React from "react";

/** Hex grid for polyhex */
interface HexGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
}

export const HexGrid: React.FC<HexGridProps> = ({ cells, onCellClick, cellSize = 40 }) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Hex geometry calculations for POINTY-TOP orientation:
  // - hexSize: radius from center to vertex (0.5 * cellSize for spacing)
  // - For pointy-top: hexWidth = sqrt(3) * size, hexHeight = 2 * size
  // - Pointy-top axial → pixel: x = size * sqrt(3) * (q + r/2), y = size * 3/2 * r
  const hexSize = cellSize * 0.5;
  const hexWidth = Math.sqrt(3) * hexSize;
  const horizSpacing = hexWidth;
  const vertSpacing = hexSize * 1.5; // 3/2 * size for pointy-top
  
  const svgWidth = width * horizSpacing + horizSpacing / 2 + 10;
  const svgHeight = height * vertSpacing + hexSize + 10;
  
  // Create hexagon path - POINTY-TOP orientation
  // Starting at angle PI/2 (90°) creates pointy-top orientation
  const createHexPath = (cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 2; // Pointy-top: start at 90°
      const x = cx + hexSize * Math.cos(angle);
      const y = cy + hexSize * Math.sin(angle);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(" L ")} Z`;
  };
  
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: "block" }}
    >
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => {
          // Odd-r offset for pointy-top: odd rows are shifted right by half a hex width
          const isOddRow = rowIdx % 2 === 1;
          const cx = colIdx * horizSpacing + horizSpacing / 2 + (isOddRow ? horizSpacing / 2 : 0) + 5;
          const cy = rowIdx * vertSpacing + hexSize + 5;
          
          return (
            <path
              key={`${rowIdx}-${colIdx}`}
              d={createHexPath(cx, cy)}
              fill={filled ? "#27ae60" : "#ecf0f1"}
              stroke="#bdc3c7"
              strokeWidth={1}
              style={{ cursor: "pointer" }}
              onClick={() => onCellClick(rowIdx, colIdx)}
            />
          );
        })
      )}
    </svg>
  );
};
