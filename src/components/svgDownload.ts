/**
 * SVG Download Utility
 * 
 * Generates and downloads SVG files for grid solutions.
 */

import type { GridSolution, GridType } from "../solver";
import { getCairoType, HATCH_COLOR } from "../solver";

// Color palette matching the Grid component
const COLORS = [
  "#e74c3c", // red
  "#3498db", // blue
  "#2ecc71", // green
  "#f39c12", // orange
  "#9b59b6", // purple
  "#1abc9c", // teal
  "#e91e63", // pink
  "#795548", // brown
  "#607d8b", // gray-blue
  "#00bcd4", // cyan
];

const HATCH_BG_COLOR = "#fffde7";

export function downloadSolutionSVG(
  solution: GridSolution,
  gridWidth: number,
  gridHeight: number,
  gridType: GridType
): void {
  const cellSize = 40;
  const wallThickness = 2;

  // Build wall edge set for quick lookup
  const wallEdgeSet = new Set<string>();
  for (const edge of solution.wallEdges) {
    wallEdgeSet.add(`${edge.u.row},${edge.u.col}-${edge.v.row},${edge.v.col}`);
    wallEdgeSet.add(`${edge.v.row},${edge.v.col}-${edge.u.row},${edge.u.col}`);
  }

  const hasWall = (r1: number, c1: number, r2: number, c2: number): boolean => {
    return wallEdgeSet.has(`${r1},${c1}-${r2},${c2}`);
  };

  const getColor = (row: number, col: number): string => {
    const color = solution.assignedColors[row][col];
    const isHatch = color === HATCH_COLOR;
    return isHatch ? HATCH_BG_COLOR : COLORS[color % COLORS.length];
  };

  let svgContent: string;

  if (gridType === "hex") {
    // Hex grid SVG rendering
    const hexSize = cellSize * 0.5;
    const hexWidth = Math.sqrt(3) * hexSize;
    const hexHeight = 2 * hexSize;
    const hexHorizSpacing = hexWidth;
    const hexVertSpacing = hexHeight * 0.75;
    const padding = wallThickness;

    const svgWidth = gridWidth * hexHorizSpacing + hexWidth / 2 + padding * 2;
    const svgHeight = (gridHeight - 1) * hexVertSpacing + hexHeight + padding * 2;

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <defs>\n`;
    svgContent += `    <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">\n`;
    svgContent += `      <rect width="8" height="8" fill="${HATCH_BG_COLOR}"/>\n`;
    svgContent += `      <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `      <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `    </pattern>\n`;
    svgContent += `  </defs>\n`;

    const createHexPath = (cx: number, cy: number, size: number): string => {
      const points: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const angleDeg = 60 * i - 30;
        const angleRad = (Math.PI / 180) * angleDeg;
        points.push([cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)]);
      }
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
    };

    const getHexNeighbors = (row: number, col: number): [number, number, string][] => {
      const isOddRow = row % 2 === 1;
      if (isOddRow) {
        return [
          [row - 1, col, "NW"], [row - 1, col + 1, "NE"],
          [row, col - 1, "W"], [row, col + 1, "E"],
          [row + 1, col, "SW"], [row + 1, col + 1, "SE"],
        ];
      } else {
        return [
          [row - 1, col - 1, "NW"], [row - 1, col, "NE"],
          [row, col - 1, "W"], [row, col + 1, "E"],
          [row + 1, col - 1, "SW"], [row + 1, col, "SE"],
        ];
      }
    };

    const getHexWallSegment = (direction: string, cx: number, cy: number, size: number) => {
      const getVertex = (angleDeg: number): [number, number] => {
        const angleRad = (Math.PI / 180) * angleDeg;
        return [cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)];
      };
      switch (direction) {
        case "NW": { const v1 = getVertex(210), v2 = getVertex(270); return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] }; }
        case "NE": { const v1 = getVertex(270), v2 = getVertex(-30); return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] }; }
        case "W": { const v1 = getVertex(150), v2 = getVertex(210); return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] }; }
        case "E": { const v1 = getVertex(-30), v2 = getVertex(30); return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] }; }
        case "SW": { const v1 = getVertex(90), v2 = getVertex(150); return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] }; }
        case "SE": { const v1 = getVertex(30), v2 = getVertex(90); return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] }; }
        default: return null;
      }
    };

    // Render hex cells
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const isOddRow = row % 2 === 1;
        const cx = padding + hexWidth / 2 + col * hexHorizSpacing + (isOddRow ? hexWidth / 2 : 0);
        const cy = padding + hexSize + row * hexVertSpacing;
        const path = createHexPath(cx, cy, hexSize);
        const color = solution.assignedColors[row][col];
        const isHatch = color === HATCH_COLOR;
        const fill = isHatch ? "url(#hatchPattern)" : getColor(row, col);
        svgContent += `  <path d="${path}" fill="${fill}" />\n`;
      }
    }

    // Render hex walls
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const isOddRow = row % 2 === 1;
        const cx = padding + hexWidth / 2 + col * hexHorizSpacing + (isOddRow ? hexWidth / 2 : 0);
        const cy = padding + hexSize + row * hexVertSpacing;
        const neighbors = getHexNeighbors(row, col);
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow >= 0 && nRow < gridHeight && nCol >= 0 && nCol < gridWidth && hasWall(row, col, nRow, nCol)) {
            const segment = getHexWallSegment(direction, cx, cy, hexSize);
            if (segment) {
              svgContent += `  <line x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}" stroke="#2c3e50" stroke-width="${wallThickness}" stroke-linecap="round" />\n`;
            }
          }
        }
      }
    }

    svgContent += `</svg>`;

  } else if (gridType === "octagon") {
    // Octagon grid SVG rendering
    const padding = wallThickness;
    const octInset = cellSize * 0.3;
    const octBandWidth = octInset * 0.6;
    const svgWidth = gridWidth * cellSize + padding * 2;
    const svgHeight = gridHeight * cellSize + padding * 2;

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <rect width="${svgWidth}" height="${svgHeight}" fill="#000000" />\n`;
    svgContent += `  <defs>\n`;
    svgContent += `    <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">\n`;
    svgContent += `      <rect width="8" height="8" fill="${HATCH_BG_COLOR}"/>\n`;
    svgContent += `      <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `      <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `    </pattern>\n`;
    svgContent += `  </defs>\n`;

    const createOctagonPath = (cx: number, cy: number, size: number, inset: number): string => {
      const halfSize = size / 2;
      const points: [number, number][] = [
        [cx - halfSize + inset, cy - halfSize],
        [cx + halfSize - inset, cy - halfSize],
        [cx + halfSize, cy - halfSize + inset],
        [cx + halfSize, cy + halfSize - inset],
        [cx + halfSize - inset, cy + halfSize],
        [cx - halfSize + inset, cy + halfSize],
        [cx - halfSize, cy + halfSize - inset],
        [cx - halfSize, cy - halfSize + inset],
      ];
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
    };

    // Render down-slant diagonal bands (beneath octagons) - no outline
    for (let iRow = 1; iRow < gridHeight; iRow++) {
      for (let iCol = 1; iCol < gridWidth; iCol++) {
        const ix = padding + iCol * cellSize;
        const iy = padding + iRow * cellSize;
        const gapHalf = octInset;
        const topLeftRow = iRow - 1, topLeftCol = iCol - 1;
        const botRightRow = iRow, botRightCol = iCol;
        const topLeftColor = solution.assignedColors[topLeftRow][topLeftCol];
        const botRightColor = solution.assignedColors[botRightRow][botRightCol];
        if (topLeftColor === botRightColor && !hasWall(topLeftRow, topLeftCol, botRightRow, botRightCol)) {
          const fill = topLeftColor === HATCH_COLOR ? "url(#hatchPattern)" : COLORS[topLeftColor % COLORS.length];
          const bandHalf = octBandWidth / 2;
          const x1 = ix - gapHalf - bandHalf, y1 = iy - gapHalf + bandHalf;
          const x2 = ix - gapHalf + bandHalf, y2 = iy - gapHalf - bandHalf;
          const x3 = ix + gapHalf + bandHalf, y3 = iy + gapHalf - bandHalf;
          const x4 = ix + gapHalf - bandHalf, y4 = iy + gapHalf + bandHalf;
          svgContent += `  <polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3} ${x4},${y4}" fill="${fill}" />\n`;
        }
      }
    }

    // Render octagons
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const cx = padding + col * cellSize + cellSize / 2;
        const cy = padding + row * cellSize + cellSize / 2;
        const path = createOctagonPath(cx, cy, cellSize, octInset);
        const color = solution.assignedColors[row][col];
        const isHatch = color === HATCH_COLOR;
        const fill = isHatch ? "url(#hatchPattern)" : getColor(row, col);
        svgContent += `  <path d="${path}" fill="${fill}" />\n`;
      }
    }

    // Render up-slant diagonal bands (on top of octagons) - with outline on long edges only
    for (let iRow = 1; iRow < gridHeight; iRow++) {
      for (let iCol = 0; iCol < gridWidth - 1; iCol++) {
        const ix = padding + (iCol + 1) * cellSize;
        const iy = padding + iRow * cellSize;
        const topRightRow = iRow - 1, topRightCol = iCol + 1;
        const botLeftRow = iRow, botLeftCol = iCol;
        const topRightColor = solution.assignedColors[topRightRow][topRightCol];
        const botLeftColor = solution.assignedColors[botLeftRow][botLeftCol];
        if (topRightColor === botLeftColor && !hasWall(topRightRow, topRightCol, botLeftRow, botLeftCol)) {
          const fill = topRightColor === HATCH_COLOR ? "url(#hatchPattern)" : COLORS[topRightColor % COLORS.length];
          const gapHalf = octInset;
          const bandHalf = octBandWidth / 2;
          const x1 = ix - gapHalf - bandHalf, y1 = iy - gapHalf - bandHalf;
          const x2 = ix - gapHalf + bandHalf, y2 = iy - gapHalf + bandHalf;
          const x3 = ix + gapHalf + bandHalf, y3 = iy + gapHalf + bandHalf;
          const x4 = ix + gapHalf - bandHalf, y4 = iy + gapHalf - bandHalf;
          svgContent += `  <polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3} ${x4},${y4}" fill="${fill}" stroke="none" />\n`;
          // Draw outline only on long edges
          svgContent += `  <line x1="${x1}" y1="${y1}" x2="${x4}" y2="${y4}" stroke="#000000" stroke-width="0.5" />\n`;
          svgContent += `  <line x1="${x2}" y1="${y2}" x2="${x3}" y2="${y3}" stroke="#000000" stroke-width="0.5" />\n`;
        }
      }
    }

    svgContent += `</svg>`;

  } else if (gridType === "cairo") {
    // Cairo pentagon grid SVG rendering
    const padding = wallThickness;
    const cairoScale = cellSize * 1.5;
    
    // Pre-computed pentagon vertices for each type (hub at origin)
    const CAIRO_PENTAGONS: [number, number][][] = [
      [[-0.166667, -0.333333], [0.000000, 0.000000], [0.333333, -0.166667], [0.500000, -0.500000], [0.166667, -0.666667]],
      [[0.333333, -0.166667], [0.000000, 0.000000], [0.166667, 0.333333], [0.500000, 0.500000], [0.666667, 0.166667]],
      [[-0.333333, 0.166667], [0.000000, 0.000000], [-0.166667, -0.333333], [-0.500000, -0.500000], [-0.666667, -0.166667]],
      [[0.166667, 0.333333], [0.000000, 0.000000], [-0.333333, 0.166667], [-0.500000, 0.500000], [-0.166667, 0.666667]],
    ];
    
    const cairoMaxX = Math.ceil(gridWidth / 2) + 0.67;
    const cairoMinX = -0.67;
    const cairoMaxY = Math.ceil(gridHeight / 2) + 0.67;
    const cairoMinY = -0.67;
    const svgWidth = (cairoMaxX - cairoMinX) * cairoScale + padding * 2;
    const svgHeight = (cairoMaxY - cairoMinY) * cairoScale + padding * 2;
    
    const offsetX = 0.67 * cairoScale + padding;
    const offsetY = 0.67 * cairoScale + padding;

    // Create pentagon path using pre-computed vertices
    const createCairoPentagonPath = (row: number, col: number): string => {
      const type = getCairoType(row, col);
      const vertices = CAIRO_PENTAGONS[type];
      const hubX = Math.floor(col / 2);
      const hubY = Math.floor(row / 2);
      
      const points = vertices.map(([vx, vy]) => [
        offsetX + (hubX + vx) * cairoScale,
        offsetY + (hubY + vy) * cairoScale,
      ]);
      
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
    };

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <rect width="${svgWidth}" height="${svgHeight}" fill="#1a1a1a" />\n`;
    svgContent += `  <defs>\n`;
    svgContent += `    <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">\n`;
    svgContent += `      <rect width="8" height="8" fill="${HATCH_BG_COLOR}"/>\n`;
    svgContent += `      <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `      <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `    </pattern>\n`;
    svgContent += `  </defs>\n`;

    // Render pentagons
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const path = createCairoPentagonPath(row, col);
        const color = solution.assignedColors[row][col];
        const isHatch = color === HATCH_COLOR;
        const fill = isHatch ? "url(#hatchPattern)" : getColor(row, col);
        svgContent += `  <path d="${path}" fill="${fill}" stroke="#333" stroke-width="0.5" />\n`;
      }
    }

    // Add outer border
    svgContent += `  <rect x="${wallThickness / 2}" y="${wallThickness / 2}" width="${svgWidth - wallThickness}" height="${svgHeight - wallThickness}" fill="none" stroke="#2c3e50" stroke-width="${wallThickness}" />\n`;
    svgContent += `</svg>`;

  } else {
    // Square grid SVG rendering
    const svgWidth = gridWidth * cellSize + wallThickness;
    const svgHeight = gridHeight * cellSize + wallThickness;

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <defs>\n`;
    svgContent += `    <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">\n`;
    svgContent += `      <rect width="8" height="8" fill="${HATCH_BG_COLOR}"/>\n`;
    svgContent += `      <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `      <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" stroke-width="1.5"/>\n`;
    svgContent += `    </pattern>\n`;
    svgContent += `  </defs>\n`;

    // Render cells
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const x = col * cellSize + wallThickness / 2;
        const y = row * cellSize + wallThickness / 2;
        const color = solution.assignedColors[row][col];
        const isHatch = color === HATCH_COLOR;
        const fill = isHatch ? "url(#hatchPattern)" : getColor(row, col);
        svgContent += `  <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${fill}" />\n`;
      }
    }

    // Render internal walls
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const x = col * cellSize + wallThickness / 2;
        const y = row * cellSize + wallThickness / 2;
        
        // Right wall
        if (col < gridWidth - 1 && hasWall(row, col, row, col + 1)) {
          const x1 = x + cellSize;
          const y1 = y;
          const y2 = y + cellSize;
          svgContent += `  <line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y2}" stroke="#2c3e50" stroke-width="${wallThickness}" />\n`;
        }
        
        // Bottom wall
        if (row < gridHeight - 1 && hasWall(row, col, row + 1, col)) {
          const x1 = x;
          const x2 = x + cellSize;
          svgContent += `  <line x1="${x1}" y1="${y + cellSize}" x2="${x2}" y2="${y + cellSize}" stroke="#2c3e50" stroke-width="${wallThickness}" />\n`;
        }
      }
    }

    // Add outer border
    svgContent += `  <rect x="${wallThickness / 2}" y="${wallThickness / 2}" width="${gridWidth * cellSize}" height="${gridHeight * cellSize}" fill="none" stroke="#2c3e50" stroke-width="${wallThickness}" />\n`;
    svgContent += `</svg>`;
  }

  // Create and download the SVG file
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'grid-solution.svg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
