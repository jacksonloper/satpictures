/**
 * Polyform transformation utilities for polyomino, polyhex, and polyiamond shapes.
 * Contains rotation and flip operations using coordinate geometry.
 */

/** Polyform type - determines the grid geometry */
export type PolyformType = "polyomino" | "polyhex" | "polyiamond";

export type PolyhexTransform = "flipH" | "flipV";
export type PolyiamondTransform = "flipH" | "flipV" | "rot60";

/**
 * Create an empty grid of boolean cells.
 */
export function createEmptyBooleanGrid(width: number, height: number): boolean[][] {
  return Array.from({ length: height }, () => 
    Array.from({ length: width }, () => false)
  );
}

/**
 * Rotate the polyform 90 degrees clockwise (for square/polyomino).
 * For hex and iamond, rotation is 60 degrees.
 */
export function rotatePolyomino(cells: boolean[][]): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  // Rotate 90° clockwise: new[col][height-1-row] = old[row][col]
  const newCells: boolean[][] = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => false)
  );
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      newCells[col][height - 1 - row] = cells[row][col];
    }
  }
  return newCells;
}

/**
 * Rotate hex grid 60° clockwise.
 * Uses cube coordinates for rotation, then converts back.
 */
export function rotatePolyhex(cells: boolean[][]): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Find all filled cells and convert to cube coordinates
  const filledCubes: { x: number; y: number; z: number }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (cells[row][col]) {
        // Offset to cube (odd-r layout)
        const x = col - Math.floor(row / 2);
        const z = row;
        const y = -x - z;
        filledCubes.push({ x, y, z });
      }
    }
  }
  
  if (filledCubes.length === 0) return cells;
  
  // Rotate 60° clockwise in cube coords: (x, y, z) -> (-z, -x, -y)
  const rotatedCubes = filledCubes.map(({ x, y, z }) => ({
    x: -z,
    y: -x,
    z: -y,
  }));
  
  // Find bounding box and normalize to positive coordinates
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const cube of rotatedCubes) {
    minX = Math.min(minX, cube.x);
    maxX = Math.max(maxX, cube.x);
    minZ = Math.min(minZ, cube.z);
    maxZ = Math.max(maxZ, cube.z);
  }
  
  // Calculate new dimensions
  const newHeight = maxZ - minZ + 1;
  const newWidth = maxX - minX + 1 + Math.floor(newHeight / 2);
  
  // Create new grid and fill
  const newCells: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );
  
  for (const cube of rotatedCubes) {
    const row = cube.z - minZ;
    const col = cube.x - minX + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      newCells[row][col] = true;
    }
  }
  
  return newCells;
}

/**
 * Rotate polyiamond (triangle grid) 60° clockwise.
 * Correct implementation via rotating each triangle's lattice vertices.
 */
export function rotatePolyiamond(cells: boolean[][]): boolean[][] {
  return transformPolyiamond(cells, "rot60");
}

/**
 * Convert polyhex (odd-r offset) filled cells -> axial (q,r),
 * apply a transform, then rasterize back to odd-r offset grid.
 *
 * These reflections are defined to match screen axes:
 * - Horizontal flip: mirror across a vertical screen line (x -> -x), keep r
 * - Vertical flip: mirror across a horizontal screen line (y -> -y), r -> -r
 *
 * Using pointy-top axial pixel relation: x ~ q + r/2, y ~ r.
 */
export function transformPolyhex(cells: boolean[][], t: PolyhexTransform): boolean[][] {
  const height = cells.length;
  if (height === 0) return cells;
  const width = cells[0]?.length ?? 0;
  if (width === 0) return cells;

  const filled: { q: number; r: number }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;
      // odd-r -> axial(q,r) with r=row
      const q = col - Math.floor(row / 2);
      const r = row;
      filled.push({ q, r });
    }
  }
  if (filled.length === 0) return cells;

  const transformed = filled.map(({ q, r }) => {
    if (t === "flipH") {
      // x' = -(q + r/2), y' = r  => q' = -q - r, r' = r
      return { q: -q - r, r };
    } else {
      // y' = -r, x' same => q' = q + r, r' = -r
      return { q: q + r, r: -r };
    }
  });

  // Bounding in axial (q,r)
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const coord of transformed) {
    minQ = Math.min(minQ, coord.q);
    maxQ = Math.max(maxQ, coord.q);
    minR = Math.min(minR, coord.r);
    maxR = Math.max(maxR, coord.r);
  }

  const newHeight = maxR - minR + 1;
  const newWidth = (maxQ - minQ + 1) + Math.floor(newHeight / 2);

  const out: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );

  for (const { q, r } of transformed) {
    const row = r - minR;
    const col = (q - minQ) + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      out[row][col] = true;
    }
  }

  return out;
}

/**
 * Polyiamond transforms via lattice-vertex representation.
 *
 * We treat each small triangle as having 3 vertices on the triangular lattice.
 * Use lattice coords (u,v) where physical x = u + v/2 and y = v*(sqrt3/2).
 *
 * Vertex conversions:
 *   X = 2x (in half-edge units) = 2u + v
 *   Y = v
 * so u = (X - Y)/2, v = Y
 *
 * Transforms (matching screen axes used by the renderer):
 *   rot60 CW: (u,v) -> (u+v, -u)
 *   flipH:    x -> -x => (u,v) -> (-u - v, v)
 *   flipV:    y -> -y => (u,v) -> (u+v, -v)
 */
export function transformPolyiamond(cells: boolean[][], t: PolyiamondTransform): boolean[][] {
  const height = cells.length;
  if (height === 0) return cells;
  const width = cells[0]?.length ?? 0;
  if (width === 0) return cells;

  type Vertex = { X: number; Y: number }; // integer "half-edge" coords (X step = half base, Y step = row)
  type UV = { u: number; v: number };

  const toUV = (p: Vertex): UV => {
    // IMPORTANT:
    // Our triangle vertices always satisfy (X - Y) is ODD.
    // So we use the "odd sublattice" mapping: u = (X - Y - 1)/2 (integer), v = Y (integer).
    return { u: (p.X - p.Y - 1) / 2, v: p.Y };
  };

  const fromUV = (p: UV): Vertex => {
    // Inverse of the above: X = 2u + v + 1, Y = v
    return { X: 2 * p.u + p.v + 1, Y: p.v };
  };

  const applyUV = (p: UV): UV => {
    if (t === "rot60") return { u: p.u + p.v, v: -p.u };
    if (t === "flipH") return { u: -p.u - p.v, v: p.v };
    // flipV
    return { u: p.u + p.v, v: -p.v };
  };

  // Build triangle list as 3 vertices each
  const tris: Vertex[][] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;

      const isUp = (row + col) % 2 === 0;

      // Using the renderer geometry in integer half-edge coords:
      // x = col*(base/2) => X = col
      // y = row*(height) => Y = row
      if (isUp) {
        // Up triangle vertices: (col+1,row), (col,row+1), (col+2,row+1)
        tris.push([
          { X: col + 1, Y: row },
          { X: col, Y: row + 1 },
          { X: col + 2, Y: row + 1 },
        ]);
      } else {
        // Down triangle vertices: (col,row), (col+2,row), (col+1,row+1)
        tris.push([
          { X: col, Y: row },
          { X: col + 2, Y: row },
          { X: col + 1, Y: row + 1 },
        ]);
      }
    }
  }

  if (tris.length === 0) return cells;

  // Transform all triangles
  const transformedTris: Vertex[][] = tris.map((verts) =>
    verts.map((vtx) => fromUV(applyUV(toUV(vtx))))
  );

  // Convert transformed triangles back into (row,col) cells
  const cellsOut: { row: number; col: number }[] = [];

  for (const verts of transformedTris) {
    const Ys = verts.map((p) => p.Y);
    const minY = Math.min(...Ys);
    const maxY = Math.max(...Ys);

    // Each elementary triangle spans exactly 1 in Y in this coordinate system
    if (maxY - minY !== 1) continue;

    const low = verts.filter((p) => p.Y === minY);
    const high = verts.filter((p) => p.Y === maxY);

    if (low.length === 1 && high.length === 2) {
      // Up triangle: base at maxY, col = minX among base vertices, row = minY
      const col = Math.min(high[0].X, high[1].X);
      const row = minY;
      cellsOut.push({ row, col });
    } else if (low.length === 2 && high.length === 1) {
      // Down triangle: base at minY, col = minX among base vertices, row = minY
      const col = Math.min(low[0].X, low[1].X);
      const row = minY;
      cellsOut.push({ row, col });
    }
  }

  if (cellsOut.length === 0) return cells;

  // Normalize to positive row/col bounding box
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const p of cellsOut) {
    minRow = Math.min(minRow, p.row);
    maxRow = Math.max(maxRow, p.row);
    minCol = Math.min(minCol, p.col);
    maxCol = Math.max(maxCol, p.col);
  }

  // Base offsets to bring mins to 0
  const offRow = -minRow;
  let offCol = -minCol;

  // IMPORTANT: preserve (row+col)%2 orientation.
  // If offRow+offCol is odd, shift by 1 in col to maintain triangle parity.
  if (((offRow + offCol) & 1) !== 0) {
    offCol += 1;
  }

  const newHeight = maxRow + offRow + 1;
  const newWidth = maxCol + offCol + 1;

  const out: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );

  for (const p of cellsOut) {
    const r = p.row + offRow;
    const c = p.col + offCol;
    if (r >= 0 && r < newHeight && c >= 0 && c < newWidth) {
      out[r][c] = true;
    }
  }

  return out;
}

/**
 * Flip the polyform horizontally (simple array reverse).
 * Used for polyomino (square) grids where array reversal produces correct results.
 * For polyhex and polyiamond, use the geometry-correct transform functions instead.
 */
export function flipHorizontal(cells: boolean[][]): boolean[][] {
  return cells.map(row => [...row].reverse());
}

/**
 * Flip the polyform vertically (simple array reverse).
 * Used for polyomino (square) grids where array reversal produces correct results.
 * For polyhex and polyiamond, use the geometry-correct transform functions instead.
 */
export function flipVertical(cells: boolean[][]): boolean[][] {
  return [...cells].reverse();
}
