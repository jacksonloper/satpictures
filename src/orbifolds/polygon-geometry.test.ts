/**
 * Tests for orbifold node polygon geometry and edge polygon edge indices.
 *
 * Validates that:
 * 1. Every node has a well-formed polygon (≥ 3 vertices for P4g triangles, 4 for squares)
 * 2. Every half-edge has a valid polygonEdgeIndex within range [0, polygon.length)
 * 3. P1/pgg boundary edges use opposite polygon sides (N→S, E→W)
 * 4. P2 boundary edges use the same polygon side (N→N, S→S, etc.)
 * 5. P3/P4 boundary edges connect N→W (adjacent sides)
 * 6. P4g superdiagonal nodes have triangle polygons; others have square polygons
 * 7. Interior edges always use opposite polygon sides
 *
 * Run with: npx tsx src/orbifolds/polygon-geometry.test.ts
 */

import { createOrbifoldGrid } from "./createOrbifolds.js";
import {
  type OrbifoldGrid,
  type OrbifoldEdge,
  type OrbifoldHalfEdge,
  type OrbifoldNode,
  I3,
  matEq,
} from "./orbifoldbasics.js";
import { type ColorData, type EdgeStyleData } from "./orbifoldShared.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.log(`  ❌ FAIL: ${msg}`);
    failed++;
  } else {
    passed++;
  }
}

/**
 * Check that every node has a valid polygon and every half-edge has a valid polygonEdgeIndex.
 */
function testPolygonStructure(
  label: string,
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  minVertices: number = 3
): void {
  console.log(`\n=== ${label}: Polygon structure ===`);

  for (const [nodeId, node] of grid.nodes) {
    assert(
      node.polygon.length >= minVertices,
      `Node ${nodeId} polygon has ${node.polygon.length} vertices (expected >= ${minVertices})`
    );
    for (const [idx, vertex] of node.polygon.entries()) {
      assert(
        typeof vertex[0] === "number" && typeof vertex[1] === "number",
        `Node ${nodeId} polygon vertex ${idx} has valid coordinates`
      );
    }
  }

  for (const [edgeId, edge] of grid.edges) {
    for (const [nodeId, halfEdge] of edge.halfEdges) {
      const node = grid.nodes.get(nodeId);
      if (!node) continue;
      assert(
        halfEdge.polygonEdgeIndex >= 0 && halfEdge.polygonEdgeIndex < node.polygon.length,
        `Edge ${edgeId} half-edge from ${nodeId}: polygonEdgeIndex ${halfEdge.polygonEdgeIndex} is in range [0, ${node.polygon.length})`
      );
    }
  }

  console.log(`  ✓ All nodes have valid polygons and all half-edges have valid polygon edge indices`);
}

/**
 * Check that all nodes in a square grid have exactly 4-vertex square polygons.
 */
function testSquarePolygons(
  label: string,
  grid: OrbifoldGrid<ColorData, EdgeStyleData>
): void {
  console.log(`\n=== ${label}: Square polygons ===`);

  for (const [nodeId, node] of grid.nodes) {
    assert(node.polygon.length === 4, `Node ${nodeId} has 4 vertices`);

    const [i, j] = node.coord;
    const expected = [
      [i - 1, j - 1],
      [i + 1, j - 1],
      [i + 1, j + 1],
      [i - 1, j + 1],
    ];
    for (let k = 0; k < 4; k++) {
      assert(
        node.polygon[k][0] === expected[k][0] && node.polygon[k][1] === expected[k][1],
        `Node ${nodeId} polygon vertex ${k} is (${expected[k][0]}, ${expected[k][1]})`
      );
    }
  }

  console.log(`  ✓ All nodes have correct square polygons`);
}

/**
 * Check interior edge polygon indices (should be opposite sides for all orbifold types).
 * Interior edges have identity voltage.
 */
function testInteriorEdgesOpposite(
  label: string,
  grid: OrbifoldGrid<ColorData, EdgeStyleData>
): void {
  console.log(`\n=== ${label}: Interior edges use opposite polygon sides ===`);

  let interiorCount = 0;
  for (const [edgeId, edge] of grid.edges) {
    if (edge.halfEdges.size !== 2) continue;

    const entries = Array.from(edge.halfEdges.entries());
    const [n1, h1] = entries[0];
    const [n2, h2] = entries[1];

    // Check if this is an interior edge (identity voltage)
    if (!matEq(h1.voltage, I3)) continue;

    interiorCount++;

    // For square polygons, opposite means (idx + 2) % 4
    const node1 = grid.nodes.get(n1)!;
    const node2 = grid.nodes.get(n2)!;

    // Only check for square nodes
    if (node1.polygon.length === 4 && node2.polygon.length === 4) {
      assert(
        h1.polygonEdgeIndex === (h2.polygonEdgeIndex + 2) % 4,
        `Interior edge ${edgeId}: indices ${h1.polygonEdgeIndex} and ${h2.polygonEdgeIndex} are opposite`
      );
    }
  }

  console.log(`  ✓ Checked ${interiorCount} interior edges`);
}

/**
 * Test P1 boundary edges: all edges should use opposite polygon sides (N↔S, E↔W).
 */
function testP1BoundaryEdges(n: number): void {
  console.log(`\n=== P1 (n=${n}): Boundary edges use opposite polygon sides ===`);
  const grid = createOrbifoldGrid("P1", n);

  let boundaryCount = 0;
  for (const [edgeId, edge] of grid.edges) {
    if (edge.halfEdges.size !== 2) continue;
    const entries = Array.from(edge.halfEdges.entries());
    const [, h1] = entries[0];
    const [, h2] = entries[1];

    if (matEq(h1.voltage, I3)) continue; // Skip interior

    boundaryCount++;
    assert(
      h1.polygonEdgeIndex === (h2.polygonEdgeIndex + 2) % 4,
      `P1 boundary edge ${edgeId}: indices ${h1.polygonEdgeIndex} and ${h2.polygonEdgeIndex} are opposite`
    );
  }

  assert(boundaryCount > 0, `P1 has boundary edges (found ${boundaryCount})`);
  console.log(`  ✓ Checked ${boundaryCount} boundary edges`);
}

/**
 * Test P2 boundary edges: boundary edges should use the SAME polygon side (N→N, S→S, etc).
 */
function testP2BoundaryEdges(n: number): void {
  console.log(`\n=== P2 (n=${n}): Boundary edges use same polygon side ===`);
  const grid = createOrbifoldGrid("P2", n);

  let boundaryCount = 0;
  for (const [edgeId, edge] of grid.edges) {
    if (edge.halfEdges.size !== 2) continue;
    const entries = Array.from(edge.halfEdges.entries());
    const [, h1] = entries[0];
    const [, h2] = entries[1];

    if (matEq(h1.voltage, I3)) continue; // Skip interior

    boundaryCount++;
    assert(
      h1.polygonEdgeIndex === h2.polygonEdgeIndex,
      `P2 boundary edge ${edgeId}: both indices are ${h1.polygonEdgeIndex} (same side)`
    );
  }

  assert(boundaryCount > 0, `P2 has boundary edges (found ${boundaryCount})`);
  console.log(`  ✓ Checked ${boundaryCount} boundary edges`);
}

/**
 * Test P3/P4 boundary edges: N(0)↔W(3).
 */
function testP3P4BoundaryEdges(groupType: "P3" | "P4", n: number): void {
  console.log(`\n=== ${groupType} (n=${n}): Boundary edges connect N↔W ===`);
  const grid = createOrbifoldGrid(groupType, n);

  let boundaryCount = 0;
  for (const [edgeId, edge] of grid.edges) {
    if (edge.halfEdges.size !== 2) continue;
    const entries = Array.from(edge.halfEdges.entries());
    const [, h1] = entries[0];
    const [, h2] = entries[1];

    if (matEq(h1.voltage, I3)) continue; // Skip interior

    boundaryCount++;

    // One should be 0 (N) and the other 3 (W)
    const indices = [h1.polygonEdgeIndex, h2.polygonEdgeIndex].sort();
    assert(
      indices[0] === 0 && indices[1] === 3,
      `${groupType} boundary edge ${edgeId}: indices are {${h1.polygonEdgeIndex}, ${h2.polygonEdgeIndex}} (expected N=0 and W=3)`
    );
  }

  assert(boundaryCount > 0, `${groupType} has boundary edges (found ${boundaryCount})`);
  console.log(`  ✓ Checked ${boundaryCount} boundary edges`);
}

/**
 * Test pgg boundary edges: all edges should use opposite polygon sides (N↔S, E↔W).
 */
function testPggBoundaryEdges(n: number): void {
  console.log(`\n=== pgg (n=${n}): Boundary edges use opposite polygon sides ===`);
  const grid = createOrbifoldGrid("pgg", n);

  let boundaryCount = 0;
  for (const [edgeId, edge] of grid.edges) {
    if (edge.halfEdges.size !== 2) continue;
    const entries = Array.from(edge.halfEdges.entries());
    const [, h1] = entries[0];
    const [, h2] = entries[1];

    if (matEq(h1.voltage, I3)) continue; // Skip interior

    boundaryCount++;
    assert(
      h1.polygonEdgeIndex === (h2.polygonEdgeIndex + 2) % 4,
      `pgg boundary edge ${edgeId}: indices ${h1.polygonEdgeIndex} and ${h2.polygonEdgeIndex} are opposite`
    );
  }

  assert(boundaryCount > 0, `pgg has boundary edges (found ${boundaryCount})`);
  console.log(`  ✓ Checked ${boundaryCount} boundary edges`);
}

/**
 * Test P4g polygon shapes: superdiagonal nodes should have triangles, others squares.
 */
function testP4gPolygons(n: number): void {
  console.log(`\n=== P4g (n=${n}): Polygon shapes ===`);
  const grid = createOrbifoldGrid("P4g", n);

  let triangleCount = 0;
  let squareCount = 0;

  for (const [nodeId, node] of grid.nodes) {
    const [i, j] = node.coord;
    const isOnFirstSuperdiagonal = i === j + 2;

    if (isOnFirstSuperdiagonal) {
      assert(
        node.polygon.length === 3,
        `P4g superdiagonal node ${nodeId} at (${i},${j}) has 3 vertices (triangle)`
      );
      // Check triangle vertices: (i-1,j-1), (i+1,j-1), (i-1,j+1)
      assert(
        node.polygon[0][0] === i - 1 && node.polygon[0][1] === j - 1,
        `P4g triangle node ${nodeId} vertex 0 is (${i - 1}, ${j - 1})`
      );
      assert(
        node.polygon[1][0] === i + 1 && node.polygon[1][1] === j - 1,
        `P4g triangle node ${nodeId} vertex 1 is (${i + 1}, ${j - 1})`
      );
      assert(
        node.polygon[2][0] === i - 1 && node.polygon[2][1] === j + 1,
        `P4g triangle node ${nodeId} vertex 2 is (${i - 1}, ${j + 1})`
      );
      triangleCount++;
    } else {
      assert(
        node.polygon.length === 4,
        `P4g regular node ${nodeId} at (${i},${j}) has 4 vertices (square)`
      );
      squareCount++;
    }
  }

  assert(triangleCount > 0, `P4g has triangle nodes (found ${triangleCount})`);
  assert(squareCount > 0, `P4g has square nodes (found ${squareCount})`);
  console.log(`  ✓ Found ${triangleCount} triangle nodes and ${squareCount} square nodes`);
}

/**
 * Test P4g diagonal self-loop edges use the diagonal (hypotenuse) polygon edge.
 * Note: P4g can also have boundary wrapping self-loops on square nodes.
 */
function testP4gSelfLoopEdges(n: number): void {
  console.log(`\n=== P4g (n=${n}): Diagonal self-loop edges use diagonal polygon edge ===`);
  const grid = createOrbifoldGrid("P4g", n);

  let diagSelfLoopCount = 0;
  let boundaryWrapSelfLoopCount = 0;
  for (const [edgeId, edge] of grid.edges) {
    if (edge.halfEdges.size !== 1) continue;

    const [nodeId, halfEdge] = Array.from(edge.halfEdges.entries())[0];
    const node = grid.nodes.get(nodeId)!;
    const isOnSuperdiagonal = node.coord[0] === node.coord[1] + 2;

    if (isOnSuperdiagonal) {
      // Diagonal reflection self-loop on triangle node
      diagSelfLoopCount++;
      assert(node.polygon.length === 3, `P4g diagonal self-loop node ${nodeId} is a triangle`);
      assert(
        halfEdge.polygonEdgeIndex === 1,
        `P4g diagonal self-loop edge ${edgeId}: polygonEdgeIndex is 1 (diagonal/hypotenuse)`
      );
    } else {
      // Boundary wrapping self-loop on square node (e.g., corner nodes)
      boundaryWrapSelfLoopCount++;
      assert(node.polygon.length === 4, `P4g boundary wrap self-loop node ${nodeId} is a square`);
      assert(
        halfEdge.polygonEdgeIndex >= 0 && halfEdge.polygonEdgeIndex < 4,
        `P4g boundary wrap self-loop edge ${edgeId}: polygonEdgeIndex ${halfEdge.polygonEdgeIndex} is valid`
      );
    }
  }

  assert(diagSelfLoopCount > 0, `P4g has diagonal self-loop edges (found ${diagSelfLoopCount})`);
  console.log(`  ✓ Checked ${diagSelfLoopCount} diagonal self-loop edges and ${boundaryWrapSelfLoopCount} boundary wrap self-loop edges`);
}

// Run all tests
console.log("=== Polygon Geometry Tests ===");

// Test polygon structure for all orbifold types
const n = 4;

const p1Grid = createOrbifoldGrid("P1", n);
const p2Grid = createOrbifoldGrid("P2", n);
const p3Grid = createOrbifoldGrid("P3", n);
const p4Grid = createOrbifoldGrid("P4", n);
const pggGrid = createOrbifoldGrid("pgg", n);
const p4gGrid = createOrbifoldGrid("P4g", n);

testPolygonStructure("P1", p1Grid);
testPolygonStructure("P2", p2Grid);
testPolygonStructure("P3", p3Grid);
testPolygonStructure("P4", p4Grid);
testPolygonStructure("pgg", pggGrid);
testPolygonStructure("P4g", p4gGrid);

// Test square polygons for non-P4g types
testSquarePolygons("P1", p1Grid);
testSquarePolygons("P2", p2Grid);
testSquarePolygons("P3", p3Grid);
testSquarePolygons("P4", p4Grid);
testSquarePolygons("pgg", pggGrid);

// Test interior edges for all types
testInteriorEdgesOpposite("P1", p1Grid);
testInteriorEdgesOpposite("P2", p2Grid);
testInteriorEdgesOpposite("P3", p3Grid);
testInteriorEdgesOpposite("P4", p4Grid);
testInteriorEdgesOpposite("pgg", pggGrid);

// Test boundary edge patterns
testP1BoundaryEdges(n);
testP2BoundaryEdges(n);
testP3P4BoundaryEdges("P3", n);
testP3P4BoundaryEdges("P4", n);
testPggBoundaryEdges(n);

// Test P4g specific
testP4gPolygons(n);
testP4gSelfLoopEdges(n);

// Also test P4g polygon structure validation
testPolygonStructure("P4g", p4gGrid);

// Summary
console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("✅ All polygon geometry tests passed!");
}
