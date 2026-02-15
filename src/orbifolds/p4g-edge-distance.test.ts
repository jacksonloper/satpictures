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
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  getLiftedNodeAbsolutePosition,
  distance,
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

  // Node count: n*(n-1)/2 grid nodes + n diagonal nodes = n*(n+1)/2
  const expectedNodeCount = (n * (n + 1)) / 2;
  if (grid.nodes.size !== expectedNodeCount) {
    failures.push(`Expected ${expectedNodeCount} nodes, got ${grid.nodes.size}`);
  }

  // Check grid nodes exist at doubled coordinates (4*col+2, 4*row+2) for row < col
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = 4 * col + 2;
      const j = 4 * row + 2;
      const nodeId = nodeIdFromCoord([i, j]);
      const exists = grid.nodes.has(nodeId);

      if (row >= col && exists) {
        failures.push(`Grid node ${nodeId} should not exist (on/below diagonal)`);
      }
      if (row < col && !exists) {
        failures.push(`Grid node ${nodeId} should exist (above diagonal)`);
      }
    }
  }

  // Check diagonal nodes exist at (4*k+3, 4*k+1) for k = 0..n-1
  for (let k = 0; k < n; k++) {
    const i = 4 * k + 3;
    const j = 4 * k + 1;
    const nodeId = nodeIdFromCoord([i, j]);
    if (!grid.nodes.has(nodeId)) {
      failures.push(`Diagonal node ${nodeId} at k=${k} should exist`);
    }
  }

  // Self-loops should be on diagonal nodes (not on superdiagonal grid nodes)
  const expectedSelfLoopNodes = new Set<string>();
  for (let k = 0; k < n; k++) {
    const i = 4 * k + 3;
    const j = 4 * k + 1;
    expectedSelfLoopNodes.add(nodeIdFromCoord([i, j]));
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
      failures.push(`Diagonal node ${nodeId} should have one diagonal reflection self-loop`);
    }
  }

  // Superdiagonal grid nodes should NOT have self-loops
  for (let row = 0; row < n - 1; row++) {
    const col = row + 1;
    const i = 4 * col + 2;
    const j = 4 * row + 2;
    const nodeId = nodeIdFromCoord([i, j]);
    const edgeIds = grid.adjacency?.get(nodeId) ?? [];
    const selfLoops = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge) return false;
      const half = edge.halfEdges.get(nodeId);
      return half?.to === nodeId && matEq(half.voltage, DIAGONAL_REFLECTION);
    });
    if (selfLoops.length > 0) {
      failures.push(`Superdiag grid node ${nodeId} should NOT have diagonal reflection self-loop`);
    }
  }

  // First diagonal node should have border crossing to last diagonal node
  const firstDiagId = nodeIdFromCoord([3, 1]);
  const lastDiagId = nodeIdFromCoord([4 * (n - 1) + 3, 4 * (n - 1) + 1]);
  const firstDiagEdges = grid.adjacency?.get(firstDiagId) ?? [];
  const borderEdges = firstDiagEdges.filter((edgeId) => {
    const edge = grid.edges.get(edgeId);
    if (!edge || edge.halfEdges.size !== 2) return false;
    const half = edge.halfEdges.get(firstDiagId);
    return half?.to === lastDiagId && !matEq(half.voltage, [[1,0,0],[0,1,0],[0,0,1]]);
  });
  if (borderEdges.length !== 1) {
    failures.push(`First diagonal node should have exactly one border crossing edge to last diagonal node (found ${borderEdges.length})`);
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Test that lifted graph edge distances are consistent.
 */
function testP4gLiftedDistances(n: number, m: number): { passed: boolean; failures: string[] } {
  const grid = createOrbifoldGrid("P4g", n);
  buildAdjacency(grid);

  const lifted = constructLiftedGraphFromOrbifold(grid);
  for (let i = 0; i < m; i++) processAllNonInteriorOnce(lifted);

  const failures: string[] = [];
  const TOLERANCE = 0.0001;

  // Distances should be one of a few consistent values
  const allowedDistances = [
    4.0,              // grid-to-grid
    Math.sqrt(10),    // grid-to-diagonal
    2 * Math.sqrt(2), // diagonal reflection self-loop
    2.0,              // diagonal border crossing
  ];

  for (const [, edge] of lifted.edges) {
    const nodeA = lifted.nodes.get(edge.a);
    const nodeB = lifted.nodes.get(edge.b);
    if (!nodeA || !nodeB) continue;

    const posA = getLiftedNodeAbsolutePosition(grid, nodeA.orbifoldNode, nodeA.voltage);
    const posB = getLiftedNodeAbsolutePosition(grid, nodeB.orbifoldNode, nodeB.voltage);
    const dist = distance(posA, posB);

    const matchesAllowed = allowedDistances.some(d => Math.abs(dist - d) < TOLERANCE);
    if (!matchesAllowed) {
      failures.push(`Edge: dist=${dist.toFixed(4)} not in allowed set [${allowedDistances.map(d => d.toFixed(4)).join(", ")}]`);
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

console.log("\n=== P4g Lifted Edge Distance Test ===");
const distResult = testP4gLiftedDistances(4, 3);
if (distResult.failures.length > 0) {
  console.log(`\n❌ FAILED: ${distResult.failures.length} distance issues`);
  for (const f of distResult.failures) console.log(`- ${f}`);
  process.exit(1);
} else {
  console.log("\n✅ PASSED: All lifted edge distances are consistent");
}
