/**
 * Utilities for checking if a non-branching path is "parallelizable"
 * and generating the corresponding region partition of the fundamental domain.
 *
 * A path is parallelizable if the solid edges that cross the domain boundary
 * form a non-crossing chord diagram when the boundary is mapped to a circle.
 *
 * Concretely: each solid edge with two boundary polygon sides creates a "chord".
 * The path is parallelizable iff:
 *   (1) Every boundary-side position is used by at most one solid chord
 *       ("every node on a side of the rhombus has at most one edge associated").
 *   (2) No two chords cross (their boundary positions do not interleave on the
 *       circle).
 *
 * The boundary circle is traced clockwise: N side left→right, E top→bottom,
 * S right→left, W bottom→top.  Each boundary polygon side of each node is
 * mapped to a fractional position in [0, 1).
 */

import type { OrbifoldGrid, OrbifoldEdge, OrbifoldNodeId } from "./orbifoldbasics";
import type { ColorData, EdgeStyleData } from "./createOrbifolds";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const EPS = 1e-9;

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeBoundingBox(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
): BoundingBox {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const node of grid.nodes.values()) {
    for (const [x, y] of node.polygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

type Side = "N" | "E" | "S" | "W";

/**
 * If both endpoints of a polygon side lie on the same edge of the bounding box,
 * return which side that is; otherwise return null.
 */
function getBoundarySide(
  p1: readonly [number, number],
  p2: readonly [number, number],
  bbox: BoundingBox,
): Side | null {
  const { minX, maxX, minY, maxY } = bbox;
  if (Math.abs(p1[1] - minY) < EPS && Math.abs(p2[1] - minY) < EPS) return "N";
  if (Math.abs(p1[0] - maxX) < EPS && Math.abs(p2[0] - maxX) < EPS) return "E";
  if (Math.abs(p1[1] - maxY) < EPS && Math.abs(p2[1] - maxY) < EPS) return "S";
  if (Math.abs(p1[0] - minX) < EPS && Math.abs(p2[0] - minX) < EPS) return "W";
  return null;
}

/**
 * Convert a boundary polygon side to a position in [0, 1) on the clockwise
 * boundary circle.  Ordering: N left→right (0…w), E top→bottom (w…w+h),
 * S right→left (w+h…2w+h), W bottom→top (2w+h…2w+2h = perimeter).
 */
function boundaryPosition(
  p1: readonly [number, number],
  p2: readonly [number, number],
  side: Side,
  bbox: BoundingBox,
): number {
  const { minX, maxX, minY, maxY } = bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  const perim = 2 * (w + h);
  const midX = (p1[0] + p2[0]) / 2;
  const midY = (p1[1] + p2[1]) / 2;
  switch (side) {
    case "N":
      return (midX - minX) / perim;
    case "E":
      return (w + (midY - minY)) / perim;
    case "S":
      return (w + h + (maxX - midX)) / perim;
    case "W":
      return (w + h + w + (maxY - midY)) / perim;
  }
}

/**
 * Return the boundary-circle positions (0…1) for each boundary polygon side
 * used by a solid edge.  Typically returns 0 (interior edge) or 2 (chord).
 */
function getEdgeChordPositions(
  edge: OrbifoldEdge<EdgeStyleData>,
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  bbox: BoundingBox,
): number[] {
  const positions: number[] = [];
  for (const [nodeId, halfEdge] of edge.halfEdges) {
    const node = grid.nodes.get(nodeId);
    if (!node) continue;
    for (const sideIdx of halfEdge.polygonSides) {
      const p1 = node.polygon[sideIdx];
      const p2 = node.polygon[(sideIdx + 1) % node.polygon.length];
      const side = getBoundarySide(p1, p2, bbox);
      if (side !== null) {
        positions.push(boundaryPosition(p1, p2, side, bbox));
      }
    }
  }
  return positions;
}

/**
 * Two chords (a,b) and (c,d) on the unit circle cross iff their endpoints
 * strictly interleave: exactly one of c, d lies in the open arc from a to b.
 */
function chordsCross(
  a: number,
  b: number,
  c: number,
  d: number,
): boolean {
  // Normalize to a < b and c < d
  if (a > b) [a, b] = [b, a];
  if (c > d) [c, d] = [d, c];
  // Strictly in open arc (a, b)
  const cIn = c > a + EPS && c < b - EPS;
  const dIn = d > a + EPS && d < b - EPS;
  return cIn !== dIn;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the current solid-edge assignment is parallelizable.
 *
 * A path is parallelizable when the boundary-crossing solid edges ("chords")
 * satisfy:
 *   • Each boundary polygon-side position is used by at most one solid chord.
 *   • No two chords cross in the disk picture.
 */
export function isPathParallelizable(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
): boolean {
  const bbox = computeBoundingBox(grid);

  const chords: [number, number][] = [];
  // Sorted list for efficient duplicate-position detection
  const occupiedPositions: number[] = [];

  const isDuplicate = (pos: number): boolean => {
    // Binary search for any existing position within EPS
    let lo = 0, hi = occupiedPositions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const diff = occupiedPositions[mid] - pos;
      if (Math.abs(diff) < EPS) return true;
      if (diff < 0) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  };

  const insertPosition = (pos: number): void => {
    let lo = 0, hi = occupiedPositions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (occupiedPositions[mid] < pos) lo = mid + 1; else hi = mid;
    }
    occupiedPositions.splice(lo, 0, pos);
  };

  for (const edge of grid.edges.values()) {
    if (edge.data?.linestyle !== "solid") continue;

    const positions = getEdgeChordPositions(edge, grid, bbox);

    // Check every boundary position for duplicates
    for (const pos of positions) {
      if (isDuplicate(pos)) return false;
      insertPosition(pos);
    }

    // Only full chords (2 endpoints) contribute to the crossing check
    if (positions.length === 2) {
      chords.push([positions[0], positions[1]]);
    }
  }

  // Check every pair of chords for crossings
  for (let i = 0; i < chords.length; i++) {
    for (let j = i + 1; j < chords.length; j++) {
      if (chordsCross(chords[i][0], chords[i][1], chords[j][0], chords[j][1])) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Generate a Voronoi-style region assignment for the parallelizable path.
 *
 * Every solid edge seeds a region; BFS through the adjacency graph assigns
 * each node to the nearest solid-edge region.  This naturally turns each
 * solid edge into one coloured "strip" that partitions the fundamental domain.
 *
 * Returns:
 *   regionMap   – nodeId → 0-based region index
 *   solidEdgeIds – the solid edges, one per region index
 *   numRegions   – total number of distinct regions
 */
export function generateParallelizableRegions(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
): {
  regionMap: Map<OrbifoldNodeId, number>;
  solidEdgeIds: string[];
  numRegions: number;
} {
  const regionMap = new Map<OrbifoldNodeId, number>();
  const solidEdgeIds: string[] = [];

  for (const [edgeId, edge] of grid.edges) {
    if (edge.data?.linestyle === "solid") {
      solidEdgeIds.push(edgeId);
    }
  }

  if (solidEdgeIds.length === 0) {
    for (const nodeId of grid.nodes.keys()) {
      regionMap.set(nodeId, 0);
    }
    return { regionMap, solidEdgeIds, numRegions: 1 };
  }

  // Seed BFS from both endpoints of each solid edge
  const queue: Array<{ nodeId: string; region: number }> = [];

  for (let r = 0; r < solidEdgeIds.length; r++) {
    const edge = grid.edges.get(solidEdgeIds[r])!;
    for (const nodeId of edge.halfEdges.keys()) {
      if (!regionMap.has(nodeId)) {
        regionMap.set(nodeId, r);
        queue.push({ nodeId, region: r });
      }
    }
  }

  // BFS expansion through all edges (solid or dashed)
  let head = 0;
  while (head < queue.length) {
    const { nodeId, region } = queue[head++];
    for (const edgeId of grid.adjacency?.get(nodeId) ?? []) {
      const edge = grid.edges.get(edgeId);
      if (!edge) continue;
      const half = edge.halfEdges.get(nodeId);
      if (!half) continue;
      const neighborId = half.to;
      if (!regionMap.has(neighborId)) {
        regionMap.set(neighborId, region);
        queue.push({ nodeId: neighborId, region });
      }
    }
  }

  // Assign any remaining isolated nodes to fresh regions
  let nextRegion = solidEdgeIds.length;
  for (const nodeId of grid.nodes.keys()) {
    if (!regionMap.has(nodeId)) {
      regionMap.set(nodeId, nextRegion++);
    }
  }

  return { regionMap, solidEdgeIds, numRegions: nextRegion };
}
