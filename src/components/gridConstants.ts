/**
 * Shared constants and utilities for grid rendering
 * 
 * These are used by both Grid.tsx (React rendering) and svgDownload.ts (SVG export)
 */

import type { GridType } from "../solver";
import { HATCH_COLOR } from "../solver";

// Re-export for convenience
export { HATCH_COLOR };

/**
 * Predefined color palette used for rendering cells
 */
export const COLORS = [
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

/**
 * Background color for hatch pattern cells
 */
export const HATCH_BG_COLOR = "#fffde7"; // light yellow

/**
 * Get the display color for a given color index
 */
export function getDisplayColor(color: number): string {
  const isHatch = color === HATCH_COLOR;
  return isHatch ? HATCH_BG_COLOR : COLORS[color % COLORS.length];
}

/**
 * Wall colors and thickness
 */
export const WALL_COLOR = "#2c3e50";
export const DEFAULT_WALL_THICKNESS = 3;
export const SVG_WALL_THICKNESS = 2;

/**
 * Blank cell appearance
 */
export const BLANK_COLOR = "#f5f5f5";

// ============================================================================
// Hex Grid Geometry Utilities
// ============================================================================

/**
 * Calculate hex grid dimensions based on cell size
 */
export function getHexDimensions(cellSize: number) {
  const hexSize = cellSize * 0.5;
  const hexWidth = Math.sqrt(3) * hexSize;
  const hexHeight = 2 * hexSize;
  const hexHorizSpacing = hexWidth;
  const hexVertSpacing = hexHeight * 0.75;
  return { hexSize, hexWidth, hexHeight, hexHorizSpacing, hexVertSpacing };
}

/**
 * Get hex neighbors (odd-r offset coordinates)
 * Returns [row, col, direction] tuples for all 6 neighbors
 */
export function getHexNeighbors(row: number, col: number): [number, number, string][] {
  const isOddRow = row % 2 === 1;
  if (isOddRow) {
    return [
      [row - 1, col, "NW"],
      [row - 1, col + 1, "NE"],
      [row, col - 1, "W"],
      [row, col + 1, "E"],
      [row + 1, col, "SW"],
      [row + 1, col + 1, "SE"],
    ];
  } else {
    return [
      [row - 1, col - 1, "NW"],
      [row - 1, col, "NE"],
      [row, col - 1, "W"],
      [row, col + 1, "E"],
      [row + 1, col - 1, "SW"],
      [row + 1, col, "SE"],
    ];
  }
}

/**
 * Create SVG path for a pointy-topped hexagon
 */
export function createHexPath(cx: number, cy: number, size: number): string {
  const points: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30;
    const angleRad = (Math.PI / 180) * angleDeg;
    points.push([cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)]);
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
}

/**
 * Get hex center position for a cell
 */
export function getHexCenter(
  row: number,
  col: number,
  hexWidth: number,
  hexSize: number,
  hexHorizSpacing: number,
  hexVertSpacing: number,
  padding: number
): { cx: number; cy: number } {
  const isOddRow = row % 2 === 1;
  const cx = padding + hexWidth / 2 + col * hexHorizSpacing + (isOddRow ? hexWidth / 2 : 0);
  const cy = padding + hexSize + row * hexVertSpacing;
  return { cx, cy };
}

/**
 * Get wall segment coordinates for a hex edge in the specified direction
 */
export function getHexWallSegment(
  direction: string,
  cx: number,
  cy: number,
  size: number
): { x1: number; y1: number; x2: number; y2: number } | null {
  const getVertex = (angleDeg: number): [number, number] => {
    const angleRad = (Math.PI / 180) * angleDeg;
    return [cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)];
  };

  switch (direction) {
    case "NW": {
      const v1 = getVertex(210);
      const v2 = getVertex(270);
      return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
    }
    case "NE": {
      const v1 = getVertex(270);
      const v2 = getVertex(-30);
      return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
    }
    case "W": {
      const v1 = getVertex(150);
      const v2 = getVertex(210);
      return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
    }
    case "E": {
      const v1 = getVertex(-30);
      const v2 = getVertex(30);
      return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
    }
    case "SW": {
      const v1 = getVertex(90);
      const v2 = getVertex(150);
      return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
    }
    case "SE": {
      const v1 = getVertex(30);
      const v2 = getVertex(90);
      return { x1: v1[0], y1: v1[1], x2: v2[0], y2: v2[1] };
    }
    default:
      return null;
  }
}

// ============================================================================
// Octagon Grid Geometry Utilities
// ============================================================================

/**
 * Calculate octagon grid dimensions based on cell size
 */
export function getOctagonDimensions(cellSize: number) {
  const octInset = cellSize * 0.3;
  const octBandWidth = octInset * 0.6;
  return { octInset, octBandWidth };
}

/**
 * Create SVG path for an octagon
 */
export function createOctagonPath(cx: number, cy: number, size: number, inset: number): string {
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
}

// ============================================================================
// Cairo Grid Geometry Utilities
// ============================================================================

type RotMatrix = [number, number, number, number];

/**
 * Create a 2D rotation matrix for the given angle in degrees
 */
function rotMat(deg: number): RotMatrix {
  const th = deg * Math.PI / 180;
  return [Math.cos(th), -Math.sin(th), Math.sin(th), Math.cos(th)];
}

/**
 * Apply a rotation matrix to a point
 */
function applyRot(p: [number, number], rot: RotMatrix): [number, number] {
  return [rot[0] * p[0] + rot[1] * p[1], rot[2] * p[0] + rot[3] * p[1]];
}

// Cairo pentagon base vertices (from Python reference code)
const V = [
  [-2.0, 0.0],
  [-3.0, 3.0],   // hub 90° vertex
  [0.0, 4.0],
  [3.0, 3.0],   // other 90° vertex
  [2.0, 0.0]
];
const hub = V[1];
const P0 = V.map(v => [v[0] - hub[0], v[1] - hub[1]]);

// Parity-based rotation angles
const parityRot: { [key: string]: number } = {
  "0,0": -90.0,
  "1,0": 0.0,
  "0,1": 180.0,
  "1,1": 90.0,
};

// Global transformations
const T1 = [6.0, 6.0];
const T2 = [6.0, -6.0];
const Q = rotMat(-45.0);
const s = 1.0 / (6.0 * Math.sqrt(2.0));

// Pre-transform the base polygon
const P0g = P0.map(p => {
  const rotated = applyRot(p as [number, number], Q);
  return [rotated[0] * s, rotated[1] * s];
});

// Transform the translation vectors
const T1g = [
  (Q[0] * T1[0] + Q[1] * T1[1]) * s,
  (Q[2] * T1[0] + Q[3] * T1[1]) * s
];
const T2g = [
  -(Q[0] * T2[0] + Q[1] * T2[1]) * s,
  -(Q[2] * T2[0] + Q[3] * T2[1]) * s
];

/**
 * Get Cairo tile vertices for a given (row, col) position
 */
export function getCairoTile(row: number, col: number): [number, number][] {
  const parityCol = col % 2;
  const parityRow = row % 2;
  const u = Math.floor(col / 2);
  const v = Math.floor(row / 2);

  const rot = parityRot[`${parityCol},${parityRow}`];
  const rotMatrix = rotMat(rot);

  // Rotate the base polygon
  const poly = P0g.map(p => applyRot(p as [number, number], rotMatrix));

  // Apply group translation
  const G = [
    u * T1g[0] + v * T2g[0],
    u * T1g[1] + v * T2g[1]
  ];

  // Translate and return
  return poly.map(p => [p[0] + G[0], p[1] + G[1]] as [number, number]);
}

/**
 * Get Cairo neighbors
 * Returns [row, col] tuples for all 5 neighbors (4 cardinal + 1 diagonal)
 */
export function getCairoNeighbors(row: number, col: number): [number, number][] {
  const parityCol = col % 2;
  const parityRow = row % 2;

  const cardinals: [number, number][] = [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ];

  // Diagonal neighbor depends on parity (col%2, row%2)
  let diagonal: [number, number];
  if (parityCol === 0 && parityRow === 0) {
    diagonal = [row + 1, col - 1];  // SW
  } else if (parityCol === 1 && parityRow === 0) {
    diagonal = [row - 1, col - 1];  // NW
  } else if (parityCol === 0 && parityRow === 1) {
    diagonal = [row + 1, col + 1];  // SE
  } else {
    diagonal = [row - 1, col + 1];  // NE
  }

  return [...cardinals, diagonal];
}

/**
 * Get Cairo neighbors with direction labels
 */
export function getCairoNeighborsWithDirection(row: number, col: number): [number, number, string][] {
  const parityCol = col % 2;
  const parityRow = row % 2;

  const cardinals: [number, number, string][] = [
    [row - 1, col, "N"],
    [row + 1, col, "S"],
    [row, col - 1, "W"],
    [row, col + 1, "E"],
  ];

  let diagonal: [number, number, string];
  if (parityCol === 0 && parityRow === 0) {
    diagonal = [row + 1, col - 1, "SW"];
  } else if (parityCol === 1 && parityRow === 0) {
    diagonal = [row - 1, col - 1, "NW"];
  } else if (parityCol === 0 && parityRow === 1) {
    diagonal = [row + 1, col + 1, "SE"];
  } else {
    diagonal = [row - 1, col + 1, "NE"];
  }

  return [...cardinals, diagonal];
}

/**
 * Find shared edge between two Cairo tiles
 */
export function findSharedEdge(
  tile1: [number, number][],
  tile2: [number, number][],
  epsilon: number = 0.001
): [[number, number], [number, number]] | null {
  for (let i = 0; i < tile1.length; i++) {
    const a1 = tile1[i];
    const a2 = tile1[(i + 1) % tile1.length];

    for (let j = 0; j < tile2.length; j++) {
      const b1 = tile2[j];
      const b2 = tile2[(j + 1) % tile2.length];

      const dist = (p1: [number, number], p2: [number, number]) =>
        Math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2);

      if ((dist(a1, b1) < epsilon && dist(a2, b2) < epsilon) ||
          (dist(a1, b2) < epsilon && dist(a2, b1) < epsilon)) {
        return [a1, a2];
      }
    }
  }
  return null;
}

/**
 * Calculate bounding box of all Cairo tiles in a grid
 */
export function getCairoBoundingBox(width: number, height: number) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const tile = getCairoTile(row, col);
      for (const [x, y] of tile) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Create a coordinate transformer for Cairo tiles
 */
export function createCairoTransformer(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
  padding: number
) {
  const { minX, maxX, minY, maxY } = getCairoBoundingBox(width, height);
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const scale = Math.min(availableWidth / rangeX, availableHeight / rangeY);

  return (p: [number, number]): [number, number] => {
    return [
      padding + (p[0] - minX) * scale,
      padding + (p[1] - minY) * scale
    ];
  };
}

/**
 * Calculate polygon centroid
 */
export function polyCentroid(poly: [number, number][]): [number, number] {
  const x = poly.map(p => p[0]);
  const y = poly.map(p => p[1]);
  let A = 0;
  let Cx = 0;
  let Cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const cross = x[i] * y[j] - x[j] * y[i];
    A += cross;
    Cx += (x[i] + x[j]) * cross;
    Cy += (y[i] + y[j]) * cross;
  }
  A /= 2;
  if (Math.abs(A) < 1e-12) {
    return [
      poly.reduce((sum, p) => sum + p[0], 0) / poly.length,
      poly.reduce((sum, p) => sum + p[1], 0) / poly.length
    ];
  }
  return [Cx / (6 * A), Cy / (6 * A)];
}

// ============================================================================
// Grid Dimension Calculation
// ============================================================================

/**
 * Calculate total dimensions for a grid based on type
 */
export function calculateGridDimensions(
  width: number,
  height: number,
  cellSize: number,
  gridType: GridType,
  wallThickness: number = DEFAULT_WALL_THICKNESS
) {
  if (gridType === "hex") {
    const { hexWidth, hexHeight, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);
    return {
      totalWidth: width * hexHorizSpacing + hexWidth / 2 + wallThickness * 2,
      totalHeight: (height - 1) * hexVertSpacing + hexHeight + wallThickness * 2,
    };
  } else if (gridType === "octagon" || gridType === "cairo") {
    return {
      totalWidth: width * cellSize + wallThickness * 2,
      totalHeight: height * cellSize + wallThickness * 2,
    };
  } else {
    // Square grid
    return {
      totalWidth: width * cellSize + wallThickness,
      totalHeight: height * cellSize + wallThickness,
    };
  }
}

// ============================================================================
// SVG Pattern Definitions (as strings for SVG export)
// ============================================================================

/**
 * Generate SVG pattern definitions string for hatch pattern
 */
export function getSvgHatchPatternDef(): string {
  return `    <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
      <rect width="8" height="8" fill="${HATCH_BG_COLOR}"/>
      <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" stroke-width="1.5"/>
      <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" stroke-width="1.5"/>
    </pattern>`;
}
