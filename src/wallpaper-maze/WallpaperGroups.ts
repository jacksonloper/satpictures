/**
 * Wallpaper group definitions for square lattices.
 * 
 * Each wallpaper group defines:
 * - How many "types" of copies exist (e.g., P1 has 1 type, P2 has 2 types, P4 has 4 types)
 * - How to transform a cell's position based on the copy type
 * - How to transform directions (for edge connections)
 * - How boundaries wrap in the fundamental domain
 */

export type WallpaperGroupName = "P1" | "P2";

// Direction type
export type Direction = "N" | "S" | "E" | "W";

// Cell position in fundamental domain
export interface FundamentalCell {
  row: number;
  col: number;
}

/**
 * Interface for wallpaper group transformations
 */
export interface WallpaperGroup {
  name: WallpaperGroupName;
  
  /**
   * Number of distinct types of copies
   * P1: 1 (all identical)
   * P2: 2 (unrotated and 180° rotated)
   * P4: 4 (0°, 90°, 180°, 270°)
   */
  numTypes: number;
  
  /**
   * Get the type for a copy at position (copyRow, copyCol)
   */
  getType(copyRow: number, copyCol: number): number;
  
  /**
   * Transform a position within a copy based on its type.
   * Returns the visual (absolute) position offset within the copy.
   * 
   * For P1: identity (row, col) -> (row, col)
   * For P2 type 1: (row, col) -> (length-1-row, length-1-col)
   */
  transformPosition(row: number, col: number, length: number, type: number): { row: number; col: number };
  
  /**
   * Inverse transform: given a visual position within a copy, get the fundamental domain coords.
   * Used when clicking on a visual position.
   */
  inverseTransformPosition(visualRow: number, visualCol: number, length: number, type: number): { row: number; col: number };
  
  /**
   * Transform a direction based on copy type.
   * For rotated copies, N becomes S, E becomes W, etc.
   */
  transformDirection(dir: Direction, type: number): Direction;
  
  /**
   * Get the wrapped neighbor in the fundamental domain.
   * This defines the topology of the fundamental domain itself.
   */
  getWrappedNeighbor(row: number, col: number, dir: Direction, length: number): FundamentalCell;
}

/**
 * P1 wallpaper group: simple torus (regular wrapping)
 */
export const P1: WallpaperGroup = {
  name: "P1",
  numTypes: 1,
  
  getType(): number {
    return 0; // All copies are the same
  },
  
  transformPosition(row: number, col: number): { row: number; col: number } {
    return { row, col }; // No transformation
  },
  
  inverseTransformPosition(visualRow: number, visualCol: number): { row: number; col: number } {
    return { row: visualRow, col: visualCol }; // No transformation
  },
  
  transformDirection(dir: Direction): Direction {
    return dir; // No transformation
  },
  
  getWrappedNeighbor(row: number, col: number, dir: Direction, length: number): FundamentalCell {
    switch (dir) {
      case "N": return { row: (row - 1 + length) % length, col };
      case "S": return { row: (row + 1) % length, col };
      case "E": return { row, col: (col + 1) % length };
      case "W": return { row, col: (col - 1 + length) % length };
    }
  },
};

/**
 * P2 wallpaper group: 180° rotation at boundaries
 * 
 * In a P2 group on a square lattice, copies alternate between unrotated (type 0)
 * and 180° rotated (type 1) in a checkerboard pattern.
 * 
 * Boundary wrapping for P2:
 * - Western edge of (row, 0) wraps to western edge of (length-1-row, 0)
 * - Eastern edge of (row, length-1) wraps to eastern edge of (length-1-row, length-1)
 * - Northern edge of (0, col) wraps to northern edge of (0, length-1-col)
 * - Southern edge of (length-1, col) wraps to southern edge of (length-1, length-1-col)
 */
export const P2: WallpaperGroup = {
  name: "P2",
  numTypes: 2,
  
  getType(copyRow: number, copyCol: number): number {
    // Checkerboard pattern: type 0 where (copyRow + copyCol) is even, type 1 where odd
    return (copyRow + copyCol) % 2;
  },
  
  transformPosition(row: number, col: number, length: number, type: number): { row: number; col: number } {
    if (type === 0) {
      return { row, col };
    } else {
      // 180° rotation
      return { row: length - 1 - row, col: length - 1 - col };
    }
  },
  
  inverseTransformPosition(visualRow: number, visualCol: number, length: number, type: number): { row: number; col: number } {
    // 180° rotation is its own inverse
    if (type === 0) {
      return { row: visualRow, col: visualCol };
    } else {
      return { row: length - 1 - visualRow, col: length - 1 - visualCol };
    }
  },
  
  transformDirection(dir: Direction, type: number): Direction {
    if (type === 0) {
      return dir;
    } else {
      // 180° rotation flips all directions
      const flipMap: Record<Direction, Direction> = {
        "N": "S", "S": "N", "E": "W", "W": "E"
      };
      return flipMap[dir];
    }
  },
  
  getWrappedNeighbor(row: number, col: number, dir: Direction, length: number): FundamentalCell {
    switch (dir) {
      case "N":
        if (row === 0) {
          // Top edge wraps with 180° rotation
          return { row: 0, col: length - 1 - col };
        }
        return { row: row - 1, col };
      
      case "S":
        if (row === length - 1) {
          // Bottom edge wraps with 180° rotation
          return { row: length - 1, col: length - 1 - col };
        }
        return { row: row + 1, col };
      
      case "W":
        if (col === 0) {
          // Western edge wraps with 180° rotation
          return { row: length - 1 - row, col: 0 };
        }
        return { row, col: col - 1 };
      
      case "E":
        if (col === length - 1) {
          // Eastern edge wraps with 180° rotation
          return { row: length - 1 - row, col: length - 1 };
        }
        return { row, col: col + 1 };
    }
  },
};

/**
 * Get wallpaper group by name
 */
export function getWallpaperGroup(name: WallpaperGroupName): WallpaperGroup {
  switch (name) {
    case "P1": return P1;
    case "P2": return P2;
  }
}

/**
 * All 4 directions
 */
export const ALL_DIRECTIONS: Direction[] = ["N", "S", "E", "W"];

/**
 * Delta for each direction
 */
export const DIRECTION_DELTA: Record<Direction, { dRow: number; dCol: number }> = {
  "N": { dRow: -1, dCol: 0 },
  "S": { dRow: 1, dCol: 0 },
  "E": { dRow: 0, dCol: 1 },
  "W": { dRow: 0, dCol: -1 },
};

/**
 * Opposite direction
 */
export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  "N": "S",
  "S": "N",
  "E": "W",
  "W": "E",
};
