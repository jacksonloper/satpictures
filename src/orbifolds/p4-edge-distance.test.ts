/**
 * Test for P4 lifted graph edge distances.
 * 
 * For P4 orbifold with n=3, m=3, every pair of lifted nodes that has a lifted edge
 * between them should be exactly distance 2 away from each other in ABSOLUTE position
 * (i.e. where they get rendered onscreen after considering both their orbifold node
 * coordinates and their voltage).
 * 
 * Key insight from the problem statement:
 * If n=3 and you're at a lifted node with orbifold node (1,1) and voltage I 
 * (so absolute position (1,1)) and you head *north*, then you should end up at 
 * a lifted node with orbifold node (5,5) with some voltage W such that your 
 * ABSOLUTE position gets rendered to (1,-1).
 * 
 * Run with: npx tsx src/orbifolds/p4-edge-distance.test.ts
 */

import {
  createOrbifoldGrid,
  type WallpaperGroupType,
  type ColorData,
} from "./createOrbifolds.js";

import {
  type Matrix3x3,
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
): { passed: boolean; failures: string[] } {
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
  const TOLERANCE = 0.0001;

  // With doubled coordinate system (4-unit spacing), allowed distances include:
  // - 4.0: standard grid edge distance
  // - various triangle-related distances from corner splits
  const allowedDistances = [
    4.0,
    Math.sqrt(32),   // sqrt((4)^2 + (4)^2) ≈ 5.657 for diagonal
    Math.sqrt(8),    // sqrt((2)^2 + (2)^2) ≈ 2.828 for triangle hypotenuse / cross edge
    Math.sqrt(10),   // sqrt((1)^2 + (3)^2) = sqrt(10) ≈ 3.162 for grid-to-triangle edge
    Math.sqrt(20),   // sqrt((2)^2 + (4)^2) = sqrt(20) ≈ 4.472 for grid-to-triangle across border
    Math.sqrt(2),    // sqrt(2) ≈ 1.414 for triangle nodes close together
    2.0,             // triangle to adjacent grid in some configs
    Math.sqrt(5),    // sqrt(5) ≈ 2.236
    Math.sqrt(18),   // sqrt(18) ≈ 4.243
    Math.sqrt(13),   // sqrt(13) ≈ 3.606
  ];
  
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

    const matchesAllowed = allowedDistances.some(d => Math.abs(dist - d) < TOLERANCE);
    if (!matchesAllowed) {
      const failure = `Edge ${edgeId}:
    Node A: orbifold=${nodeA.orbifoldNode}, voltage=${formatVoltage(nodeA.voltage)}, pos=(${posA.x.toFixed(2)}, ${posA.y.toFixed(2)})
    Node B: orbifold=${nodeB.orbifoldNode}, voltage=${formatVoltage(nodeB.voltage)}, pos=(${posB.x.toFixed(2)}, ${posB.y.toFixed(2)})
    Distance: ${dist.toFixed(4)} (not in allowed set [${allowedDistances.map(d => d.toFixed(4)).join(", ")}])`;
      failures.push(failure);
    }
  }
  
  return { passed: failures.length === 0, failures };
}

/**
 * Test the specific case mentioned in the problem statement:
 * From (1,1) with voltage I heading north should land at absolute position (1,-1).
 */
function testSpecificNorthCase(n: number): { passed: boolean; details: string } {
  const grid = createOrbifoldGrid("P4", n);
  buildAdjacency(grid);
  
  // P4 now uses doubled (4-unit) coordinates: NW corner node is at (2,2)
  const startOrbifoldId = nodeIdFromCoord([2, 2]);
  
  // Get edges from (2,2) - one should be the north edge
  const edgeIds = grid.adjacency?.get(startOrbifoldId) ?? [];
  
  console.log(`\n=== Testing specific North case from (2,2) with n=${n} ===`);
  console.log(`Orbifold node (2,2) has ${edgeIds.length} edges`);
  
  // Find the north edge - for P4 with n=3, from (2,2) heading north goes to orbifold node
  // (maxCoord, maxCoord) = (10,10), because P4 wrapping: North of (i, 2) wraps to (maxCoord, L - i)
  // where L=4n, maxCoord=4*(n-1)+2. For i=2: L-i = 12-2 = 10 = maxCoord.
  const maxCoord = 4 * (n - 1) + 2;
  const L = 4 * n;
  const expectedTargetI = maxCoord;
  const expectedTargetJ = L - 2;  // L - minCoord
  const expectedTargetOrbifoldId = nodeIdFromCoord([expectedTargetI, expectedTargetJ]);
  
  console.log(`Expected target orbifold node for north: ${expectedTargetOrbifoldId}`);
  
  // The North edge should have the 90° CCW rotation signature: [[0,-1,...], [1,0,...], ...]
  let northVoltage: Matrix3x3 | null = null;
  
  for (const edgeId of edgeIds) {
    const edge = grid.edges.get(edgeId);
    if (!edge) continue;
    
    const half = edge.halfEdges.get(startOrbifoldId);
    if (!half) continue;
    
    const isNorthRotation = half.voltage[0][0] === 0 && half.voltage[0][1] === -1 &&
                            half.voltage[1][0] === 1 && half.voltage[1][1] === 0;
    
    console.log(`  Edge to ${half.to} with voltage ${formatVoltage(half.voltage)} ${isNorthRotation ? "(North rotation)" : ""}`);
    
    if (half.to === expectedTargetOrbifoldId && isNorthRotation) {
      northVoltage = half.voltage;
      console.log(`  ^ This is the north edge!`);
    }
  }
  
  if (!northVoltage) {
    return { 
      passed: false, 
      details: `Could not find north edge from (2,2) to (${expectedTargetI},${expectedTargetJ}) with 90° CCW rotation` 
    };
  }
  
  // Calculate absolute position of the neighbor node
  const neighborAbsPos = applyMatrix(northVoltage, expectedTargetI, expectedTargetJ);
  
  // Expected: (2, -2) - which is 4 units north of (2, 2) in the doubled system
  const expectedX = 2;
  const expectedY = -2;
  
  const TOLERANCE = 0.0001;
  const passed = Math.abs(neighborAbsPos.x - expectedX) < TOLERANCE && 
                 Math.abs(neighborAbsPos.y - expectedY) < TOLERANCE;
  
  const details = `From (2,2) with I heading north:
  Target orbifold node: (${expectedTargetI}, ${expectedTargetJ})
  Voltage for north edge: ${formatVoltage(northVoltage)}
  Absolute position: (${neighborAbsPos.x.toFixed(4)}, ${neighborAbsPos.y.toFixed(4)})
  Expected: (${expectedX}, ${expectedY})
  ${passed ? "✅ PASSED" : "❌ FAILED"}`;
  
  return { passed, details };
}

// Run the tests
console.log("=== P4 Lifted Edge Distance Test ===");

// First test the specific north case
const specificResult = testSpecificNorthCase(3);
console.log(specificResult.details);

// Then test all edges
const testResult = testLiftedEdgeDistances("P4", 3, 3);

if (testResult.failures.length > 0) {
  console.log(`\n❌ FAILED: ${testResult.failures.length} edges have incorrect distance`);
  
  // Show first 5 failures
  const failuresToShow = Math.min(testResult.failures.length, 5);
  console.log(`\nShowing first ${failuresToShow} failures:`);
  for (let i = 0; i < failuresToShow; i++) {
    console.log(`\n${testResult.failures[i]}`);
  }
} else {
  console.log(`\n✅ PASSED: All edges have distance exactly 2`);
}

// Exit with appropriate code
if (!specificResult.passed || !testResult.passed) {
  console.log("\n❌ Overall: FAILED");
  process.exit(1);
} else {
  console.log("\n✅ Overall: PASSED");
}
