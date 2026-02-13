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
  const EXPECTED_DISTANCE = 2;
  const TOLERANCE = 0.0001;
  
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
    
    if (Math.abs(dist - EXPECTED_DISTANCE) > TOLERANCE) {
      const failure = `Edge ${edgeId}:
    Node A: orbifold=${nodeA.orbifoldNode}, voltage=${formatVoltage(nodeA.voltage)}, pos=(${posA.x.toFixed(2)}, ${posA.y.toFixed(2)})
    Node B: orbifold=${nodeB.orbifoldNode}, voltage=${formatVoltage(nodeB.voltage)}, pos=(${posB.x.toFixed(2)}, ${posB.y.toFixed(2)})
    Distance: ${dist.toFixed(4)} (expected ${EXPECTED_DISTANCE})`;
      failures.push(failure);
    }
  }
  
  return { passed: failures.length === 0, failures };
}

/**
 * Format a voltage matrix for display.
 */
function formatVoltage(v: Matrix3x3): string {
  return `[[${v[0].join(",")}], [${v[1].join(",")}], [${v[2].join(",")}]]`;
}

/**
 * Test the specific case mentioned in the problem statement:
 * From (1,1) with voltage I heading north should land at absolute position (1,-1).
 */
function testSpecificNorthCase(n: number): { passed: boolean; details: string } {
  const grid = createOrbifoldGrid("P4", n);
  buildAdjacency(grid);
  
  // The node at (1,1) with voltage I
  const startOrbifoldId = nodeIdFromCoord([1, 1]);
  
  // Get edges from (1,1) - one should be the north edge
  const edgeIds = grid.adjacency?.get(startOrbifoldId) ?? [];
  
  console.log(`\n=== Testing specific North case from (1,1) with n=${n} ===`);
  console.log(`Orbifold node (1,1) has ${edgeIds.length} edges`);
  
  // Find the north edge - for P4 with n=3, from (1,1) heading north goes to orbifold node (5,5)
  // because P4 wrapping: North of (i, 1) wraps to (maxOdd, maxOdd + 1 - i) = (5, 5) for i=1
  const maxOdd = 2 * n - 1;
  const expectedTargetI = maxOdd;  // 5
  const expectedTargetJ = maxOdd + 1 - 1;  // 5
  const expectedTargetOrbifoldId = nodeIdFromCoord([expectedTargetI, expectedTargetJ]);
  
  console.log(`Expected target orbifold node for north: ${expectedTargetOrbifoldId}`);
  
  // The North edge should have the 90° CCW rotation signature: [[0,-1,...], [1,0,...], ...]
  // The West edge has 90° CW rotation signature: [[0,1,...], [-1,0,...], ...]
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
      details: `Could not find north edge from (1,1) to (5,5) with 90° CCW rotation` 
    };
  }
  
  // Calculate absolute position of the neighbor node
  // Apply northVoltage to (5,5)
  const neighborAbsPos = applyMatrix(northVoltage, expectedTargetI, expectedTargetJ);
  
  // Expected: (1, -1) - which is 2 units north of (1, 1)
  const expectedX = 1;
  const expectedY = -1;
  
  const TOLERANCE = 0.0001;
  const passed = Math.abs(neighborAbsPos.x - expectedX) < TOLERANCE && 
                 Math.abs(neighborAbsPos.y - expectedY) < TOLERANCE;
  
  const details = `From (1,1) with I heading north:
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
  console.log(`\n✅ PASSED: All ${testResult.failures.length === 0 ? "edges" : ""} have distance exactly 2`);
}

// Exit with appropriate code
if (!specificResult.passed || !testResult.passed) {
  console.log("\n❌ Overall: FAILED");
  process.exit(1);
} else {
  console.log("\n✅ Overall: PASSED");
}
