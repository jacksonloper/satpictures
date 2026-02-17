/**
 * Tests for the doubleOrbifold function.
 *
 * Verifies that doubling an orbifold grid:
 * - Produces exactly 2× the number of nodes
 * - Produces exactly 4× the number of edges
 * - Preserves voltages on all edge copies
 * - Node IDs are correctly suffixed with @0 and @1
 * - Adjacency is built correctly
 *
 * Run with: npx tsx src/orbifolds/doubleOrbifold.test.ts
 */

import { createOrbifoldGrid } from "./createOrbifolds.js";
import { buildAdjacency, type OrbifoldGrid } from "./orbifoldbasics.js";
import { doubleOrbifold, doubledNodeId, getBaseNodeId, getLevelFromNodeId } from "./doubleOrbifold.js";
import type { ColorData, EdgeStyleData } from "./orbifoldShared.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

function testDoubling(groupType: "P1" | "P2" | "P3" | "P4" | "P4g" | "pgg", n: number): void {
  console.log(`\nTesting doubleOrbifold for ${groupType} (n=${n}):`);

  const grid = createOrbifoldGrid(groupType, n);
  buildAdjacency(grid);

  const doubled = doubleOrbifold(grid);

  // Node count: exactly 2×
  assert(
    doubled.nodes.size === grid.nodes.size * 2,
    `Node count: ${doubled.nodes.size} === ${grid.nodes.size * 2} (2× original)`
  );

  // Edge count: exactly 4×
  assert(
    doubled.edges.size === grid.edges.size * 4,
    `Edge count: ${doubled.edges.size} === ${grid.edges.size * 4} (4× original)`
  );

  // Every original node should have @0 and @1 variants
  for (const [nodeId] of grid.nodes) {
    const n0 = doubledNodeId(nodeId, 0);
    const n1 = doubledNodeId(nodeId, 1);
    assert(doubled.nodes.has(n0), `Node ${n0} exists`);
    assert(doubled.nodes.has(n1), `Node ${n1} exists`);
  }

  // Every doubled node should have a valid level and recoverable base ID
  for (const [nodeId, node] of doubled.nodes) {
    const level = getLevelFromNodeId(nodeId);
    assert(level !== undefined, `Node ${nodeId} has level suffix`);
    const baseId = getBaseNodeId(nodeId);
    assert(grid.nodes.has(baseId), `Node ${nodeId} base ID ${baseId} exists in original`);

    // Coordinates must match original
    const origNode = grid.nodes.get(baseId)!;
    assert(
      node.coord[0] === origNode.coord[0] && node.coord[1] === origNode.coord[1],
      `Node ${nodeId} coord matches original`
    );
  }

  // Voltages on doubled edges should match originals
  for (const [edgeId, edge] of doubled.edges) {
    // Extract base edge ID (remove @XX suffix)
    const baseEdgeId = edgeId.replace(/@\d\d$/, "");
    const origEdge = grid.edges.get(baseEdgeId);
    assert(origEdge !== undefined, `Edge ${edgeId} has base edge ${baseEdgeId} in original`);

    if (origEdge) {
      // Check that voltages match
      for (const [nodeId, half] of edge.halfEdges) {
        const baseNodeId = getBaseNodeId(nodeId);
        const origHalf = origEdge.halfEdges.get(baseNodeId);
        if (origHalf) {
          const vMatch = JSON.stringify(half.voltage) === JSON.stringify(origHalf.voltage);
          assert(vMatch, `Edge ${edgeId} half-edge from ${nodeId}: voltage matches original`);
        }
      }
    }
  }

  // Adjacency should be built
  assert(doubled.adjacency !== undefined, `Adjacency map is built`);

  // Every doubled node should have adjacency entries
  if (doubled.adjacency) {
    for (const [nodeId] of doubled.nodes) {
      const adj = doubled.adjacency.get(nodeId);
      assert(adj !== undefined && adj.length > 0, `Node ${nodeId} has adjacency entries`);
    }
  }
}

// Run tests for all wallpaper groups
testDoubling("P1", 3);
testDoubling("P2", 3);
testDoubling("P4", 3);
testDoubling("pgg", 3);
testDoubling("P3", 3);
testDoubling("P4g", 4);

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nSome tests failed!");
  process.exit(1);
} else {
  console.log("\nAll tests passed!");
}
