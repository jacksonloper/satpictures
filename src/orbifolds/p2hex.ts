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
 * With step=6, the hex vertices are computed as centroids of the three hexagons
 * meeting at each corner, which guarantees integer coordinates.
 *
 * The 6 neighbors of (i, j) with step=6 are at:
 *   E:  (i+6, j)
 *   NE: (i+6, j-6)
 *   N:  (i, j-6)
 *   W:  (i-6, j)
 *   SW: (i-6, j+6)
 *   S:  (i, j+6)
 *
 * Vertices (clockwise from v0 at E-NE corner):
 *   v0: centroid of (i,j), (i+6,j), (i+6,j-6)  = (i+4, j-2)   -- between E and NE
 *   v1: centroid of (i,j), (i+6,j-6), (i,j-6)  = (i+2, j-4)   -- between NE and N
 *   v2: centroid of (i,j), (i,j-6), (i-6,j)    = (i-2, j-2)   -- between N and W
 *   v3: centroid of (i,j), (i-6,j), (i-6,j+6)  = (i-4, j+2)   -- between W and SW
 *   v4: centroid of (i,j), (i-6,j+6), (i,j+6)  = (i-2, j+4)   -- between SW and S
 *   v5: centroid of (i,j), (i,j+6), (i+6,j)    = (i+2, j+2)   -- between S and E
 *
 * Sides (clockwise):
 *   side 0: v0→v1, faces NE neighbor
 *   side 1: v1→v2, faces N neighbor
 *   side 2: v2→v3, faces W neighbor
 *   side 3: v3→v4, faces SW neighbor
 *   side 4: v4→v5, faces S neighbor
 *   side 5: v5→v0, faces E neighbor
 */
function hexPolygon(i: Int, j: Int): readonly (readonly [number, number])[] {
  return [
    [i + 4, j - 2],   // v0: between E and NE
    [i + 2, j - 4],   // v1: between NE and N
    [i - 2, j - 2],   // v2: between N and W
    [i - 4, j + 2],   // v3: between W and SW
    [i - 2, j + 4],   // v4: between SW and S
    [i + 2, j + 2],   // v5: between S and E
  ] as const;
}

/**
 * Map hex direction to polygon side index.
 * 
 * With the new hexPolygon (step=6, centroid-based vertices):
 * Vertices (clockwise from v0):
 *   v0: between E and NE
 *   v1: between NE and N
 *   v2: between N and W
 *   v3: between W and SW
 *   v4: between SW and S
 *   v5: between S and E
 *
 * Sides (clockwise):
 *   side 0: v0→v1, faces NE neighbor
 *   side 1: v1→v2, faces N neighbor
 *   side 2: v2→v3, faces W neighbor
 *   side 3: v3→v4, faces SW neighbor
 *   side 4: v4→v5, faces S neighbor
 *   side 5: v5→v0, faces E neighbor
 */
const HEX_DIR_TO_SIDE: Record<HexDirection, number> = {
  NE: 0,  // Side 0: v0→v1, faces NE neighbor
  N: 1,   // Side 1: v1→v2, faces N neighbor
  W: 2,   // Side 2: v2→v3, faces W neighbor
  SW: 3,  // Side 3: v3→v4, faces SW neighbor
  S: 4,   // Side 4: v4→v5, faces S neighbor
  E: 5,   // Side 5: v5→v0, faces E neighbor
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
 * Uses 6-unit spacing: nodes at (6*col+3, 6*row+3).
 */
function getHexNeighbor(
  i: Int,
  j: Int,
  dir: HexDirection,
  n: Int
): HexNeighborResult | null {
  const step = 6;
  const minCoord = step / 2; // 3
  const maxCoord = step * (n - 1) + minCoord; // 6*(n-1)+3
  const L = step * n; // 6*n = size of fundamental domain
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
      // For P2hex (180° rotation symmetry), we need to handle:
      // 1. Interior nodes: simple (i+step, j-step)
      // 2. North border (not corner): 180° rotation around north boundary
      // 3. East border (not corner): 180° rotation around east boundary
      // 4. NE corner: pure translation to SW corner (special diagonal)
      // 5. NW corner: 180° rotation to SE corner
      // 6. SE corner: 180° rotation to NW corner
      
      const isNWCorner = onWestBorder && onNorthBorder;
      const isNECorner = onEastBorder && onNorthBorder;
      const isSECorner = onEastBorder && onSouthBorder;
      
      if (isNECorner) {
        // NE corner going NE: pure translation to SW corner
        // This is the special diagonal edge with translation-only voltage
        ni = minCoord;
        nj = maxCoord;
        voltage = translationMatrix(L, -L);  // Move by (L, -L) in axial coords
        targetSide = HEX_DIR_TO_SIDE["SW"];
      } else if (isNWCorner) {
        // NW corner going NE: exits north border (j-step < minCoord)
        // Wrap with 180° rotation around north border
        // - i component: becomes L - (i + step) = L - i - step
        // - j component: stays at minCoord
        const reflectedI = L - i - step;
        ni = reflectedI;
        nj = minCoord;
        voltage = translationWith180(L, 0);
        targetSide = HEX_DIR_TO_SIDE["SW"];
      } else if (isSECorner) {
        // SE corner going NE: exits east border (i+step > maxCoord)
        // Wrap with 180° rotation around east border
        // - j component: becomes L - (j - step) = L - j + step
        // - i component: stays at maxCoord
        const reflectedJ = L - j + step;
        ni = maxCoord;
        nj = reflectedJ;
        voltage = translationWith180(2 * L, L);
        targetSide = HEX_DIR_TO_SIDE["SW"];
      } else if (onNorthBorder && !onEastBorder) {
        // North border (not corner) going NE: 180° rotation around north
        // - i component: becomes L - (i + step) = L - i - step
        // - j component: stays at minCoord (since we're reflecting on north border)
        const reflectedI = L - i - step;
        ni = reflectedI;
        nj = minCoord;
        voltage = translationWith180(L, 0);
        // With 180° rotation, our NE becomes their SW at the target
        targetSide = HEX_DIR_TO_SIDE["SW"];
      } else if (onEastBorder && !onNorthBorder) {
        // East border (not corner) going NE: 180° rotation around east
        // Going NE from (maxCoord, j) where j > minCoord
        // After 180° reflection around east border:
        // - j component: becomes L - (j - step) = L - j + step
        // - i component: stays at maxCoord
        const reflectedJ = L - j + step;
        ni = maxCoord;
        nj = reflectedJ;
        voltage = translationWith180(2 * L, L);
        // With 180° rotation, our NE becomes their SW at the target
        targetSide = HEX_DIR_TO_SIDE["SW"];
      }
      // For interior nodes, use the default ni/nj = i+step, j-step
      break;
    }
    case "SW": {
      // SW goes from (i,j) to (i-step, j+step)
      // For P2hex (180° rotation symmetry), we need to handle:
      // 1. Interior nodes: simple (i-step, j+step)
      // 2. South border (not corner): 180° rotation around south boundary
      // 3. West border (not corner): 180° rotation around west boundary
      // 4. SW corner: pure translation to NE corner (inverse of NE→SW)
      // 5. SE corner: 180° rotation to NW corner
      // 6. NW corner: return null - this edge is already created by SE corner's NE direction
      
      const isSECorner = onEastBorder && onSouthBorder;
      const isSWCorner = onWestBorder && onSouthBorder;
      const isNWCorner = onWestBorder && onNorthBorder;
      
      if (isNWCorner) {
        // NW corner going SW: this edge (NW↔SE) is already created by SE's NE direction
        return null;
      } else if (isSWCorner) {
        // SW corner going SW: pure translation to NE corner
        // This is the special diagonal edge with translation-only voltage (inverse)
        ni = maxCoord;
        nj = minCoord;
        voltage = translationMatrix(-L, L);  // Move by (-L, L) in axial coords
        targetSide = HEX_DIR_TO_SIDE["NE"];
      } else if (isSECorner) {
        // SE corner going SW: exits south border (j+step > maxCoord)
        // Wrap with 180° rotation around south border
        // - i component: becomes L - (i - step) = L - i + step
        // - j component: stays at maxCoord
        const reflectedI = L - i + step;
        ni = reflectedI;
        nj = maxCoord;
        voltage = translationWith180(L, 2 * L);
        targetSide = HEX_DIR_TO_SIDE["NE"];
      } else if (onSouthBorder && !onWestBorder) {
        // South border (not corner) going SW: 180° rotation around south
        // - i component: becomes L - (i - step) = L - i + step
        // - j component: stays at maxCoord
        const reflectedI = L - i + step;
        ni = reflectedI;
        nj = maxCoord;
        voltage = translationWith180(L, 2 * L);
        targetSide = HEX_DIR_TO_SIDE["NE"];
      } else if (onWestBorder && !onSouthBorder) {
        // West border (not corner) going SW: 180° rotation around west
        // - j component: becomes L - (j + step) = L - j - step
        // - i component: stays at minCoord
        const reflectedJ = L - j - step;
        ni = minCoord;
        nj = reflectedJ;
        voltage = translationWith180(0, L);
        targetSide = HEX_DIR_TO_SIDE["NE"];
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
  // there are TWO edges between them (both with 180° rotation, one via NE, one via SW)
  const isNW_SE_diagonal = (fromId === nodeIdFromCoord([minCoord, minCoord]) && toId === nodeIdFromCoord([maxCoord, maxCoord])) ||
                           (fromId === nodeIdFromCoord([maxCoord, maxCoord]) && toId === nodeIdFromCoord([minCoord, minCoord]));
  
  let edgeTypeLabel: string;
  if (isNW_SE_diagonal) {
    // Use direction-specific label to distinguish the two diagonal edges between NW and SE
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
 * The grid uses 6-unit spacing: nodes at (6*col+3, 6*row+3).
 * Polygon vertices are computed using centroids of adjacent hexagons.
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

  const step = 6;
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
