/**
 * Wallpaper group definitions for square lattices.
 * 
 * Each wallpaper group defines:
 * - How many "types" of copies exist (e.g., P1 has 1 type, P2 has 2 types, P4 has 4 types)
 * - How to transform a cell's position based on the copy type
 * - How to transform directions (for edge connections)
 * - How boundaries wrap in the fundamental domain
 */

export type WallpaperGroupName = "P1" | "P2" | "pgg" | "P3" | "P4";

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
 * pgg wallpaper group: glide reflections
 * 
 * In pgg on a square lattice, there are 4 types of copies based on position:
 * - (0,0): fundamental domain (identity)
 * - (1,0): horizontal flip (col → length-1-col)
 * - (0,1): vertical flip (row → length-1-row)
 * - (1,1): 180° rotation
 * 
 * Copy type is determined by (copyRow % 2, copyCol % 2).
 * 
 * Boundary wrapping is torus-like but with flips:
 * - West of (k, 0) wraps to (length-k-1, length-1)
 * - North of (0, k) wraps to (length-1, length-k-1)
 * - Similarly for east and south edges
 */
export const pgg: WallpaperGroup = {
  name: "pgg" as WallpaperGroupName,
  numTypes: 4,
  
  getType(copyRow: number, copyCol: number): number {
    // Type based on (copyRow % 2, copyCol % 2):
    // (0,0) → 0 (fundamental)
    // (1,0) → 1 (horizontal flip)
    // (0,1) → 2 (vertical flip)
    // (1,1) → 3 (180° rotation)
    return (copyRow % 2) + 2 * (copyCol % 2);
  },
  
  transformPosition(row: number, col: number, length: number, type: number): { row: number; col: number } {
    switch (type) {
      case 0: // Fundamental (identity)
        return { row, col };
      case 1: // Horizontal flip (flip column)
        return { row, col: length - 1 - col };
      case 2: // Vertical flip (flip row)
        return { row: length - 1 - row, col };
      case 3: // 180° rotation
        return { row: length - 1 - row, col: length - 1 - col };
      default:
        return { row, col };
    }
  },
  
  inverseTransformPosition(visualRow: number, visualCol: number, length: number, type: number): { row: number; col: number } {
    // All transforms are self-inverse (flips and 180° rotation)
    return this.transformPosition(visualRow, visualCol, length, type);
  },
  
  transformDirection(dir: Direction, type: number): Direction {
    switch (type) {
      case 0: // Fundamental (identity)
        return dir;
      case 1: // Horizontal flip - E↔W, N/S stay
        if (dir === "E") return "W";
        if (dir === "W") return "E";
        return dir;
      case 2: // Vertical flip - N↔S, E/W stay
        if (dir === "N") return "S";
        if (dir === "S") return "N";
        return dir;
      case 3: { // 180° rotation - all directions flip
        const flipMap: Record<Direction, Direction> = {
          "N": "S", "S": "N", "E": "W", "W": "E"
        };
        return flipMap[dir];
      }
      default:
        return dir;
    }
  },
  
  getWrappedNeighbor(row: number, col: number, dir: Direction, length: number): FundamentalCell {
    switch (dir) {
      case "N":
        if (row === 0) {
          // North of (0, k) wraps to (length-1, length-k-1)
          return { row: length - 1, col: length - col - 1 };
        }
        return { row: row - 1, col };
      
      case "S":
        if (row === length - 1) {
          // South of (length-1, k) wraps to (0, length-k-1)
          return { row: 0, col: length - col - 1 };
        }
        return { row: row + 1, col };
      
      case "W":
        if (col === 0) {
          // West of (k, 0) wraps to (length-k-1, length-1)
          return { row: length - row - 1, col: length - 1 };
        }
        return { row, col: col - 1 };
      
      case "E":
        if (col === length - 1) {
          // East of (k, length-1) wraps to (length-k-1, 0)
          return { row: length - row - 1, col: 0 };
        }
        return { row, col: col + 1 };
    }
  },
};

/**
 * P3 wallpaper group: 3-fold rotational symmetry
 * 
 * In P3 on a square lattice (to be sheared into rhombus for rendering),
 * there are 3 types of copies with 0°, 120°, and 240° rotations.
 * 
 * The fundamental domain wraps with these rules:
 * - North of (0, k) wraps to (length-1-k, length-1)
 * - East of (length-1-k, length-1) wraps to (0, k)
 * - West of (k, 0) wraps to (length-1, length-1-k)
 * - South of (length-1, k) wraps to (k, 0)
 * 
 * Copy type is determined by (copyRow + copyCol) % 3
 */
export const P3: WallpaperGroup = {
  name: "P3" as WallpaperGroupName,
  numTypes: 3,
  
  getType(copyRow: number, copyCol: number): number {
    // Type based on (copyRow + copyCol) % 3:
    // Type 0: 0° rotation (fundamental)
    // Type 1: 120° rotation
    // Type 2: 240° rotation
    return ((copyRow + copyCol) % 3 + 3) % 3;
  },
  
  transformPosition(row: number, col: number, length: number, type: number): { row: number; col: number } {
    // For P3, positions are transformed by 120° rotations
    // In a rhombus grid, 120° rotation maps (row, col) in specific ways
    // Using the formulas for hexagonal/triangular grid rotation:
    // Type 0: identity
    // Type 1: 120° clockwise rotation
    // Type 2: 240° clockwise rotation (or 120° counter-clockwise)
    switch (type) {
      case 0: // Identity
        return { row, col };
      case 1: // 120° rotation: (row, col) -> (length-1-col, row+col - (length-1))
        // This maps the rhombus to itself with 120° rotation
        // Actually for a square grid that will be sheared:
        // (row, col) -> (col, length-1-row) then adjusted
        return { row: col, col: length - 1 - row };
      case 2: // 240° rotation: apply 120° twice
        // (row, col) -> (length-1-row, length-1-col) adjusted for 240°
        return { row: length - 1 - col, col: row };
      default:
        return { row, col };
    }
  },
  
  inverseTransformPosition(visualRow: number, visualCol: number, length: number, type: number): { row: number; col: number } {
    // Inverse of the transformations above
    switch (type) {
      case 0: // Identity inverse is identity
        return { row: visualRow, col: visualCol };
      case 1: // Inverse of 120° is 240°
        return { row: length - 1 - visualCol, col: visualRow };
      case 2: // Inverse of 240° is 120°
        return { row: visualCol, col: length - 1 - visualRow };
      default:
        return { row: visualRow, col: visualCol };
    }
  },
  
  transformDirection(dir: Direction, type: number): Direction {
    // For P3, directions rotate by 120° increments
    // On a square grid (before shearing), we approximate:
    // Type 0: identity
    // Type 1: N->E, E->S, S->W, W->N (90° as approximation, but actually...)
    // For the rhombus/hexagonal-like behavior:
    // Type 1 (120°): N->SE (approximated as E), E->SW (approximated as S), S->NW (approximated as W), W->NE (approximated as N)
    // Type 2 (240°): Apply twice
    
    // Since we're working on a square grid, we use 90° rotations as a stand-in:
    // This will be correct for the adjacency relationships even if not geometrically exact
    if (type === 0) return dir;
    
    // 120° ~ N->E, E->S, S->W, W->N (clockwise 90° as approximation)
    const rotate90: Record<Direction, Direction> = {
      "N": "E", "E": "S", "S": "W", "W": "N"
    };
    
    if (type === 1) {
      return rotate90[dir];
    } else { // type === 2
      // Apply 90° twice for 180° rotation as approximation of 240° on square grid
      return rotate90[rotate90[dir]];
    }
  },
  
  getWrappedNeighbor(row: number, col: number, dir: Direction, length: number): FundamentalCell {
    // P3 boundary wrapping:
    // - North of (0, k) wraps to (length-1-k, length-1)
    // - East of (length-1-k, length-1) wraps to (0, k) - but we need to express this for (row, length-1) going E
    //   If col = length-1 and we go E, then we're at (row, length-1), and E wraps to (0, length-1-row)
    // - West of (k, 0) wraps to (length-1, length-1-k)
    // - South of (length-1, k) wraps to (k, 0)
    
    switch (dir) {
      case "N":
        if (row === 0) {
          // North of (0, k) wraps to (length-1-k, length-1)
          return { row: length - 1 - col, col: length - 1 };
        }
        return { row: row - 1, col };
      
      case "S":
        if (row === length - 1) {
          // South of (length-1, k) wraps to (length-1-k, 0)
          return { row: length - 1 - col, col: 0 };
        }
        return { row: row + 1, col };
      
      case "W":
        if (col === 0) {
          // West of (k, 0) wraps to (length-1, length-1-k)
          return { row: length - 1, col: length - 1 - row };
        }
        return { row, col: col - 1 };
      
      case "E":
        if (col === length - 1) {
          // East of (row, length-1) wraps to (0, length-1-row)
          return { row: 0, col: length - 1 - row };
        }
        return { row, col: col + 1 };
    }
  },
};

/**
 * P4 wallpaper group: 4-fold rotational symmetry
 * 
 * In P4 on a square lattice, there are 4 types of copies with 0°, 90°, 180°, 270° rotations.
 * 
 * Copy type is determined by (copyRow % 2, copyCol % 2):
 * - (0, 0) → 0 (0° rotation, identity)
 * - (0, 1) → 1 (90° clockwise rotation)
 * - (1, 1) → 2 (180° rotation)
 * - (1, 0) → 3 (270° clockwise rotation)
 * 
 * Boundary wrapping follows the 4-fold rotation pattern:
 * - North edge wraps to West edge (rotated)
 * - East edge wraps to North edge (rotated)
 * - South edge wraps to East edge (rotated)
 * - West edge wraps to South edge (rotated)
 */
export const P4: WallpaperGroup = {
  name: "P4" as WallpaperGroupName,
  numTypes: 4,
  
  getType(copyRow: number, copyCol: number): number {
    // Type based on (copyRow % 2, copyCol % 2):
    // a = copyCol % 2, b = copyRow % 2
    // (0, 0) → 0, (0, 1) → 1, (1, 1) → 2, (1, 0) → 3
    // Use ((x % 2) + 2) % 2 to handle negative values correctly
    const a = ((copyCol % 2) + 2) % 2;
    const b = ((copyRow % 2) + 2) % 2;
    
    // Maps (a, b) to type: b * 2 + a gives the correct pattern
    return b * 2 + a;
  },
  
  transformPosition(row: number, col: number, length: number, type: number): { row: number; col: number } {
    // Apply 90° counter-clockwise rotation 'type' times
    // 0°: (row, col) -> (row, col)
    // 90° CCW: (row, col) -> (length-1-col, row)
    // 180°: (row, col) -> (length-1-row, length-1-col)
    // 270° CCW: (row, col) -> (col, length-1-row)
    switch (type) {
      case 0: // Identity
        return { row, col };
      case 1: // 90° counter-clockwise
        return { row: length - 1 - col, col: row };
      case 2: // 180°
        return { row: length - 1 - row, col: length - 1 - col };
      case 3: // 270° counter-clockwise
        return { row: col, col: length - 1 - row };
      default:
        return { row, col };
    }
  },
  
  inverseTransformPosition(visualRow: number, visualCol: number, length: number, type: number): { row: number; col: number } {
    // Inverse of 90° CCW rotations:
    // Inverse of 0° is 0°
    // Inverse of 90° CCW is 270° CCW (or 90° CW)
    // Inverse of 180° is 180°
    // Inverse of 270° CCW is 90° CCW
    switch (type) {
      case 0: // Identity
        return { row: visualRow, col: visualCol };
      case 1: // Inverse of 90° CCW is 270° CCW
        return { row: visualCol, col: length - 1 - visualRow };
      case 2: // 180° is its own inverse
        return { row: length - 1 - visualRow, col: length - 1 - visualCol };
      case 3: // Inverse of 270° CCW is 90° CCW
        return { row: length - 1 - visualCol, col: visualRow };
      default:
        return { row: visualRow, col: visualCol };
    }
  },
  
  transformDirection(dir: Direction, type: number): Direction {
    // Rotate direction by 90° counter-clockwise 'type' times
    // 90° CCW: N->W, W->S, S->E, E->N
    const rotate90CCW: Record<Direction, Direction> = {
      "N": "W", "W": "S", "S": "E", "E": "N"
    };
    
    let result = dir;
    for (let i = 0; i < type; i++) {
      result = rotate90CCW[result];
    }
    return result;
  },
  
  getWrappedNeighbor(row: number, col: number, dir: Direction, length: number): FundamentalCell {
    // P4 boundary wrapping - same as P3 (both are topological spheres with 3 punctures):
    // - North of (0, k) wraps to (length-1-k, length-1)
    // - South of (length-1, k) wraps to (length-1-k, 0)
    // - West of (k, 0) wraps to (length-1, length-1-k)
    // - East of (row, length-1) wraps to (0, length-1-row)
    
    switch (dir) {
      case "N":
        if (row === 0) {
          // North of (0, k) wraps to (length-1-k, length-1)
          return { row: length - 1 - col, col: length - 1 };
        }
        return { row: row - 1, col };
      
      case "S":
        if (row === length - 1) {
          // South of (length-1, k) wraps to (length-1-k, 0)
          return { row: length - 1 - col, col: 0 };
        }
        return { row: row + 1, col };
      
      case "W":
        if (col === 0) {
          // West of (k, 0) wraps to (length-1, length-1-k)
          return { row: length - 1, col: length - 1 - row };
        }
        return { row, col: col - 1 };
      
      case "E":
        if (col === length - 1) {
          // East of (row, length-1) wraps to (0, length-1-row)
          return { row: 0, col: length - 1 - row };
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
    case "pgg": return pgg;
    case "P3": return P3;
    case "P4": return P4;
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
