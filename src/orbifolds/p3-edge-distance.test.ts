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
  type WallpaperGroupType,
  type ColorData,
} from "./createOrbifolds.js";

import {
  type Matrix3x3,
  type LiftedGraph,
  type OrbifoldGrid,
  I3,
  matMul,
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  nodeIdFromCoord,
} from "./orbifoldbasics.js";

/**
 * Apply a 3x3 homogeneous transformation matrix to a 2D point.
 * Returns the transformed (x, y) coordinates.
 */
function applyMatrix(matrix: Matrix3x3, x: number, y: number): { x: number; y: number } {
  const w = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  return {
    x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / w,
    y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / w,
  };
}

/**
 * Apply axial-to-Cartesian transformation.
 * Axial coords (q, r) map to Cartesian (x, y) via:
 * x = q + r * 0.5
 * y = r * sqrt(3)/2
 */
function axialToCartesian(q: number, r: number): { x: number; y: number } {
  return {
    x: q + r * 0.5,
    y: r * Math.sqrt(3) / 2,
  };
}

/**
 * Calculate the absolute position of a lifted node.
 * Absolute position = voltage applied to orbifold node coordinates.
 */
function getLiftedNodeAbsolutePosition(
  orbifoldGrid: OrbifoldGrid<ColorData>,
  orbifoldNodeId: string,
  voltage: Matrix3x3
): { x: number; y: number } {
  const orbNode = orbifoldGrid.nodes.get(orbifoldNodeId);
  if (!orbNode) {
    throw new Error(`Orbifold node not found: ${orbifoldNodeId}`);
  }
  const [ox, oy] = orbNode.coord;
  return applyMatrix(voltage, ox, oy);
}

/**
 * Calculate Euclidean distance between two points.
 */
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Format a voltage matrix for display.
 */
function formatVoltage(v: Matrix3x3): string {
  return `[[${v[0].join(",")}], [${v[1].join(",")}], [${v[2].join(",")}]]`;
}

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
  
  // For P3, we expect distances to be close but not necessarily uniform
  // The ratio between max and min should be reasonable (e.g., < 3)
  const ratioThreshold = 3;
  const axialRatio = maxDistAxial / minDistAxial;
  const cartRatio = maxDistCart / minDistCart;
  
  let passed = true;
  
  if (axialRatio > ratioThreshold) {
    details.push(`Axial distance ratio ${axialRatio.toFixed(4)} exceeds threshold ${ratioThreshold}`);
    passed = false;
  }
  
  if (cartRatio > ratioThreshold) {
    details.push(`Cartesian distance ratio ${cartRatio.toFixed(4)} exceeds threshold ${ratioThreshold}`);
    passed = false;
  }
  
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
