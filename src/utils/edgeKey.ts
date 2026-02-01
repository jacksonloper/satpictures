/** 
 * Represents an edge between two adjacent cells.
 * An edge is stored as a canonical key "row1,col1|row2,col2" where (row1,col1) < (row2,col2) lexicographically.
 * Note: We use '|' as the separator (not '-') to support negative coordinates.
 */
export type EdgeKey = string;

/** Parsed edge key coordinates */
export interface ParsedEdgeKey {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** Create canonical edge key between two adjacent cells */
export function makeEdgeKey(row1: number, col1: number, row2: number, col2: number): EdgeKey {
  // Ensure canonical ordering
  if (row1 < row2 || (row1 === row2 && col1 < col2)) {
    return `${row1},${col1}|${row2},${col2}`;
  }
  return `${row2},${col2}|${row1},${col1}`;
}

/** Parse an edge key string into coordinates */
export function parseEdgeKey(key: EdgeKey): ParsedEdgeKey | null {
  // Try new format with | separator (supports negative numbers)
  const match = key.match(/^(-?\d+),(-?\d+)[|](-?\d+),(-?\d+)$/);
  if (!match) {
    // Try old format with - separator (only works with non-negative numbers)
    const oldMatch = key.match(/^(\d+),(\d+)-(\d+),(\d+)$/);
    if (!oldMatch) return null;
    const r1 = parseInt(oldMatch[1], 10);
    const c1 = parseInt(oldMatch[2], 10);
    const r2 = parseInt(oldMatch[3], 10);
    const c2 = parseInt(oldMatch[4], 10);
    if ([r1, c1, r2, c2].some(isNaN)) return null;
    return { r1, c1, r2, c2 };
  }
  
  const r1 = parseInt(match[1], 10);
  const c1 = parseInt(match[2], 10);
  const r2 = parseInt(match[3], 10);
  const c2 = parseInt(match[4], 10);
  
  if ([r1, c1, r2, c2].some(isNaN)) return null;
  return { r1, c1, r2, c2 };
}
