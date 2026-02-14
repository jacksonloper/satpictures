/**
 * Test for P4g orbifold structure.
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
  const expectedNodeCount = (n * (n - 1)) / 2;
  if (grid.nodes.size !== expectedNodeCount) {
    failures.push(`Expected ${expectedNodeCount} nodes, got ${grid.nodes.size}`);
  }

  const expectedSelfLoopNodes = new Set<string>();
  for (let row = 0; row < n - 1; row++) {
    const col = row + 1;
    const i = 2 * col + 1;
    const j = 2 * row + 1;
    expectedSelfLoopNodes.add(nodeIdFromCoord([i, j]));
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = 2 * col + 1;
      const j = 2 * row + 1;
      const nodeId = nodeIdFromCoord([i, j]);
      const exists = grid.nodes.has(nodeId);

      if (row >= col && exists) {
        failures.push(`Node ${nodeId} should not exist (on/below diagonal)`);
      }
    }
  }

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
      failures.push(`Node ${nodeId} should have one diagonal reflection self-loop`);
    }
  }

  return { passed: failures.length === 0, failures };
}

console.log("=== P4g Orbifold Structure Test ===");
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
