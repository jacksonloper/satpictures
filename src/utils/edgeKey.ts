/** 
 * Represents an edge between two adjacent cells.
 * An edge is stored as a canonical key "row1,col1-row2,col2" where (row1,col1) < (row2,col2) lexicographically.
 */
export type EdgeKey = string;

/** Create canonical edge key between two adjacent cells */
export function makeEdgeKey(row1: number, col1: number, row2: number, col2: number): EdgeKey {
  // Ensure canonical ordering
  if (row1 < row2 || (row1 === row2 && col1 < col2)) {
    return `${row1},${col1}-${row2},${col2}`;
  }
  return `${row2},${col2}-${row1},${col1}`;
}
