/**
 * Test for P4g orbifold structure (doubled-scale version).
 *
 * Run with: npx tsx src/orbifolds/p4g-edge-distance.test.ts
 */

import { createOrbifoldGrid } from "./createOrbifolds.js";

import {
  type Matrix3x3,
  buildAdjacency,
  nodeIdFromCoord,
  matEq,
} from "./orbifoldbasics.js";

const DIAGONAL_REFLECTION: Matrix3x3 = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
] as const;

function testP4gStructure(n: number): { passed: boolean; failures: string[] } {
  const grid = createOrbifoldGrid("P4g", n);
  buildAdjacency(grid);

  const failures: string[] = [];

  // Total nodes: n*(n-1)/2 regular + n diagonal = n*(n+1)/2
  const expectedNodeCount = (n * (n + 1)) / 2;
  if (grid.nodes.size !== expectedNodeCount) {
    failures.push(`Expected ${expectedNodeCount} nodes, got ${grid.nodes.size}`);
  }

  // Check that regular nodes (row < col) exist at doubled coordinates
  for (let row = 0; row < n; row++) {
    for (let col = row + 1; col < n; col++) {
      const i = 4 * col + 2;
      const j = 4 * row + 2;
      const nodeId = nodeIdFromCoord([i, j]);
      if (!grid.nodes.has(nodeId)) {
        failures.push(`Regular node (row=${row}, col=${col}) at (${i},${j}) missing`);
      }
    }
  }

  // Check that diagonal nodes (k=0..n-1) exist at (4*k+3, k+1)
  const expectedSelfLoopNodes = new Set<string>();
  for (let k = 0; k < n; k++) {
    const i = 4 * k + 3;
    const j = k + 1;
    const nodeId = nodeIdFromCoord([i, j]);
    if (!grid.nodes.has(nodeId)) {
      failures.push(`Diagonal node k=${k} at (${i},${j}) missing`);
    }
    expectedSelfLoopNodes.add(nodeId);
  }

  // Check that first-superdiagonal nodes do NOT have self-loops
  for (let row = 0; row < n - 1; row++) {
    const col = row + 1;
    const i = 4 * col + 2;
    const j = 4 * row + 2;
    const nodeId = nodeIdFromCoord([i, j]);
    const edgeIds = grid.adjacency?.get(nodeId) ?? [];
    const selfLoops = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      return edge && edge.halfEdges.size === 1 && edge.halfEdges.has(nodeId);
    });
    if (selfLoops.length > 0) {
      failures.push(
        `First-superdiagonal node ${nodeId} at (${i},${j}) should NOT have self-loops, got ${selfLoops.length}`
      );
    }
  }

  // Check that diagonal nodes have exactly one diagonal reflection self-loop
  for (const nodeId of expectedSelfLoopNodes) {
    const edgeIds = grid.adjacency?.get(nodeId) ?? [];
    const matchingEdges = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge || edge.halfEdges.size !== 1) {
        return false;
      }
      const half = edge.halfEdges.get(nodeId);
      return half?.to === nodeId && matEq(half.voltage, DIAGONAL_REFLECTION);
    });

    if (matchingEdges.length !== 1) {
      failures.push(`Diagonal node ${nodeId} should have one diagonal reflection self-loop, got ${matchingEdges.length}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

console.log("=== P4g Orbifold Structure Test (doubled scale) ===");
const result = testP4gStructure(4);

if (result.failures.length > 0) {
  console.log(`\n❌ FAILED: ${result.failures.length} issues found`);
  for (const failure of result.failures) {
    console.log(`- ${failure}`);
  }
  process.exit(1);
} else {
  console.log("\n✅ PASSED: P4g structure looks correct");
}
