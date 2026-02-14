/**
 * Test for pgg lifted graph edge distances.
 * 
 * For pgg orbifold, every pair of lifted nodes that has a lifted edge
 * between them should be exactly distance 2 away from each other in ABSOLUTE position
 * (i.e. where they get rendered onscreen after considering both their orbifold node
 * coordinates and their voltage).
 * 
 * pgg uses glide reflections (not rotations) at boundaries. The lifted graph should
 * form a simple rectangular grid when the voltages are correctly applied.
 * 
 * Run with: npx tsx src/orbifolds/pgg-edge-distance.test.ts
 */

import {
  createOrbifoldGrid,
  type WallpaperGroupType,
  type ColorData,
} from "./createOrbifolds.js";

import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  nodeIdFromCoord,
  applyMatrix,
  getLiftedNodeAbsolutePosition,
  distance,
  formatVoltage,
} from "./orbifoldbasics.js";

/**
 * Test that all lifted edges have endpoints exactly distance 2 apart.
 */
function testLiftedEdgeDistances(
  groupType: WallpaperGroupType,
  n: number,
  m: number
): { passed: boolean; failures: string[]; stats: { min: number; max: number; avg: number } } {
  const grid = createOrbifoldGrid(groupType, n);
  buildAdjacency(grid);
  
  const lifted = constructLiftedGraphFromOrbifold<ColorData>(grid);
  
  // Expand the graph m times
  for (let i = 0; i < m; i++) {
    processAllNonInteriorOnce(lifted);
  }
  
  console.log(`\n=== Testing ${groupType} with n=${n}, m=${m} ===`);
  console.log(`Lifted nodes: ${lifted.nodes.size}`);
  console.log(`Lifted edges: ${lifted.edges.size}`);
  
  const failures: string[] = [];
  const EXPECTED_DISTANCE = 2;
  const TOLERANCE = 0.0001;
  
  let minDist = Infinity;
  let maxDist = 0;
  let totalDist = 0;
  let edgeCount = 0;
  
  for (const [edgeId, edge] of lifted.edges) {
    const nodeA = lifted.nodes.get(edge.a);
    const nodeB = lifted.nodes.get(edge.b);
    
    if (!nodeA || !nodeB) {
      failures.push(`Edge ${edgeId}: Could not find nodes`);
      continue;
    }
    
    const posA = getLiftedNodeAbsolutePosition(grid, nodeA.orbifoldNode, nodeA.voltage);
    const posB = getLiftedNodeAbsolutePosition(grid, nodeB.orbifoldNode, nodeB.voltage);
    
    const dist = distance(posA, posB);
    
    minDist = Math.min(minDist, dist);
    maxDist = Math.max(maxDist, dist);
    totalDist += dist;
    edgeCount++;
    
    if (Math.abs(dist - EXPECTED_DISTANCE) > TOLERANCE) {
      const failure = `Edge ${edgeId}:
    Node A: orbifold=${nodeA.orbifoldNode}, voltage=${formatVoltage(nodeA.voltage)}, pos=(${posA.x.toFixed(2)}, ${posA.y.toFixed(2)})
    Node B: orbifold=${nodeB.orbifoldNode}, voltage=${formatVoltage(nodeB.voltage)}, pos=(${posB.x.toFixed(2)}, ${posB.y.toFixed(2)})
    Distance: ${dist.toFixed(4)} (expected ${EXPECTED_DISTANCE})`;
      failures.push(failure);
    }
  }
  
  const avgDist = edgeCount > 0 ? totalDist / edgeCount : 0;
  
  console.log(`\nEdge distances:`);
  console.log(`  Min: ${minDist.toFixed(4)}`);
  console.log(`  Max: ${maxDist.toFixed(4)}`);
  console.log(`  Avg: ${avgDist.toFixed(4)}`);
  console.log(`  Ratio (max/min): ${(maxDist / minDist).toFixed(4)}`);
  
  return { passed: failures.length === 0, failures, stats: { min: minDist, max: maxDist, avg: avgDist } };
}

/**
 * Test that pgg boundary wrapping matches the wallpaper maze definition.
 */
function testPggBoundaryWrapping(n: number): { passed: boolean; details: string[] } {
  const grid = createOrbifoldGrid("pgg", n);
  buildAdjacency(grid);
  
  const details: string[] = [];
  const maxOdd = 2 * n - 1;
  const L = 2 * n;
  
  console.log(`\n=== Testing pgg boundary wrapping (n=${n}) ===`);
  
  // Test north boundary: (i, 1) should connect to (maxOdd + 1 - i, maxOdd)
  const northTestNode = nodeIdFromCoord([1, 1]);
  const expectedNorthTarget = nodeIdFromCoord([maxOdd, maxOdd]); // (5, 5) for n=3
  
  const northEdgeIds = grid.adjacency?.get(northTestNode) ?? [];
  let foundNorthBoundary = false;
  
  for (const edgeId of northEdgeIds) {
    const edge = grid.edges.get(edgeId);
    if (!edge) continue;
    const half = edge.halfEdges.get(northTestNode);
    if (!half) continue;
    
    if (half.to === expectedNorthTarget) {
      // Check for glide reflection Y signature: [[-1, 0, ...], [0, 1, ...], ...]
      const isGlideReflectionY = half.voltage[0][0] === -1 && half.voltage[0][1] === 0 &&
                                 half.voltage[1][0] === 0 && half.voltage[1][1] === 1;
      if (isGlideReflectionY) {
        foundNorthBoundary = true;
        details.push(`  ✓ North boundary from (1,1) to (${maxOdd},${maxOdd}) with glide reflection Y: ${formatVoltage(half.voltage)}`);
      }
    }
  }
  
  if (!foundNorthBoundary) {
    details.push(`  ✗ Could not find north boundary edge from (1,1) to (${maxOdd},${maxOdd})`);
  }
  
  // Test west boundary: (1, j) should connect to (maxOdd, maxOdd + 1 - j)
  const westTestNode = nodeIdFromCoord([1, 3]); // (1, 3)
  const expectedWestTarget = nodeIdFromCoord([maxOdd, maxOdd + 1 - 3]); // (5, 3) for n=3
  
  const westEdgeIds = grid.adjacency?.get(westTestNode) ?? [];
  let foundWestBoundary = false;
  
  for (const edgeId of westEdgeIds) {
    const edge = grid.edges.get(edgeId);
    if (!edge) continue;
    const half = edge.halfEdges.get(westTestNode);
    if (!half) continue;
    
    if (half.to === expectedWestTarget) {
      // Check for glide reflection X signature: [[1, 0, ...], [0, -1, ...], ...]
      const isGlideReflectionX = half.voltage[0][0] === 1 && half.voltage[0][1] === 0 &&
                                 half.voltage[1][0] === 0 && half.voltage[1][1] === -1;
      if (isGlideReflectionX) {
        foundWestBoundary = true;
        details.push(`  ✓ West boundary from (1,3) to (${maxOdd},${maxOdd - 2}) with glide reflection X: ${formatVoltage(half.voltage)}`);
      }
    }
  }
  
  if (!foundWestBoundary) {
    details.push(`  ✗ Could not find west boundary edge from (1,3) to (${maxOdd},${maxOdd + 1 - 3})`);
  }
  
  // Check total edge count
  const totalEdges = grid.edges.size;
  // For pgg with n nodes in each direction, should have n*(n-1)*2 interior edges + boundary edges
  // Similar to P1/P2 (torus-like topology), should have 2*n*n edges total
  const expectedEdges = 2 * n * n;
  const edgeCountOk = totalEdges === expectedEdges;
  details.push(`  Edge count: ${totalEdges} (expected ${expectedEdges}) ${edgeCountOk ? "✓" : "✗"}`);
  
  const passed = foundNorthBoundary && foundWestBoundary && edgeCountOk;
  
  return { passed, details };
}

/**
 * Check for node collisions in the lifted graph (two nodes at the same position).
 */
function checkNodeCollisions(n: number, m: number): { collisions: number; details: string[] } {
  const grid = createOrbifoldGrid("pgg", n);
  buildAdjacency(grid);
  
  const lifted = constructLiftedGraphFromOrbifold<ColorData>(grid);
  
  for (let i = 0; i < m; i++) {
    processAllNonInteriorOnce(lifted);
  }
  
  const positions = new Map<string, string[]>();
  const TOLERANCE = 0.0001;
  
  for (const [nodeId, node] of lifted.nodes) {
    const pos = getLiftedNodeAbsolutePosition(grid, node.orbifoldNode, node.voltage);
    // Round to avoid floating point issues
    const key = `${Math.round(pos.x / TOLERANCE) * TOLERANCE},${Math.round(pos.y / TOLERANCE) * TOLERANCE}`;
    const existing = positions.get(key) ?? [];
    existing.push(nodeId);
    positions.set(key, existing);
  }
  
  let collisions = 0;
  const details: string[] = [];
  
  for (const [pos, nodeIds] of positions) {
    if (nodeIds.length > 1) {
      collisions++;
      details.push(`  Collision at ${pos}: ${nodeIds.join(", ")}`);
    }
  }
  
  return { collisions, details };
}

// Run the tests
console.log("=== pgg Lifted Edge Distance Test ===");

// Test boundary wrapping first
const boundaryResult = testPggBoundaryWrapping(3);
for (const detail of boundaryResult.details) {
  console.log(detail);
}

// Test edge distances
const testResult = testLiftedEdgeDistances("pgg", 3, 3);

// Check for node collisions
const collisionResult = checkNodeCollisions(3, 3);
console.log(`\nNode collisions: ${collisionResult.collisions}`);
if (collisionResult.collisions > 0) {
  for (const detail of collisionResult.details.slice(0, 5)) {
    console.log(detail);
  }
} else {
  console.log("  ✓ No node collisions detected");
}

// Overall result
let overallPassed = true;

if (!boundaryResult.passed) {
  console.log("\n⚠️ Boundary wrapping check failed");
  overallPassed = false;
}

if (testResult.failures.length > 0) {
  console.log(`\n❌ FAILED: ${testResult.failures.length} edges have incorrect distance`);
  
  // Show first 5 failures
  const failuresToShow = Math.min(testResult.failures.length, 5);
  console.log(`\nShowing first ${failuresToShow} failures:`);
  for (let i = 0; i < failuresToShow; i++) {
    console.log(`\n${testResult.failures[i]}`);
  }
  overallPassed = false;
} else {
  console.log(`\n✅ PASSED: All edges have distance exactly 2`);
}

if (collisionResult.collisions > 0) {
  console.log("\n⚠️ Node collisions detected - lifted graph may have overlapping nodes");
}

// Exit with appropriate code
if (!overallPassed) {
  console.log("\n❌ Overall: FAILED");
  process.exit(1);
} else {
  console.log("\n✅ Overall: PASSED");
}
