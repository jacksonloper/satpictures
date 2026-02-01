/** 
 * Represents an edge between two adjacent cells.
 * An edge is stored as a canonical key "row1,col1-row2,col2" where (row1,col1) < (row2,col2) lexicographically.
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
    return `${row1},${col1}-${row2},${col2}`;
  }
  return `${row2},${col2}-${row1},${col1}`;
}

/** Parse an edge key string into coordinates */
export function parseEdgeKey(key: EdgeKey): ParsedEdgeKey | null {
  const parts = key.split('-');
  if (parts.length !== 2) return null;
  const [p1, p2] = parts;
  const [r1, c1] = p1.split(',').map(Number);
  const [r2, c2] = p2.split(',').map(Number);
  if ([r1, c1, r2, c2].some(isNaN)) return null;
  return { r1, c1, r2, c2 };
}
