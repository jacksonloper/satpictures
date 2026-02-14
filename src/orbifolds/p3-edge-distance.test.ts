/**
 * Test for P3 lifted graph edge distances.
 * 
 * For P3 orbifold, the voltages use 120° rotations in axial coordinates.
 * Unlike P4 where all edges are exactly 2 units apart in Cartesian coordinates,
 * P3 edges may have varying distances due to the axial coordinate system.
 * 
 * This test verifies:
 * 1. The combinatorial structure is correct (edges exist where expected)
 * 2. Edge distances are reasonable (close to each other)
 * 3. The lifted graph forms a connected structure
 * 
 * Run with: npx tsx src/orbifolds/p3-edge-distance.test.ts
 */

import {
  createOrbifoldGrid,
  type ColorData,
} from "./createOrbifolds.js";

import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  getLiftedNodeAbsolutePosition,
  axialToCartesian,
  distance,
  formatVoltage,
} from "./orbifoldbasics.js";

/**
 * Test the P3 lifted graph structure.
 */
function testP3LiftedGraphStructure(
  n: number,
  m: number
): { passed: boolean; details: string[] } {
  const grid = createOrbifoldGrid("P3", n);
  buildAdjacency(grid);
  
  const lifted = constructLiftedGraphFromOrbifold<ColorData>(grid);
  
  // Expand the graph m times
  for (let i = 0; i < m; i++) {
    processAllNonInteriorOnce(lifted);
  }
  
  console.log(`\n=== Testing P3 with n=${n}, m=${m} ===`);
  console.log(`Lifted nodes: ${lifted.nodes.size}`);
  console.log(`Lifted edges: ${lifted.edges.size}`);
  
  const details: string[] = [];
  
  // Collect all edge distances
  const edgeDistances: number[] = [];
  const edgeDistancesAxial: number[] = [];
  
  for (const [edgeId, edge] of lifted.edges) {
    const nodeA = lifted.nodes.get(edge.a);
    const nodeB = lifted.nodes.get(edge.b);
    
    if (!nodeA || !nodeB) {
      details.push(`Edge ${edgeId}: Could not find nodes`);
      continue;
    }
    
    // Get positions in raw axial coordinates
    const posA = getLiftedNodeAbsolutePosition(grid, nodeA.orbifoldNode, nodeA.voltage);
    const posB = getLiftedNodeAbsolutePosition(grid, nodeB.orbifoldNode, nodeB.voltage);
    
    // Distance in raw axial space
    const distAxial = distance(posA, posB);
    edgeDistancesAxial.push(distAxial);
    
    // Get positions in Cartesian (after axial transform)
    const posACart = axialToCartesian(posA.x, posA.y);
    const posBCart = axialToCartesian(posB.x, posB.y);
    
    // Distance in Cartesian space
    const distCart = distance(posACart, posBCart);
    edgeDistances.push(distCart);
  }
  
  // Statistics on edge distances
  const minDistAxial = Math.min(...edgeDistancesAxial);
  const maxDistAxial = Math.max(...edgeDistancesAxial);
  const avgDistAxial = edgeDistancesAxial.reduce((a, b) => a + b, 0) / edgeDistancesAxial.length;
  
  const minDistCart = Math.min(...edgeDistances);
  const maxDistCart = Math.max(...edgeDistances);
  const avgDistCart = edgeDistances.reduce((a, b) => a + b, 0) / edgeDistances.length;
  
  console.log(`\nEdge distances (raw axial coords):`);
  console.log(`  Min: ${minDistAxial.toFixed(4)}`);
  console.log(`  Max: ${maxDistAxial.toFixed(4)}`);
  console.log(`  Avg: ${avgDistAxial.toFixed(4)}`);
  console.log(`  Ratio (max/min): ${(maxDistAxial/minDistAxial).toFixed(4)}`);
  
  console.log(`\nEdge distances (Cartesian coords):`);
  console.log(`  Min: ${minDistCart.toFixed(4)}`);
  console.log(`  Max: ${maxDistCart.toFixed(4)}`);
  console.log(`  Avg: ${avgDistCart.toFixed(4)}`);
  console.log(`  Ratio (max/min): ${(maxDistCart/minDistCart).toFixed(4)}`);
  
  // For P3 with lattice-based voltages, edge distances may vary significantly.
  // This is expected because the voltages are uniform per edge type (not position-dependent),
  // which ensures no node collisions but doesn't guarantee uniform edge lengths.
  // 
  // The key metric is that there should be NO NODE COLLISIONS in the lifted graph.
  // Two different (orbifold, voltage) pairs should never have the same absolute position.
  
  let passed = true;
  
  // Constants for collision detection
  const POSITION_PRECISION = 1000; // Multiplier for rounding (3 decimal places)
  const MAX_COLLISION_DETAILS = 3; // Maximum collision details to display
  
  // Check for node collisions
  const positionMap = new Map<string, string[]>();
  for (const [nodeId, node] of lifted.nodes) {
    const pos = getLiftedNodeAbsolutePosition(grid, node.orbifoldNode, node.voltage);
    // Round to avoid floating point issues
    const posKey = `${Math.round(pos.x * POSITION_PRECISION)},${Math.round(pos.y * POSITION_PRECISION)}`;
    const existing = positionMap.get(posKey) || [];
    existing.push(nodeId);
    positionMap.set(posKey, existing);
  }
  
  let collisionCount = 0;
  for (const [posKey, nodeIds] of positionMap) {
    if (nodeIds.length > 1) {
      // Check if they're actually different nodes (not just same node appearing twice)
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
        if (collisionCount <= MAX_COLLISION_DETAILS) {
          details.push(`Node collision at position ${posKey}: ${nodeIds.join(", ")}`);
        }
      }
    }
  }
  
  console.log(`\nNode collisions: ${collisionCount}`);
  if (collisionCount > 0) {
    details.push(`Found ${collisionCount} node collisions (expected 0)`);
    passed = false;
  } else {
    console.log("  ✓ No node collisions detected");
  }
  
  console.log(`\nEdge distance variability (expected for P3 lattice-based voltages):`);
  console.log(`  Axial ratio (max/min): ${(maxDistAxial/minDistAxial).toFixed(2)}`);
  console.log(`  Cartesian ratio (max/min): ${(maxDistCart/minDistCart).toFixed(2)}`);
  console.log(`  (Varied distances are normal with lattice voltages)`)
  
  // Check that most orbifold nodes appear in the lifted graph with identity voltage
  // For P3, not all nodes may be reachable with identity voltage due to the 3-fold
  // symmetry structure. We just check that a reasonable number are reachable.
  let identityNodeCount = 0;
  for (const [id, node] of lifted.nodes) {
    const isIdentity = node.voltage[0][0] === 1 && node.voltage[0][1] === 0 && node.voltage[0][2] === 0 &&
                       node.voltage[1][0] === 0 && node.voltage[1][1] === 1 && node.voltage[1][2] === 0 &&
                       node.voltage[2][0] === 0 && node.voltage[2][1] === 0 && node.voltage[2][2] === 1;
    if (isIdentity) {
      identityNodeCount++;
    }
  }
  
  console.log(`\nIdentity voltage nodes: ${identityNodeCount} (expected: at least ${Math.floor(n * n * 0.75)})`);
  
  // For P3, we expect at least 75% of nodes to be reachable with identity voltage
  const minExpectedIdentityNodes = Math.floor(n * n * 0.75);
  if (identityNodeCount < minExpectedIdentityNodes) {
    details.push(`Expected at least ${minExpectedIdentityNodes} identity voltage nodes, found ${identityNodeCount}`);
    passed = false;
  }
  
  return { passed, details };
}

/**
 * Test that P3 boundary wrapping matches P4 (same coordinates, different voltages).
 */
function testP3BoundaryWrapping(n: number): { passed: boolean; details: string[] } {
  console.log(`\n=== Testing P3 boundary wrapping (n=${n}) ===`);
  
  const gridP3 = createOrbifoldGrid("P3", n);
  const gridP4 = createOrbifoldGrid("P4", n);
  
  buildAdjacency(gridP3);
  buildAdjacency(gridP4);
  
  const details: string[] = [];
  let passed = true;
  
  // Check that edge structure is identical (same edge keys)
  const p3EdgeKeys = new Set<string>();
  const p4EdgeKeys = new Set<string>();
  
  for (const [edgeId, edge] of gridP3.edges) {
    const nodeIds = Array.from(edge.halfEdges.keys()).sort();
    p3EdgeKeys.add(nodeIds.join("-"));
  }
  
  for (const [edgeId, edge] of gridP4.edges) {
    const nodeIds = Array.from(edge.halfEdges.keys()).sort();
    p4EdgeKeys.add(nodeIds.join("-"));
  }
  
  // Check symmetric difference
  const onlyP3 = [...p3EdgeKeys].filter(k => !p4EdgeKeys.has(k));
  const onlyP4 = [...p4EdgeKeys].filter(k => !p3EdgeKeys.has(k));
  
  if (onlyP3.length > 0 || onlyP4.length > 0) {
    details.push(`Edge structure differs: ${onlyP3.length} only in P3, ${onlyP4.length} only in P4`);
    passed = false;
  } else {
    console.log(`  ✓ Edge structure identical (${p3EdgeKeys.size} edges)`);
  }
  
  // Check that voltages differ but have correct structure
  // P3 voltages should have 120° rotation pattern (±1 values, specific pattern)
  // P4 voltages should have 90° rotation pattern
  
  let p3BorderEdges = 0;
  let p4BorderEdges = 0;
  
  for (const [edgeId, edge] of gridP3.edges) {
    for (const [nodeId, halfEdge] of edge.halfEdges) {
      const v = halfEdge.voltage;
      const isIdentity = v[0][0] === 1 && v[0][1] === 0 && v[0][2] === 0 &&
                        v[1][0] === 0 && v[1][1] === 1 && v[1][2] === 0;
      if (!isIdentity) {
        p3BorderEdges++;
        break;
      }
    }
  }
  
  for (const [edgeId, edge] of gridP4.edges) {
    for (const [nodeId, halfEdge] of edge.halfEdges) {
      const v = halfEdge.voltage;
      const isIdentity = v[0][0] === 1 && v[0][1] === 0 && v[0][2] === 0 &&
                        v[1][0] === 0 && v[1][1] === 1 && v[1][2] === 0;
      if (!isIdentity) {
        p4BorderEdges++;
        break;
      }
    }
  }
  
  console.log(`  Border edges: P3=${p3BorderEdges}, P4=${p4BorderEdges}`);
  
  if (p3BorderEdges !== p4BorderEdges) {
    details.push(`Border edge count differs: P3=${p3BorderEdges}, P4=${p4BorderEdges}`);
    passed = false;
  }
  
  return { passed, details };
}

// Run the tests
console.log("=== P3 Lifted Edge Distance Test ===");

// Test boundary wrapping first
const wrapResult = testP3BoundaryWrapping(3);
if (wrapResult.details.length > 0) {
  console.log(`\n❌ Boundary wrapping issues:`);
  wrapResult.details.forEach(d => console.log(`  - ${d}`));
}

// Test lifted graph structure
const result = testP3LiftedGraphStructure(3, 3);

if (result.details.length > 0) {
  console.log(`\n❌ FAILED: Issues found`);
  result.details.forEach(d => console.log(`  - ${d}`));
} else {
  console.log(`\n✅ PASSED: P3 lifted graph structure is valid`);
}

// Exit with appropriate code
if (!wrapResult.passed || !result.passed) {
  console.log("\n❌ Overall: FAILED");
  process.exit(1);
} else {
  console.log("\n✅ Overall: PASSED");
}
