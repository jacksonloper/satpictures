import {
  type Int,
  type Matrix3x3,
  I3,
  nodeIdFromCoord,
  matInvUnimodular,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type OrbifoldNode,
  type OrbifoldEdge,
  type OrbifoldGrid,
} from "./orbifoldbasics";
import {
  type ColorData,
  type EdgeStyleData,
  translationMatrix,
  translationWith180,
} from "./orbifoldShared";

/**
 * P2hex: P2 wallpaper group with hexagonal tiling (axial coordinates).
 *
 * Each node represents a hexagon (in Cartesian space after axial transform).
 * In axial coordinates, hexagons tile with 6 neighbors: +x, -x, +y, -y, (+x,-y), (-x,+y).
 *
 * The fundamental domain is an n×n grid of hexagons in axial coords.
 * Boundary crossings have 180° rotation voltages (like P2).
 *
 * In axial hex coordinates, the 6 directions are:
 * - E  (+x):     (x+1, y)
 * - W  (-x):     (x-1, y)
 * - S  (+y):     (x, y+1)
 * - N  (-y):     (x, y-1)
 * - NE (+x,-y):  (x+1, y-1)
 * - SW (-x,+y):  (x-1, y+1)
 *
 * Hexagon polygon (before axial transform):
 * In axial coords, we use a parallelogram-like shape that transforms to a hexagon.
 * The vertices in clockwise order form a hexagon after axialToCartesian transform.
 *
 * Boundary structure:
 * - North boundary (y=minCoord): wraps with 180° rotation
 * - South boundary (y=maxCoord): wraps with 180° rotation
 * - West boundary (x=minCoord): wraps with 180° rotation
 * - East boundary (x=maxCoord): wraps with 180° rotation
 * - NW corner (minCoord, minCoord) connects to SE corner (maxCoord, maxCoord) with pure translation
 */

type HexDirection = "E" | "W" | "N" | "S" | "NE" | "SW";

/**
 * Build a hexagon polygon in axial coordinates that will look like a hexagon
 * after the axialToCartesian transform.
 *
 * In axial coords, a regular hexagon centered at (i, j) has vertices at
 * offsets that form a hexagon in Cartesian space.
 *
 * For axial hex with pointy-top orientation after transform:
 * The six vertices in clockwise order (starting from top):
 *   (i, j-2/3), (i+1/2, j-1/3), (i+1/2, j+1/3), (i, j+2/3), (i-1/2, j+1/3), (i-1/2, j-1/3)
 *
 * But we need integer coordinates, so we scale up by 6. Using 6-unit spacing:
 * Center at (6*col+3, 6*row+3), vertices at ±3 in various directions.
 *
 * Polygon sides (clockwise from top vertex):
 * 0: Top-right (connects to NE neighbor)
 * 1: Right (connects to E neighbor)
 * 2: Bottom-right (connects to SE neighbor → S in axial)
 * 3: Bottom-left (connects to SW neighbor)
 * 4: Left (connects to W neighbor)
 * 5: Top-left (connects to NW neighbor → N in axial)
 */
function hexPolygon(i: Int, j: Int): readonly (readonly [number, number])[] {
  // Hexagon vertices in axial coordinates (will become regular hexagon after transform)
  // Scaled by 3 from center for integer coords with 6-unit spacing
  // Starting from top vertex, going clockwise
  //
  // In axial coords, a pointy-top hex has vertices at these offsets from center:
  //   Top: (0, -1) * scale
  //   Top-right: (1, -1) * scale/2 → but we need integers, so use 2-unit scale
  //
  // Using a different approach: vertices form a parallelogram-ish shape in axial coords
  // that becomes a hexagon after transform.
  //
  // After axialToCartesian: x' = x + y/2, y' = y * sqrt(3)/2
  //
  // For a regular hexagon centered at origin with "radius" r:
  //   Vertices in Cartesian: r*[cos(30° + k*60°), sin(30° + k*60°)] for k=0..5
  //
  // In axial coords (with unit = 2 for integers), the hexagon vertices are:
  //   From center (i,j), offset by these axial vectors scaled:
  //   Top:       (0, -2)
  //   Top-right: (2, -2) → transforms to (2 + (-2)/2, -2*√3/2) = (1, -√3)
  //   Right:     (2, 0)  → transforms to (2 + 0, 0) = (2, 0)
  //   etc.
  //
  // Actually, for hexagonal tiling in axial coordinates:
  // The hex shape in axial coords should have 6 equal-length sides after transform.
  //
  // Simpler: define vertices in axial coords that become regular hexagon.
  // With step=6, hex radius in axial = 2 gives good integers.
  //
  // Vertices (clockwise from N, with center at (i,j)):
  return [
    [i, j - 2],       // N (top) - side 0 connects N to NE
    [i + 2, j - 2],   // NE - side 1 connects NE to E
    [i + 2, j],       // E (right) - side 2 connects E to SE
    [i, j + 2],       // S (bottom) - side 3 connects S to SW
    [i - 2, j + 2],   // SW - side 4 connects SW to W
    [i - 2, j],       // W (left) - side 5 connects W to N
  ] as const;
}

/**
 * Map hex direction to polygon side index.
 * Polygon sides in clockwise order from N:
 * 0: N→NE (top-right side)
 * 1: NE→E (right-top side)
 * 2: E→S (right-bottom side) - note: goes from E to S, connects to SE neighbor
 * 3: S→SW (bottom-left side)
 * 4: SW→W (left-bottom side)
 * 5: W→N (left-top side)
 *
 * Edges:
 * - NE direction: uses side 0 (from) and side 3 (to, the SW side of target)
 * - E direction: uses side 1+2 midpoint → side 1 for connection
 * - etc.
 *
 * Actually, for 6-neighbor hex, each edge connects one polygon side to one side on neighbor.
 * In axial coords:
 * - N neighbor (0, -1): uses top portion → side 0 (connects to their side 3)
 * - NE neighbor (+1, -1): uses side 0/1 → side 0 for us
 * - E neighbor (+1, 0): uses side 1 or 2
 * - S neighbor (0, +1): uses side 3 (connects to their side 0)
 * - SW neighbor (-1, +1): uses side 4
 * - W neighbor (-1, 0): uses side 5
 *
 * Let me re-examine the polygon:
 * Vertices: N, NE, E, S, SW, W (6 vertices, 6 sides)
 * Side 0: N→NE
 * Side 1: NE→E
 * Side 2: E→S
 * Side 3: S→SW
 * Side 4: SW→W
 * Side 5: W→N
 *
 * Which sides connect to which neighbors?
 * - The N neighbor (above, +q direction in some hex conventions) uses the top side
 * - In axial coords with the polygon above:
 *   - N direction (x, y-1): neighbor is north, uses side 5 (W→N) as the connecting side? No...
 *
 * Let me think about this more carefully with the axial hex layout:
 * In axial coords (q,r) with our polygon vertices:
 *   N: (i, j-2), NE: (i+2, j-2), E: (i+2, j), S: (i, j+2), SW: (i-2, j+2), W: (i-2, j)
 *
 * The 6 axial neighbors are:
 *   E:  (i+1, j) → center moves +q, polygon shifts right
 *   W:  (i-1, j) → center moves -q
 *   S:  (i, j+1) → center moves +r (down in axial)
 *   N:  (i, j-1) → center moves -r (up in axial)
 *   NE: (i+1, j-1) → moves +q, -r (diagonal)
 *   SW: (i-1, j+1) → moves -q, +r (diagonal)
 *
 * With our polygon at 4-unit spacing (step=4, vertices at ±2):
 * Side assignment for neighbors:
 *   NE neighbor: shares the side going from vertex N to vertex NE? No, that's within our hex.
 *
 * Hmm, I think I need to reconsider. In hex tilings, each side of a hexagon
 * touches exactly one neighbor. With 6 neighbors in axial hex:
 *
 * Looking at a pointy-top hexagon in Cartesian (after axial transform):
 *   Side pointing NE (upper-right) → touches NE neighbor
 *   Side pointing E (right) → touches E neighbor
 *   Side pointing SE (lower-right) → but this is S neighbor in axial
 *   etc.
 *
 * Given our polygon vertices [N, NE, E, S, SW, W]:
 *   Side 0 (N→NE): faces the NE direction → connects to NE neighbor (i+1, j-1)
 *   Side 1 (NE→E): faces the E direction → connects to E neighbor (i+1, j)
 *   Side 2 (E→S): faces the SE direction → but that's S in axial → connects to S neighbor (i, j+1)
 *   Side 3 (S→SW): faces the SW direction → connects to SW neighbor (i-1, j+1)
 *   Side 4 (SW→W): faces the W direction → connects to W neighbor (i-1, j)
 *   Side 5 (W→N): faces the NW direction → but that's N in axial → connects to N neighbor (i, j-1)
 *
 * Wait, that's only 6 sides for 6 neighbors - perfect!
 */
const HEX_DIR_TO_SIDE: Record<HexDirection, number> = {
  NE: 0,  // Side 0: N→NE vertex
  E: 1,   // Side 1: NE→E vertex
  S: 2,   // Side 2: E→S vertex (SE in Cartesian, but S in axial)
  SW: 3,  // Side 3: S→SW vertex
  W: 4,   // Side 4: SW→W vertex
  N: 5,   // Side 5: W→N vertex (NW in Cartesian, but N in axial)
};

const OPPOSITE_HEX_DIR: Record<HexDirection, HexDirection> = {
  NE: "SW",
  E: "W",
  S: "N",
  SW: "NE",
  W: "E",
  N: "S",
};

interface HexNeighborResult {
  coord: readonly [Int, Int];
  voltage: Matrix3x3;
  edgeKey: string;
  targetSide?: number;
}

/**
 * Get the neighbor info for a given hex direction.
 * Uses 4-unit spacing: nodes at (4*col+2, 4*row+2).
 */
function getHexNeighbor(
  i: Int,
  j: Int,
  dir: HexDirection,
  n: Int
): HexNeighborResult | null {
  const step = 4;
  const minCoord = step / 2; // 2
  const maxCoord = step * (n - 1) + minCoord; // 4*(n-1)+2
  const L = step * n; // 4*n = size of fundamental domain
  const fromId = nodeIdFromCoord([i, j]);

  // Axial neighbor offsets
  const offsets: Record<HexDirection, readonly [Int, Int]> = {
    E: [step, 0],
    W: [-step, 0],
    S: [0, step],
    N: [0, -step],
    NE: [step, -step],
    SW: [-step, step],
  };

  const [di, dj] = offsets[dir];
  let ni = i + di;
  let nj = j + dj;

  // Check boundaries and compute voltage
  let voltage: Matrix3x3 = I3;
  let targetSide = HEX_DIR_TO_SIDE[OPPOSITE_HEX_DIR[dir]];

  // Handle boundary crossings with 180° rotation
  // P2 has 180° rotation centers at the boundary centers

  const onWestBorder = i === minCoord;
  const onEastBorder = i === maxCoord;
  const onNorthBorder = j === minCoord;
  const onSouthBorder = j === maxCoord;

  switch (dir) {
    case "N": {
      if (onNorthBorder) {
        // North border: 180° rotation, (i,j) maps to (L-i, minCoord)
        const reflectedI = L - i;
        ni = reflectedI;
        nj = minCoord;
        voltage = translationWith180(L, 0);
        // With 180° rotation, the edge arrives at the target's N side (same direction)
        targetSide = HEX_DIR_TO_SIDE["N"];
      }
      break;
    }
    case "S": {
      if (onSouthBorder) {
        // South border: 180° rotation
        const reflectedI = L - i;
        ni = reflectedI;
        nj = maxCoord;
        voltage = translationWith180(L, 2 * L);
        // With 180° rotation, arrives at target's S side
        targetSide = HEX_DIR_TO_SIDE["S"];
      }
      break;
    }
    case "E": {
      if (onEastBorder) {
        // East border: 180° rotation
        const reflectedJ = L - j;
        ni = maxCoord;
        nj = reflectedJ;
        voltage = translationWith180(2 * L, L);
        // With 180° rotation, arrives at target's E side
        targetSide = HEX_DIR_TO_SIDE["E"];
      }
      break;
    }
    case "W": {
      if (onWestBorder) {
        // West border: 180° rotation
        const reflectedJ = L - j;
        ni = minCoord;
        nj = reflectedJ;
        voltage = translationWith180(0, L);
        // With 180° rotation, arrives at target's W side
        targetSide = HEX_DIR_TO_SIDE["W"];
      }
      break;
    }
    case "NE": {
      // NE goes from (i,j) to (i+step, j-step)
      // The target is only valid if it's within bounds OR at a specific corner
      // Boundary cases:
      // 1. NW corner going NE: pure translation to SE corner (special diagonal edge)
      // 2. NE corner going NE: wraps to SW corner with 180° rotation
      // 3. SE corner going NE: wraps to NW corner with 180° rotation (for side coverage)
      // 4. Non-corner boundary node: NE direction that would go out of bounds returns null
      
      const isNWCorner = onWestBorder && onNorthBorder;
      const isNECorner = onEastBorder && onNorthBorder;
      const isSECorner = onEastBorder && onSouthBorder;
      const wouldExitNorth = j - step < minCoord;
      const wouldExitEast = i + step > maxCoord;
      
      if (isNWCorner) {
        // NW corner (minCoord, minCoord) going NE: pure translation to SE corner
        // This is the special diagonal edge mentioned in the problem
        ni = maxCoord;
        nj = maxCoord;
        voltage = translationMatrix(L, L);
        // Pure translation: arriving at SE's SW side
        targetSide = HEX_DIR_TO_SIDE["SW"];
      } else if (isNECorner) {
        // NE corner (maxCoord, minCoord) going NE: wraps to SW corner (minCoord, maxCoord)
        // This involves both north and east boundary crossings with 180° rotation
        ni = minCoord;
        nj = maxCoord;
        voltage = translationWith180(2 * L, 0);
        // With 180° rotation, arriving at SW's SW side
        targetSide = HEX_DIR_TO_SIDE["SW"];
      } else if (isSECorner) {
        // SE corner (maxCoord, maxCoord) going NE: goes to NW corner via "wrap around"
        // This is a separate edge from the SW direction, covering SE's side 0 and NW's side 3
        ni = minCoord;
        nj = minCoord;
        voltage = translationWith180(2 * L, 2 * L);
        // Arriving at NW's SW side
        targetSide = HEX_DIR_TO_SIDE["SW"];
      } else if (wouldExitNorth || wouldExitEast) {
        // Non-corner node trying to go NE but would exit boundary
        // This edge doesn't exist in the orbifold
        return null;
      }
      // For interior nodes, use the default ni/nj = i+step, j-step
      break;
    }
    case "SW": {
      // SW goes from (i,j) to (i-step, j+step)
      // The target is only valid if it's within bounds OR at a specific corner
      // Boundary cases:
      // 1. SE corner going SW: pure translation to NW corner (inverse of NE case)
      // 2. SW corner going SW: wraps to NE corner with 180° rotation
      // 3. NW corner going SW: wraps to SE corner with 180° rotation (for side coverage)
      // 4. Non-corner boundary node: SW direction that would go out of bounds returns null
      
      const isSECorner = onEastBorder && onSouthBorder;
      const isSWCorner = onWestBorder && onSouthBorder;
      const isNWCorner = onWestBorder && onNorthBorder;
      const wouldExitSouth = j + step > maxCoord;
      const wouldExitWest = i - step < minCoord;
      
      if (isSECorner) {
        // SE corner (maxCoord, maxCoord) going SW: pure translation to NW corner
        ni = minCoord;
        nj = minCoord;
        voltage = translationMatrix(-L, -L);
        // Pure translation: arriving at NW's NE side
        targetSide = HEX_DIR_TO_SIDE["NE"];
      } else if (isSWCorner) {
        // SW corner (minCoord, maxCoord) going SW: wraps to NE corner (maxCoord, minCoord)
        ni = maxCoord;
        nj = minCoord;
        voltage = translationWith180(0, 2 * L);
        // With 180° rotation, arriving at NE's NE side
        targetSide = HEX_DIR_TO_SIDE["NE"];
      } else if (isNWCorner) {
        // NW corner (minCoord, minCoord) going SW: goes to SE corner via "wrap around"
        // This is a separate edge from the NE direction, covering NW's side 3 and SE's side 0
        // The voltage is the same 180° rotation that would result from going the "long way"
        ni = maxCoord;
        nj = maxCoord;
        voltage = translationWith180(0, 0);
        // Arriving at SE's NE side
        targetSide = HEX_DIR_TO_SIDE["NE"];
      } else if (wouldExitSouth || wouldExitWest) {
        // Non-corner node trying to go SW but would exit boundary
        // This edge doesn't exist in the orbifold
        return null;
      }
      // For interior nodes, use the default ni/nj = i-step, j+step
      break;
    }
  }

  // Check if target coordinate is within bounds (for interior edges)
  if (ni < minCoord || ni > maxCoord || nj < minCoord || nj > maxCoord) {
    // This shouldn't happen for properly handled boundary cases
    return null;
  }

  const toId = nodeIdFromCoord([ni, nj]);

  // Edge key: sorted node IDs + edge type label for disambiguation
  // Use common labels for opposite directions to avoid duplicate edges:
  // - N and S → |NS (vertical edges)
  // - E and W → |EW (horizontal edges)
  // - NE and SW → |NESW (diagonal edges)
  // Exception: for NW↔SE diagonal corners, use direction-specific labels since
  // there are TWO edges between them (one pure translation, one 180° rotation)
  const isNW_SE_diagonal = (fromId === nodeIdFromCoord([minCoord, minCoord]) && toId === nodeIdFromCoord([maxCoord, maxCoord])) ||
                           (fromId === nodeIdFromCoord([maxCoord, maxCoord]) && toId === nodeIdFromCoord([minCoord, minCoord]));
  
  let edgeTypeLabel: string;
  if (isNW_SE_diagonal) {
    // Use direction-specific label to distinguish the two diagonal edges
    edgeTypeLabel = dir; // "NE" or "SW"
  } else {
    const labels: Record<HexDirection, string> = {
      N: "NS",
      S: "NS",
      E: "EW",
      W: "EW",
      NE: "NESW",
      SW: "NESW",
    };
    edgeTypeLabel = labels[dir];
  }
  
  const edgeKey = fromId === toId
    ? `${fromId}|${dir}` // Self-edges keep direction for distinction
    : `${[fromId, toId].sort().join("|")}|${edgeTypeLabel}`;

  return { coord: [ni, nj] as const, voltage, edgeKey, targetSide };
}

/**
 * Add an orbifold edge, handling self-edges and deduplication.
 */
function addEdge(
  edges: Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>,
  processedEdges: Set<string>,
  nodes: Map<OrbifoldNodeId, OrbifoldNode<ColorData>>,
  fromId: OrbifoldNodeId,
  toId: OrbifoldNodeId,
  voltage: Matrix3x3,
  edgeKey: string,
  fromSides: number[],
  toSides: number[],
): void {
  if (!nodes.has(toId)) return;
  if (processedEdges.has(edgeKey)) return;
  processedEdges.add(edgeKey);

  const edgeId = edgeKey.replace(/\|/g, "--");

  if (fromId === toId) {
    // Self-edge
    const combinedSides = [...fromSides];
    for (const s of toSides) {
      if (!combinedSides.includes(s)) combinedSides.push(s);
    }
    const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3; polygonSides: number[] }>();
    halfEdges.set(fromId, { to: fromId, voltage, polygonSides: combinedSides });
    edges.set(edgeId, { id: edgeId, halfEdges, data: { linestyle: "solid" } });
  } else {
    const inverseVoltage = matInvUnimodular(voltage);
    const halfEdges = new Map<OrbifoldNodeId, { to: OrbifoldNodeId; voltage: Matrix3x3; polygonSides: number[] }>();
    halfEdges.set(fromId, { to: toId, voltage, polygonSides: fromSides });
    halfEdges.set(toId, { to: fromId, voltage: inverseVoltage, polygonSides: toSides });
    edges.set(edgeId, { id: edgeId, halfEdges, data: { linestyle: "solid" } });
  }
}

/**
 * Create a P2hex orbifold grid.
 *
 * P2hex is the P2 wallpaper group with hexagonal tiling in axial coordinates.
 * Each node is a hexagon with 6 neighbors. Boundary edges have 180° rotation
 * voltages, similar to the square P2.
 *
 * The grid uses 4-unit spacing: nodes at (4*col+2, 4*row+2).
 * Polygon vertices are at ±2 from center.
 *
 * @param n - Grid size (n×n hexagons). Must be at least 2 and even.
 * @param initialColors - Optional initial colors for each cell
 */
export function createP2hexGrid(n: Int, initialColors?: ("black" | "white")[][]): OrbifoldGrid<ColorData, EdgeStyleData> {
  if (n < 2) {
    throw new Error("P2hex grid size n must be at least 2");
  }
  if (n % 2 !== 0) {
    throw new Error("P2hex grid size n must be even");
  }

  const step = 4;
  const nodes = new Map<OrbifoldNodeId, OrbifoldNode<ColorData>>();
  const edges = new Map<OrbifoldEdgeId, OrbifoldEdge<EdgeStyleData>>();
  const processedEdges = new Set<string>();

  // Create nodes
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = step * col + step / 2;
      const j = step * row + step / 2;
      const coord: readonly [Int, Int] = [i, j];
      const id = nodeIdFromCoord(coord);
      const color = initialColors?.[row]?.[col] ?? "white";
      nodes.set(id, { id, coord, polygon: hexPolygon(i, j), data: { color } });
    }
  }

  // Create edges for all 6 directions
  const directions: HexDirection[] = ["E", "W", "N", "S", "NE", "SW"];

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = step * col + step / 2;
      const j = step * row + step / 2;
      const fromId = nodeIdFromCoord([i, j]);

      for (const dir of directions) {
        const result = getHexNeighbor(i, j, dir, n);
        if (!result) continue;

        const { coord, voltage, edgeKey, targetSide } = result;
        const toId = nodeIdFromCoord(coord);
        const fromSide = HEX_DIR_TO_SIDE[dir];
        const toSide = targetSide ?? HEX_DIR_TO_SIDE[OPPOSITE_HEX_DIR[dir]];

        addEdge(edges, processedEdges, nodes, fromId, toId, voltage, edgeKey, [fromSide], [toSide]);
      }
    }
  }

  return { nodes, edges };
}
