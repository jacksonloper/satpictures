import {
  type Int,
  type Matrix3x3,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type OrbifoldNode,
  type OrbifoldHalfEdge,
  type OrbifoldEdge,
  type OrbifoldGrid,
  type ExtraData,
  nodeIdFromCoord,
  matInvUnimodular,
} from "./orbifoldbasics";

export type WallpaperGroupType = "P1" | "P2" | "P3" | "P4" | "P4g" | "pgg";

export type EdgeLinestyle = "solid" | "dashed";

export interface ColorData extends ExtraData {
  color: "black" | "white";
}

export interface EdgeStyleData extends ExtraData {
  linestyle: EdgeLinestyle;
}

export type Direction = "N" | "S" | "E" | "W";

/**
 * Result from a getNeighbor function.
 * Returns null if this direction should not create an edge (e.g., P3/P4 S/E on border).
 */
export type NeighborResult = {
  coord: readonly [Int, Int];
  voltage: Matrix3x3;
  edgeKey: string;
  /**
   * Which polygon edge of the *source* node this half-edge uses.
   * For a square polygon: 0=N, 1=E, 2=S, 3=W.
   */
  fromPolygonEdgeIndex: number;
  /**
   * Which polygon edge of the *target* node this half-edge uses.
   * For a square polygon: 0=N, 1=E, 2=S, 3=W.
   */
  toPolygonEdgeIndex: number;
} | null;

export type NeighborFunction = (i: Int, j: Int, dir: Direction, n: Int) => NeighborResult;

/**
 * Create a translation matrix that translates by (dx, dy).
 * Using homogeneous coordinates, translation is represented as:
 * [1, 0, dx]
 * [0, 1, dy]
 * [0, 0, 1]
 */
export function translationMatrix(dx: Int, dy: Int): Matrix3x3 {
  return [
    [1, 0, dx],
    [0, 1, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a 180° rotation matrix around origin.
 * [−1,  0, 0]
 * [ 0, −1, 0]
 * [ 0,  0, 1]
 */
export const ROTATION_180: Matrix3x3 = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
] as const;

/**
 * Create a 90° clockwise rotation matrix around origin.
 * [ 0, 1, 0]
 * [−1, 0, 0]
 * [ 0, 0, 1]
 * 
 * Note: In our coordinate system where +y is down, this rotates (1,0) -> (0,1).
 */
export const ROTATION_90_CW: Matrix3x3 = [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
] as const;

/**
 * Create a 90° counter-clockwise rotation matrix around origin.
 * [0, −1, 0]
 * [1,  0, 0]
 * [0,  0, 1]
 */
export const ROTATION_90_CCW: Matrix3x3 = [
  [0, -1, 0],
  [1, 0, 0],
  [0, 0, 1],
] as const;

/**
 * Multiply translation by rotation: first rotate 180°, then translate.
 * This gives translation + 180° flip for P2 border edges.
 */
export function translationWith180(dx: Int, dy: Int): Matrix3x3 {
  // Combined: first rotate 180° around origin, then translate
  // Result: [-1, 0, dx], [0, -1, dy], [0, 0, 1]
  return [
    [-1, 0, dx],
    [0, -1, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a combined rotation (90° CW) + translation matrix.
 * First rotate 90° clockwise around origin, then translate by (dx, dy).
 * Result: [0, 1, dx], [-1, 0, dy], [0, 0, 1]
 */
export function translationWith90CW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [0, 1, dx],
    [-1, 0, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a combined rotation (90° CCW) + translation matrix.
 * First rotate 90° counter-clockwise around origin, then translate by (dx, dy).
 * Result: [0, -1, dx], [1, 0, dy], [0, 0, 1]
 */
export function translationWith90CCW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [0, -1, dx],
    [1, 0, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * 120° counter-clockwise rotation matrix in axial coordinates.
 * In axial coordinates (q, r), 120° CCW rotation maps (q, r) → (-q-r, q).
 * The matrix representation (using homogeneous coords):
 * [-1, -1, 0]
 * [ 1,  0, 0]
 * [ 0,  0, 1]
 * 
 * Note: The formula (q, r) → (-r, q+r) is 60° CCW (hexagonal).
 * 120° = 2 × 60° gives (q, r) → (-q-r, q).
 * 
 * Verify: R³ = I
 * - (1,0) → (-1,1) → (0,-1) → (1,0) ✓
 */
export const ROTATION_120_CCW: Matrix3x3 = [
  [-1, -1, 0],
  [1, 0, 0],
  [0, 0, 1],
] as const;

/**
 * 120° clockwise rotation matrix in axial coordinates.
 * Equivalent to 240° CCW. Maps (q, r) → (r, -q-r).
 * The matrix representation (using homogeneous coords):
 * [ 0,  1, 0]
 * [-1, -1, 0]
 * [ 0,  0, 1]
 * 
 * This is the inverse of ROTATION_120_CCW.
 */
export const ROTATION_120_CW: Matrix3x3 = [
  [0, 1, 0],
  [-1, -1, 0],
  [0, 0, 1],
] as const;

/**
 * Create a combined rotation (120° CCW) + translation matrix in axial coords.
 * First rotate 120° counter-clockwise around origin, then translate by (dx, dy).
 * 120° CCW: (q, r) → (-q-r, q)
 * Result: [-1, -1, dx], [1, 0, dy], [0, 0, 1]
 */
export function translationWith120CCW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [-1, -1, dx],
    [1, 0, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a combined rotation (120° CW / 240° CCW) + translation matrix in axial coords.
 * First rotate 120° clockwise around origin, then translate by (dx, dy).
 * 120° CW: (q, r) → (r, -q-r)
 * Result: [0, 1, dx], [-1, -1, dy], [0, 0, 1]
 */
export function translationWith120CW(dx: Int, dy: Int): Matrix3x3 {
  return [
    [0, 1, dx],
    [-1, -1, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Reflection across the y-axis (horizontal flip): x → -x, y → y
 * The y-axis serves as the mirror line.
 * Matrix: [-1, 0, 0], [0, 1, 0], [0, 0, 1]
 */
export const REFLECTION_Y: Matrix3x3 = [
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
] as const;

/**
 * Reflection across the x-axis (vertical flip): x → x, y → -y
 * The x-axis serves as the mirror line.
 * Matrix: [1, 0, 0], [0, -1, 0], [0, 0, 1]
 */
export const REFLECTION_X: Matrix3x3 = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
] as const;

/**
 * Create a glide reflection: reflect across y-axis then translate.
 * First reflect x → -x (using y-axis as mirror), then translate by (dx, dy).
 * Result: [-1, 0, dx], [0, 1, dy], [0, 0, 1]
 * 
 * For pgg, the north/south boundaries use this glide reflection (flip x-coords).
 */
export function glideReflectionY(dx: Int, dy: Int): Matrix3x3 {
  return [
    [-1, 0, dx],
    [0, 1, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Create a glide reflection: reflect across x-axis then translate.
 * First reflect y → -y (using x-axis as mirror), then translate by (dx, dy).
 * Result: [1, 0, dx], [0, -1, dy], [0, 0, 1]
 * 
 * For pgg, the east/west boundaries use this glide reflection (flip y-coords).
 */
export function glideReflectionX(dx: Int, dy: Int): Matrix3x3 {
  return [
    [1, 0, dx],
    [0, -1, dy],
    [0, 0, 1],
  ] as const;
}

/**
 * Get odd coordinates for a given grid index.
 * For index i in [0, n-1], the odd coordinate is 2*i + 1.
 */
function getOddCoord(index: Int): Int {
  return 2 * index + 1;
}

/**
 * Get grid index from odd coordinate.
 * For odd coordinate c, the index is (c - 1) / 2.
 */
function getIndexFromOddCoord(coord: Int): Int {
  return (coord - 1) / 2;
}

/**
 * Create the square polygon for a node at odd integer coordinates (i, j).
 * Vertices: (i-1,j-1), (i+1,j-1), (i+1,j+1), (i-1,j+1)
 * Polygon edges: 0=North (top), 1=East (right), 2=South (bottom), 3=West (left)
 */
export function squarePolygon(i: number, j: number): readonly (readonly [number, number])[] {
  return [
    [i - 1, j - 1],
    [i + 1, j - 1],
    [i + 1, j + 1],
    [i - 1, j + 1],
  ] as const;
}

/**
 * Map a cardinal direction to the corresponding polygon edge index
 * for a square polygon with edges: 0=North, 1=East, 2=South, 3=West.
 */
export function directionToPolygonEdge(dir: Direction): number {
  switch (dir) {
    case "N": return 0;
    case "E": return 1;
    case "S": return 2;
    case "W": return 3;
  }
}

/**
 * Return the opposite polygon edge index for a square polygon.
 * N(0)↔S(2), E(1)↔W(3).
 */
export function oppositePolygonEdge(edge: number): number {
  return (edge + 2) % 4;
}

/**
 * Create an orbifold grid for n×n nodes where each node has N/S/E/W neighbors.
 */
export function createSquareOrbifoldGrid(
  n: Int,
  getNeighbor: NeighborFunction,
  initialColors?: ("black" | "white")[][]
): OrbifoldGrid<ColorData, EdgeStyleData> {
  if (n < 2) {
    throw new Error("Grid size n must be at least 2");
  }

  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ColorData>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>();

  // Create nodes with odd integer coordinates
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = getOddCoord(col); // x coordinate (column)
      const j = getOddCoord(row); // y coordinate (row)
      const coord: readonly [Int, Int] = [i, j];
      const id = nodeIdFromCoord(coord);

      // Default color or use provided initial color
      const color = initialColors?.[row]?.[col] ?? "white";

      nodes.set(id, {
        id,
        coord,
        polygon: squarePolygon(i, j),
        data: { color },
      });
    }
  }

  // Create edges (N, S, E, W for each node)
  // The getNeighbor functions provide edge keys and may return null
  // to indicate that an edge should not be created (e.g., P3/P4 S/E on border)
  const processedEdges = new Set<string>();

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = getOddCoord(col);
      const j = getOddCoord(row);
      const fromId = nodeIdFromCoord([i, j]);

      // Process all 4 directions
      for (const dir of ["N", "S", "E", "W"] as Direction[]) {
        const result = getNeighbor(i, j, dir, n);

        // Skip if this direction returns null (edge already created from other side)
        if (result === null) {
          continue;
        }

        const { coord: toCoord, voltage, edgeKey, fromPolygonEdgeIndex, toPolygonEdgeIndex } = result;
        const toId = nodeIdFromCoord(toCoord);

        // Skip if this edge has already been created (either by a previous direction or by the other endpoint)
        if (processedEdges.has(edgeKey)) {
          continue;
        }
        processedEdges.add(edgeKey);

        // Edge ID is just the edge key with -- separators for readability
        const edgeId = edgeKey.replace(/\|/g, "--");

        // Check if this is a self-loop (same node)
        if (fromId === toId) {
          // Self-loop: single half-edge with involutive voltage
          const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
          halfEdges.set(fromId, { to: fromId, voltage, polygonEdgeIndex: fromPolygonEdgeIndex });

          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
            data: { linestyle: "solid" },
          });
        } else {
          // Regular edge: two half-edges with inverse voltages
          const inverseVoltage = matInvUnimodular(voltage);

          const halfEdges = new Map<OrbifoldNodeId, OrbifoldHalfEdge>();
          halfEdges.set(fromId, { to: toId, voltage, polygonEdgeIndex: fromPolygonEdgeIndex });
          halfEdges.set(toId, { to: fromId, voltage: inverseVoltage, polygonEdgeIndex: toPolygonEdgeIndex });

          edges.set(edgeId, {
            id: edgeId,
            halfEdges,
            data: { linestyle: "solid" },
          });
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * Update the color of a node in the orbifold grid.
 */
export function setNodeColor(
  grid: OrbifoldGrid<ColorData>,
  row: Int,
  col: Int,
  color: "black" | "white"
): void {
  const i = getOddCoord(col);
  const j = getOddCoord(row);
  const id = nodeIdFromCoord([i, j]);

  const node = grid.nodes.get(id);
  if (node) {
    node.data = { color };
  }
}

/**
 * Get the color of a node in the orbifold grid.
 */
export function getNodeColor(
  grid: OrbifoldGrid<ColorData>,
  row: Int,
  col: Int
): "black" | "white" {
  const i = getOddCoord(col);
  const j = getOddCoord(row);
  const id = nodeIdFromCoord([i, j]);

  const node = grid.nodes.get(id);
  return node?.data?.color ?? "white";
}

/**
 * Get the linestyle of an orbifold edge.
 */
export function getEdgeLinestyle(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  edgeId: OrbifoldEdgeId
): EdgeLinestyle {
  const edge = grid.edges.get(edgeId);
  return edge?.data?.linestyle ?? "solid";
}

/**
 * Set the linestyle of an orbifold edge.
 */
export function setEdgeLinestyle(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  edgeId: OrbifoldEdgeId,
  linestyle: EdgeLinestyle
): void {
  const edge = grid.edges.get(edgeId);
  if (edge) {
    edge.data = { linestyle };
  }
}

/**
 * Convert orbifold node coordinates to grid position.
 * Returns { row, col } in 0-indexed grid coordinates.
 */
export function coordToGridPos(coord: readonly [Int, Int]): { row: Int; col: Int } {
  const [i, j] = coord;
  return {
    col: getIndexFromOddCoord(i),
    row: getIndexFromOddCoord(j),
  };
}
