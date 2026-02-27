/**
 * Test for cmm orbifold structure.
 *
 * cmm uses the same triangular fundamental domain as P4g/P6 (folded along
 * the NW-SE diagonal), but with mirror boundaries on N and E (like pmm)
 * and a 180° flip on the diagonal (like P6).
 *
 * Run with: npx tsx src/orbifolds/cmm-edge-distance.test.ts
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
  REFLECTION_X,
  glideReflectionY,
  translationWith180,
} from "./orbifoldShared.js";

function testCmmStructure(n: number): { passed: boolean; failures: string[] } {
  const grid = createOrbifoldGrid("cmm", n);
  buildAdjacency(grid);

  const failures: string[] = [];

  const L = 4 * n;
  const DIAG_FLIP: Matrix3x3 = translationWith180(L, L);
  const E_MIRROR: Matrix3x3 = glideReflectionY(2 * L, 0);

  // Node count: n*(n-1)/2 grid nodes + n diagonal nodes = n*(n+1)/2
  // No splitCornerSquare, so no extra node.
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

  // Check N mirror self-edges on j=2 grid nodes
  for (let col = 1; col < n; col++) {
    const i = 4 * col + 2;
    const j = 2;
    const nodeId = nodeIdFromCoord([i, j]);
    const edgeIds = grid.adjacency?.get(nodeId) ?? [];
    const nMirrors = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge || edge.halfEdges.size !== 1) return false;
      const half = edge.halfEdges.get(nodeId);
      return half?.to === nodeId && matEq(half.voltage, REFLECTION_X);
    });
    if (nMirrors.length !== 1) {
      failures.push(`Grid node ${nodeId} at N border should have one N-mirror self-edge (found ${nMirrors.length})`);
    }
  }

  // Check E mirror self-edges on i=4*(n-1)+2 grid nodes
  for (let row = 0; row < n - 1; row++) {
    const i = 4 * (n - 1) + 2;
    const j = 4 * row + 2;
    const nodeId = nodeIdFromCoord([i, j]);
    if (!grid.nodes.has(nodeId)) continue;
    const edgeIds = grid.adjacency?.get(nodeId) ?? [];
    const eMirrors = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge || edge.halfEdges.size !== 1) return false;
      const half = edge.halfEdges.get(nodeId);
      return half?.to === nodeId && matEq(half.voltage, E_MIRROR);
    });
    if (eMirrors.length !== 1) {
      failures.push(`Grid node ${nodeId} at E border should have one E-mirror self-edge (found ${eMirrors.length})`);
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

  // Check N mirror on first diagonal node (k=0)
  {
    const diagId = nodeIdFromCoord([3, 1]);
    const edgeIds = grid.adjacency?.get(diagId) ?? [];
    const nMirrors = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge || edge.halfEdges.size !== 1) return false;
      const half = edge.halfEdges.get(diagId);
      return half?.to === diagId && matEq(half.voltage, REFLECTION_X);
    });
    if (nMirrors.length !== 1) {
      failures.push(`First diagonal node ${diagId} should have one N-mirror self-edge (found ${nMirrors.length})`);
    }
  }

  // Check E mirror on last diagonal node (k=n-1)
  {
    const lastI = 4 * (n - 1) + 3;
    const lastJ = 4 * (n - 1) + 1;
    const diagId = nodeIdFromCoord([lastI, lastJ]);
    const edgeIds = grid.adjacency?.get(diagId) ?? [];
    const eMirrors = edgeIds.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge || edge.halfEdges.size !== 1) return false;
      const half = edge.halfEdges.get(diagId);
      return half?.to === diagId && matEq(half.voltage, E_MIRROR);
    });
    if (eMirrors.length !== 1) {
      failures.push(`Last diagonal node ${diagId} should have one E-mirror self-edge (found ${eMirrors.length})`);
    }
  }

  // cmm should NOT have border crossing between first and last diagonal nodes
  // (unlike P4g/P6 which connect k=0 to k=n-1 via rotation)
  {
    const firstDiagId = nodeIdFromCoord([3, 1]);
    const lastDiagId = nodeIdFromCoord([4 * (n - 1) + 3, 4 * (n - 1) + 1]);
    const firstDiagEdges = grid.adjacency?.get(firstDiagId) ?? [];
    const borderEdges = firstDiagEdges.filter((edgeId) => {
      const edge = grid.edges.get(edgeId);
      if (!edge || edge.halfEdges.size !== 2) return false;
      const half = edge.halfEdges.get(firstDiagId);
      // Filter for non-identity, non-flip edges to the last diagonal node
      return half?.to === lastDiagId &&
        !matEq(half.voltage, [[1,0,0],[0,1,0],[0,0,1]]) &&
        !matEq(half.voltage, DIAG_FLIP);
    });
    if (borderEdges.length !== 0) {
      failures.push(`cmm should NOT have rotational border crossing between first and last diagonal nodes (found ${borderEdges.length})`);
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Test that lifted graph has no node collisions and reasonable edge distances.
 */
function testCmmLiftedGraph(n: number, m: number): { passed: boolean; failures: string[] } {
  const grid = createOrbifoldGrid("cmm", n);
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
console.log("=== cmm Orbifold Structure Test (n=4) ===");
const result4 = testCmmStructure(4);

if (result4.failures.length > 0) {
  console.log(`\n❌ FAILED: ${result4.failures.length} issues found`);
  for (const failure of result4.failures) {
    console.log(`- ${failure}`);
  }
  process.exit(1);
} else {
  console.log("\n✅ PASSED: cmm structure (n=4) looks correct");
}

// Also test n=5 (odd, which has a middle diagonal self-edge)
console.log("\n=== cmm Orbifold Structure Test (n=5) ===");
const result5 = testCmmStructure(5);

if (result5.failures.length > 0) {
  console.log(`\n❌ FAILED: ${result5.failures.length} issues found`);
  for (const failure of result5.failures) {
    console.log(`- ${failure}`);
  }
  process.exit(1);
} else {
  console.log("\n✅ PASSED: cmm structure (n=5) looks correct");
}

console.log("\n=== cmm Lifted Graph Test ===");
const liftedResult = testCmmLiftedGraph(4, 3);
if (liftedResult.failures.length > 0) {
  console.log(`\n❌ FAILED: ${liftedResult.failures.length} lifted graph issues`);
  for (const f of liftedResult.failures) console.log(`- ${f}`);
  process.exit(1);
} else {
  console.log("\n✅ PASSED: cmm lifted graph has no collisions");
}
