/**
 * SVG Download Utility
 * 
 * Generates and downloads SVG files for grid solutions.
 */

import type { GridSolution, GridType } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  HATCH_BG_COLOR,
  SVG_WALL_THICKNESS,
  WALL_COLOR,
  getHexDimensions,
  getHexNeighbors,
  createHexPath,
  getHexCenter,
  getHexWallSegment,
  getOctagonDimensions,
  createOctagonPath,
  getCairoTile,
  getCairoNeighbors,
  getCairoBridgeNeighborsWithDirection,
  findSharedEdge,
  createCairoTransformer,
  polyCentroid,
  getSvgHatchPatternDef,
} from "./gridConstants";

export function downloadSolutionSVG(
  solution: GridSolution,
  gridWidth: number,
  gridHeight: number,
  gridType: GridType
): void {
  const cellSize = 40;
  const wallThickness = SVG_WALL_THICKNESS;

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

  const hatchPatternDef = getSvgHatchPatternDef();
  let svgContent: string;

  if (gridType === "hex") {
    // Hex grid SVG rendering
    const { hexSize, hexWidth, hexHeight, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);
    const padding = wallThickness;

    const svgWidth = gridWidth * hexHorizSpacing + hexWidth / 2 + padding * 2;
    const svgHeight = (gridHeight - 1) * hexVertSpacing + hexHeight + padding * 2;

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <defs>\n${hatchPatternDef}\n  </defs>\n`;

    // Render hex cells
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
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
        const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
        const neighbors = getHexNeighbors(row, col);
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow >= 0 && nRow < gridHeight && nCol >= 0 && nCol < gridWidth && hasWall(row, col, nRow, nCol)) {
            const segment = getHexWallSegment(direction, cx, cy, hexSize);
            if (segment) {
              svgContent += `  <line x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}" stroke="${WALL_COLOR}" stroke-width="${wallThickness}" stroke-linecap="round" />\n`;
            }
          }
        }
      }
    }

    svgContent += `</svg>`;

  } else if (gridType === "octagon") {
    // Octagon grid SVG rendering
    const padding = wallThickness;
    const { octInset, octBandWidth } = getOctagonDimensions(cellSize);
    const svgWidth = gridWidth * cellSize + padding * 2;
    const svgHeight = gridHeight * cellSize + padding * 2;

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <rect width="${svgWidth}" height="${svgHeight}" fill="#000000" />\n`;
    svgContent += `  <defs>\n${hatchPatternDef}\n  </defs>\n`;

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
    // Cairo pentagonal tiling SVG rendering
    const padding = wallThickness;
    const svgWidth = gridWidth * cellSize + padding * 2;
    const svgHeight = gridHeight * cellSize + padding * 2;
    
    const availableWidth = svgWidth - 2 * padding;
    const availableHeight = svgHeight - 2 * padding;
    const toSvg = createCairoTransformer(gridWidth, gridHeight, availableWidth, availableHeight, padding);

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <defs>\n${hatchPatternDef}\n  </defs>\n`;

    // Render Cairo tiles
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const pathData = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const color = solution.assignedColors[row][col];
        const isHatch = color === HATCH_COLOR;
        const fill = isHatch ? "url(#hatchPattern)" : getColor(row, col);
        svgContent += `  <path d="${pathData}" fill="${fill}" />\n`;
      }
    }

    // Render walls
    const processedEdges = new Set<string>();
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const tile = getCairoTile(row, col);
        const neighbors = getCairoNeighbors(row, col);
        
        for (const [nRow, nCol] of neighbors) {
          if (nRow < 0 || nRow >= gridHeight || nCol < 0 || nCol >= gridWidth) {
            continue;
          }
          
          const edgeKey = row < nRow || (row === nRow && col < nCol)
            ? `${row},${col}-${nRow},${nCol}`
            : `${nRow},${nCol}-${row},${col}`;
            
          if (processedEdges.has(edgeKey)) {
            continue;
          }
          processedEdges.add(edgeKey);
          
          if (hasWall(row, col, nRow, nCol)) {
            const neighborTile = getCairoTile(nRow, nCol);
            const sharedEdge = findSharedEdge(tile, neighborTile);
            
            if (sharedEdge) {
              const [p1, p2] = sharedEdge.map(toSvg);
              svgContent += `  <line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="${WALL_COLOR}" stroke-width="${wallThickness}" stroke-linecap="round" />\n`;
            }
          }
        }
      }
    }

    svgContent += `</svg>`;

  } else if (gridType === "cairobridge") {
    // Cairo Bridge pentagonal tiling SVG rendering (like Cairo but with bridge connections)
    const padding = wallThickness;
    const svgWidth = gridWidth * cellSize + padding * 2;
    const svgHeight = gridHeight * cellSize + padding * 2;
    
    const availableWidth = svgWidth - 2 * padding;
    const availableHeight = svgHeight - 2 * padding;
    const toSvg = createCairoTransformer(gridWidth, gridHeight, availableWidth, availableHeight, padding);

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <defs>\n${hatchPatternDef}\n  </defs>\n`;

    // Render Cairo tiles
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const pathData = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const color = solution.assignedColors[row][col];
        const isHatch = color === HATCH_COLOR;
        const fill = isHatch ? "url(#hatchPattern)" : getColor(row, col);
        svgContent += `  <path d="${pathData}" fill="${fill}" />\n`;
      }
    }

    // Render walls FIRST (for Cairo-like shared edges only)
    const processedEdges = new Set<string>();
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const tile = getCairoTile(row, col);
        const neighbors = getCairoBridgeNeighborsWithDirection(row, col);
        const parityCol = col % 2;
        const parityRow = row % 2;
        
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow < 0 || nRow >= gridHeight || nCol < 0 || nCol >= gridWidth) {
            continue;
          }
          
          const edgeKey = row < nRow || (row === nRow && col < nCol)
            ? `${row},${col}-${nRow},${nCol}`
            : `${nRow},${nCol}-${row},${col}`;
            
          if (processedEdges.has(edgeKey)) {
            continue;
          }
          processedEdges.add(edgeKey);
          
          // Only draw walls for shared-edge neighbors (cardinal + Cairo's diagonal)
          const isCardinal = direction === "N" || direction === "S" || direction === "E" || direction === "W";
          let isCairoDiagonal = false;
          if (parityCol === 0 && parityRow === 0 && direction === "SW") isCairoDiagonal = true;
          else if (parityCol === 1 && parityRow === 0 && direction === "NW") isCairoDiagonal = true;
          else if (parityCol === 0 && parityRow === 1 && direction === "SE") isCairoDiagonal = true;
          else if (parityCol === 1 && parityRow === 1 && direction === "NE") isCairoDiagonal = true;
          
          if ((isCardinal || isCairoDiagonal) && hasWall(row, col, nRow, nCol)) {
            const neighborTile = getCairoTile(nRow, nCol);
            const sharedEdge = findSharedEdge(tile, neighborTile);
            
            if (sharedEdge) {
              const [p1, p2] = sharedEdge.map(toSvg);
              svgContent += `  <line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="${WALL_COLOR}" stroke-width="${wallThickness}" stroke-linecap="round" />\n`;
            }
          }
        }
      }
    }

    // Render bridge connections ON TOP of walls
    const bridgeBandWidth = cellSize * 0.08;
    const processedBridges = new Set<string>();
    
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const neighbors = getCairoBridgeNeighborsWithDirection(row, col);
        const parityCol = col % 2;
        const parityRow = row % 2;
        
        // Determine Cairo's diagonal for this parity
        let cairoDiagonal: string;
        if (parityCol === 0 && parityRow === 0) cairoDiagonal = "SW";
        else if (parityCol === 1 && parityRow === 0) cairoDiagonal = "NW";
        else if (parityCol === 0 && parityRow === 1) cairoDiagonal = "SE";
        else cairoDiagonal = "NE";
        
        const tile = getCairoTile(row, col);
        const centroid1 = toSvg(polyCentroid(tile));
        
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow < 0 || nRow >= gridHeight || nCol < 0 || nCol >= gridWidth) {
            continue;
          }
          
          // Only process non-Cairo diagonals (the bridge diagonals)
          const isCardinal = direction === "N" || direction === "S" || direction === "E" || direction === "W";
          if (isCardinal || direction === cairoDiagonal) {
            continue;
          }
          
          // Only process each bridge once (from lower row/col cell)
          if (row > nRow || (row === nRow && col > nCol)) {
            continue;
          }
          
          const bridgeKey = `${row},${col}-${nRow},${nCol}`;
          if (processedBridges.has(bridgeKey)) {
            continue;
          }
          processedBridges.add(bridgeKey);
          
          // Check if there's no wall (passage exists)
          if (hasWall(row, col, nRow, nCol)) {
            continue;
          }
          
          // Draw bridge from this cell's centroid to neighbor's centroid
          const neighborTile = getCairoTile(nRow, nCol);
          const centroid2 = toSvg(polyCentroid(neighborTile));
          
          // Create a thin band covering only the middle 30% of the trajectory
          const dx = centroid2[0] - centroid1[0];
          const dy = centroid2[1] - centroid1[1];
          const len = Math.sqrt(dx * dx + dy * dy);
          
          // Unit vector along the bridge direction
          const unitX = dx / len;
          const unitY = dy / len;
          
          // Start at 35% and end at 65% of the trajectory (middle 30%)
          const startX = centroid1[0] + unitX * len * 0.35;
          const startY = centroid1[1] + unitY * len * 0.35;
          const endX = centroid1[0] + unitX * len * 0.65;
          const endY = centroid1[1] + unitY * len * 0.65;
          
          // Perpendicular unit vector
          const perpX = -dy / len * bridgeBandWidth / 2;
          const perpY = dx / len * bridgeBandWidth / 2;
          
          // Four corners of the bridge band (shortened)
          const c1x = startX + perpX, c1y = startY + perpY;
          const c2x = startX - perpX, c2y = startY - perpY;
          const c3x = endX - perpX, c3y = endY - perpY;
          const c4x = endX + perpX, c4y = endY + perpY;
          
          const color = solution.assignedColors[row][col];
          const isHatch = color === HATCH_COLOR;
          const fill = isHatch ? "url(#hatchPattern)" : getColor(row, col);
          
          svgContent += `  <polygon points="${c1x},${c1y} ${c2x},${c2y} ${c3x},${c3y} ${c4x},${c4y}" fill="${fill}" stroke="none" />\n`;
          // Long edge outlines
          svgContent += `  <line x1="${c1x}" y1="${c1y}" x2="${c4x}" y2="${c4y}" stroke="${WALL_COLOR}" stroke-width="0.5" />\n`;
          svgContent += `  <line x1="${c2x}" y1="${c2y}" x2="${c3x}" y2="${c3y}" stroke="${WALL_COLOR}" stroke-width="0.5" />\n`;
        }
      }
    }

    svgContent += `</svg>`;

  } else {
    // Square grid SVG rendering
    const svgWidth = gridWidth * cellSize + wallThickness;
    const svgHeight = gridHeight * cellSize + wallThickness;

    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
    svgContent += `  <defs>\n${hatchPatternDef}\n  </defs>\n`;

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
          svgContent += `  <line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y2}" stroke="${WALL_COLOR}" stroke-width="${wallThickness}" />\n`;
        }
        
        // Bottom wall
        if (row < gridHeight - 1 && hasWall(row, col, row + 1, col)) {
          const x1 = x;
          const x2 = x + cellSize;
          svgContent += `  <line x1="${x1}" y1="${y + cellSize}" x2="${x2}" y2="${y + cellSize}" stroke="${WALL_COLOR}" stroke-width="${wallThickness}" />\n`;
        }
      }
    }

    // Add outer border
    svgContent += `  <rect x="${wallThickness / 2}" y="${wallThickness / 2}" width="${gridWidth * cellSize}" height="${gridHeight * cellSize}" fill="none" stroke="${WALL_COLOR}" stroke-width="${wallThickness}" />\n`;
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
