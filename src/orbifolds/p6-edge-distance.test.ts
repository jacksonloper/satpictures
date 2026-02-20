/**
 * Test for P6 orbifold structure.
 *
 * P6 is P3 folded across the NW-SE diagonal (like P4g is P4 folded).
 * - Same node structure as P4g (grid nodes above diagonal + diagonal triangles)
 * - Border voltages use 120° rotations (like P3) instead of 90° (like P4)
 * - Diagonal edges are "flip" (180° rotation) instead of "mirror" (reflection)
 *
 * Run with: npx tsx src/orbifolds/p6-edge-distance.test.ts
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
  formatVoltage,
} from "./orbifoldbasics.js";

import {
  translationWith180,
} from "./orbifoldShared.js";

function testP6Structure(n: number): { passed: boolean; failures: string[] } {
  const grid = createOrbifoldGrid("P6", n);
  buildAdjacency(grid);

  const failures: string[] = [];

  const L = 4 * n;
  const DIAG_FLIP: Matrix3x3 = translationWith180(L, L);

  // Node count: n*(n-1)/2 grid nodes + n diagonal nodes = n*(n+1)/2
  // The NE grid node (col=n-1, row=0) is split into 2 triangle nodes, adding 1 extra.
  const expectedNodeCount = (n * (n + 1)) / 2 + 1;
  if (grid.nodes.size !== expectedNodeCount) {
    failures.push(`Expected ${expectedNodeCount} nodes, got ${grid.nodes.size}`);
  }

  // The NE grid node (col=n-1, row=0) is split into triangles
  const neI = 4 * (n - 1) + 2;
  const neJ = 2;
  const neNodeId = nodeIdFromCoord([neI, neJ]);

  // Check grid nodes exist at doubled coordinates (4*col+2, 4*row+2) for row < col
  // except for the NE node which has been split
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = 4 * col + 2;
      const j = 4 * row + 2;
      const nodeId = nodeIdFromCoord([i, j]);
      const exists = grid.nodes.has(nodeId);
      const isNENode = nodeId === neNodeId;

      if (row >= col && exists) {
        failures.push(`Grid node ${nodeId} should not exist (on/below diagonal)`);
      }
      if (row < col && !isNENode && !exists) {
        failures.push(`Grid node ${nodeId} should exist (above diagonal)`);
      }
      if (isNENode && exists) {
        failures.push(`NE grid node ${nodeId} should have been split into triangles`);
      }
    }
  }

  // Check that the NE triangle nodes exist
  const neNorthId = nodeIdFromCoord([neI - 1, neJ - 1]);
  const neSouthId = nodeIdFromCoord([neI + 1, neJ + 1]);
  if (!grid.nodes.has(neNorthId)) {
    failures.push(`NE north triangle node ${neNorthId} should exist`);
  }
  if (!grid.nodes.has(neSouthId)) {
    failures.push(`NE south triangle node ${neSouthId} should exist`);
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

  // Diagonal nodes should NOT have diagonal-reflection self-loops (unlike P4g)
  const DIAGONAL_REFLECTION: Matrix3x3 = [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ] as const;

  for (let k = 0; k < n; k++) {
    const i = 4 * k + 3;
    const j = 4 * k + 1;
    const nodeId = nodeIdFromCoord([i, j]);
    const edgeIds = grid.adjacency?.get(nodeId) ?? [];
    const reflectionSelfLoops = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge || edge.halfEdges.size !== 1) return false;
      const half = edge.halfEdges.get(nodeId);
      return half?.to === nodeId && matEq(half.voltage, DIAGONAL_REFLECTION);
    });
    if (reflectionSelfLoops.length > 0) {
      failures.push(`Diagonal node ${nodeId} should NOT have diagonal-reflection self-loop (P6 uses flip, not mirror)`);
    }
  }

  // Check diagonal flip edges: k ↔ (n-1-k) on hypotenuse side
  for (let k = 0; k < n; k++) {
    const partner = n - 1 - k;
    if (partner < k) continue;

    const diagI = 4 * k + 3;
    const diagJ = 4 * k + 1;
    const diagId = nodeIdFromCoord([diagI, diagJ]);
    const edgeIds = grid.adjacency?.get(diagId) ?? [];

    if (partner === k) {
      // Middle node: self-edge with 180° flip voltage
      const flipSelfEdges = edgeIds.filter((edgeId) => {
        const edge = grid.edges.get(edgeId);
        if (!edge || edge.halfEdges.size !== 1) return false;
        const half = edge.halfEdges.get(diagId);
        return half?.to === diagId && matEq(half.voltage, DIAG_FLIP);
      });
      if (flipSelfEdges.length !== 1) {
        failures.push(`Middle diagonal node ${diagId} (k=${k}) should have one flip self-edge (found ${flipSelfEdges.length})`);
      }
    } else {
      // Paired nodes: edge between k and partner with flip voltage
      const partnerI = 4 * partner + 3;
      const partnerJ = 4 * partner + 1;
      const partnerId = nodeIdFromCoord([partnerI, partnerJ]);
      const flipEdges = edgeIds.filter((edgeId) => {
        const edge = grid.edges.get(edgeId);
        if (!edge || edge.halfEdges.size !== 2) return false;
        const half = edge.halfEdges.get(diagId);
        return half?.to === partnerId && matEq(half.voltage, DIAG_FLIP);
      });
      if (flipEdges.length !== 1) {
        failures.push(`Diagonal node ${diagId} (k=${k}) should have one flip edge to ${partnerId} (k=${partner}), found ${flipEdges.length}`);
      }
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
    // Should be a non-identity, non-flip edge to the last diagonal node
    return half?.to === lastDiagId && !matEq(half.voltage, [[1,0,0],[0,1,0],[0,0,1]]) && !matEq(half.voltage, DIAG_FLIP);
  });
  if (borderEdges.length !== 1) {
    failures.push(`First diagonal node should have exactly one border crossing edge to last diagonal node (found ${borderEdges.length})`);
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Test that lifted graph has no node collisions.
 */
function testP6LiftedGraph(n: number, m: number): { passed: boolean; failures: string[] } {
  const grid = createOrbifoldGrid("P6", n);
  buildAdjacency(grid);

  const lifted = constructLiftedGraphFromOrbifold(grid);
  for (let i = 0; i < m; i++) processAllNonInteriorOnce(lifted);

  const failures: string[] = [];
  const POSITION_PRECISION = 1000;

  // Check for node collisions
  const positionMap = new Map<string, string[]>();
  for (const [nodeId, node] of lifted.nodes) {
    const pos = getLiftedNodeAbsolutePosition(grid, node.orbifoldNode, node.voltage);
    const posKey = `${Math.round(pos.x * POSITION_PRECISION)},${Math.round(pos.y * POSITION_PRECISION)}`;
    const existing = positionMap.get(posKey) || [];
    existing.push(nodeId);
    positionMap.set(posKey, existing);
  }

  let collisionCount = 0;
  for (const [, nodeIds] of positionMap) {
    if (nodeIds.length > 1) {
      const uniqueNodes = new Set<string>();
      for (const nodeId of nodeIds) {
        const node = lifted.nodes.get(nodeId);
        if (node) {
          const key = `${node.orbifoldNode}|${formatVoltage(node.voltage)}`;
          uniqueNodes.add(key);
        }
      }
      if (uniqueNodes.size > 1) {
        collisionCount++;
        if (collisionCount <= 3) {
          failures.push(`Node collision at position: ${nodeIds.join(", ")}`);
        }
      }
    }
  }

  if (collisionCount > 0) {
    failures.push(`Found ${collisionCount} node collisions (expected 0)`);
  }

  // Check edge distances are reasonable (no zero-length edges)
  for (const [, edge] of lifted.edges) {
    const nodeA = lifted.nodes.get(edge.a);
    const nodeB = lifted.nodes.get(edge.b);
    if (!nodeA || !nodeB) continue;

    const posA = getLiftedNodeAbsolutePosition(grid, nodeA.orbifoldNode, nodeA.voltage);
    const posB = getLiftedNodeAbsolutePosition(grid, nodeB.orbifoldNode, nodeB.voltage);
    const dist = distance(posA, posB);

    if (dist < 0.001) {
      failures.push(`Edge has near-zero distance: ${dist.toFixed(6)}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

// Run the tests
console.log("=== P6 Orbifold Structure Test ===");
const result = testP6Structure(4);

if (result.failures.length > 0) {
  console.log(`\n❌ FAILED: ${result.failures.length} issues found`);
  for (const failure of result.failures) {
    console.log(`- ${failure}`);
  }
  process.exit(1);
} else {
  console.log("\n✅ PASSED: P6 structure looks correct");
}

// Also test n=5 (odd, which has a middle diagonal self-edge)
console.log("\n=== P6 Orbifold Structure Test (n=5) ===");
const result5 = testP6Structure(5);

if (result5.failures.length > 0) {
  console.log(`\n❌ FAILED: ${result5.failures.length} issues found`);
  for (const failure of result5.failures) {
    console.log(`- ${failure}`);
  }
  process.exit(1);
} else {
  console.log("\n✅ PASSED: P6 structure (n=5) looks correct");
}

console.log("\n=== P6 Lifted Graph Test ===");
const liftedResult = testP6LiftedGraph(4, 3);
if (liftedResult.failures.length > 0) {
  console.log(`\n❌ FAILED: ${liftedResult.failures.length} lifted graph issues`);
  for (const f of liftedResult.failures) console.log(`- ${f}`);
  process.exit(1);
} else {
  console.log("\n✅ PASSED: P6 lifted graph has no collisions");
}
