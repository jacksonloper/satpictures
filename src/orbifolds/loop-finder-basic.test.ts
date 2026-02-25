/**
 * Test for the loop finder SAT encoding.
 *
 * Tests the non-self-intersecting loop constraints on orbifold graphs.
 * Uses the DPLL solver (no WASM needed) to verify the encoding correctness.
 *
 * Key test: A 3×3 P1 grid has 9 nodes. A non-self-intersecting loop must visit
 * each node at most once. So the maximum loop length (= number of distinct nodes)
 * is 9 (Hamiltonian cycle). Length 10+ should be UNSAT.
 *
 * Run with: npx tsx src/orbifolds/loop-finder.test.ts
 */

import { createOrbifoldGrid } from "./createOrbifolds.js";
import { buildAdjacency } from "./orbifoldbasics.js";
import {
  solveLoop,
  buildAdjFromGrid,
  createTestContext,
  assert,
  reportResults,
} from "./loop-finder.test-utils.js";

const ctx = createTestContext();

console.log("=== Loop Finder SAT Encoding Test ===\n");
console.log("loopLength = number of distinct nodes in the loop\n");

// Build a P1 3×3 grid
const grid = createOrbifoldGrid("P1", 3);
buildAdjacency(grid);
const nodeIds = Array.from(grid.nodes.keys());
const adj = buildAdjFromGrid(grid);
const rootNodeId = nodeIds[0];

console.log(`Grid: P1, 3×3, ${nodeIds.length} nodes`);
console.log(`Root: ${rootNodeId}`);
console.log(`Node IDs: ${nodeIds.join(", ")}`);
console.log();

// Test 1: Loop of 16 nodes should be UNSAT on a 3×3 grid (only 9 nodes exist)
console.log("Test 1: Loop of 16 nodes on 3×3 P1 grid should be UNSAT");
{
  const result = solveLoop(16, rootNodeId, nodeIds, adj);
  assert(ctx, !result.satisfiable, "Loop of 16 nodes is UNSAT");
}

// Test 2: Loop of 10 nodes should also be UNSAT (only 9 nodes exist)
console.log("\nTest 2: Loop of 10 nodes on 3×3 P1 grid should be UNSAT");
{
  const result = solveLoop(10, rootNodeId, nodeIds, adj);
  assert(ctx, !result.satisfiable, "Loop of 10 nodes is UNSAT");
}

// Test 3: Loop of 9 nodes should be SAT (Hamiltonian cycle: visit all 9 nodes)
console.log("\nTest 3: Loop of 9 nodes on 3×3 P1 grid should be SAT (Hamiltonian cycle)");
{
  const result = solveLoop(9, rootNodeId, nodeIds, adj);
  assert(ctx, result.satisfiable, "Loop of 9 nodes is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    // Path has 10 steps (9 nodes + return to root)
    assert(ctx, result.pathNodeIds.length === 10, "Path has 10 steps (9 nodes + return to root)");
    // Verify path properties
    assert(ctx, result.pathNodeIds[0] === rootNodeId, "Path starts at root");
    assert(ctx, result.pathNodeIds[result.pathNodeIds.length - 1] === rootNodeId, "Path ends at root");
    // Check all intermediate nodes are unique
    const intermediateNodes = result.pathNodeIds.slice(1, -1);
    const uniqueIntermediate = new Set(intermediateNodes);
    assert(ctx, uniqueIntermediate.size === intermediateNodes.length, "All intermediate nodes are unique");
    // Check root doesn't appear in intermediate nodes
    assert(ctx, !intermediateNodes.includes(rootNodeId), "Root does not appear in intermediate steps");
    // Check number of distinct nodes = 9
    const allDistinct = new Set(result.pathNodeIds);
    assert(ctx, allDistinct.size === 9, "9 distinct nodes visited");
  }
}

// Test 4: Smallest valid loop (2 nodes: root → neighbor → root)
console.log("\nTest 4: Loop of 2 nodes on 3×3 P1 grid should be SAT");
{
  const result = solveLoop(2, rootNodeId, nodeIds, adj);
  assert(ctx, result.satisfiable, "Loop of 2 nodes is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    assert(ctx, result.pathNodeIds.length === 3, "Path has 3 steps (2 distinct nodes + return)");
    assert(ctx, result.pathNodeIds[0] === rootNodeId, "Path starts at root");
    assert(ctx, result.pathNodeIds[2] === rootNodeId, "Path ends at root");
    // The intermediate node must be a neighbor of root
    const intermediateNode = result.pathNodeIds[1];
    assert(ctx, adj[rootNodeId].includes(intermediateNode), "Intermediate node is neighbor of root");
    assert(ctx, adj[intermediateNode].includes(rootNodeId), "Root is neighbor of intermediate node");
    // 2 distinct nodes
    const allDistinct = new Set(result.pathNodeIds);
    assert(ctx, allDistinct.size === 2, "2 distinct nodes visited");
  }
}

// Test 5: Verify path adjacency is correct for a found path (4 nodes)
console.log("\nTest 5: Verify all consecutive steps in path are adjacent (4 nodes)");
{
  const result = solveLoop(4, rootNodeId, nodeIds, adj);
  assert(ctx, result.satisfiable, "Loop of 4 nodes is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    let allAdjacent = true;
    for (let i = 0; i < result.pathNodeIds.length - 1; i++) {
      const from = result.pathNodeIds[i];
      const to = result.pathNodeIds[i + 1];
      if (!adj[from].includes(to)) {
        allAdjacent = false;
        console.log(`    ❌ Step ${i}→${i+1}: ${from} → ${to} are not adjacent`);
      }
    }
    assert(ctx, allAdjacent, "All consecutive steps are adjacent");
    // 4 distinct nodes
    const allDistinct = new Set(result.pathNodeIds);
    assert(ctx, allDistinct.size === 4, "4 distinct nodes visited");
  }
}

// Test 6: Black nodes should not appear in the path
console.log("\nTest 6: Black nodes should not appear in the path");
{
  // Mark 1,1's neighbor 3,1 as black
  const blackNodes = ["3,1"];
  const result = solveLoop(4, rootNodeId, nodeIds, adj, blackNodes);
  assert(ctx, result.satisfiable, "Loop of 4 nodes with 1 black node is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    const pathContainsBlack = result.pathNodeIds.some(id => blackNodes.includes(id));
    assert(ctx, !pathContainsBlack, "No black node appears in the path");
    // Still verify adjacency
    let allAdjacent = true;
    for (let i = 0; i < result.pathNodeIds.length - 1; i++) {
      const from = result.pathNodeIds[i];
      const to = result.pathNodeIds[i + 1];
      if (!adj[from].includes(to)) {
        allAdjacent = false;
      }
    }
    assert(ctx, allAdjacent, "All consecutive steps are adjacent");
  }
}

// Test 7: Black root node should return an error
console.log("\nTest 7: Black root node should return error");
{
  const blackNodes = [rootNodeId];
  const result = solveLoop(4, rootNodeId, nodeIds, adj, blackNodes);
  assert(ctx, !result.satisfiable, "Black root returns UNSAT/error");
  assert(ctx, result.error === "Root node must not be black-colored", "Error message mentions black root");
}

// Test 8: All nodes black should return error
console.log("\nTest 8: All nodes black should return error");
{
  const result = solveLoop(2, rootNodeId, nodeIds, adj, [...nodeIds]);
  assert(ctx, !result.satisfiable, "All black nodes returns UNSAT/error");
  assert(ctx, result.error === "No non-black nodes available for the loop", "Error message mentions no non-black nodes");
}

// Test 9: Multiple black nodes reducing available path should make long loop UNSAT
console.log("\nTest 9: Many black nodes making Hamiltonian cycle impossible");
{
  // With 5 black nodes out of 9, only 4 non-black remain (including root)
  // A loop of 5 distinct nodes should be UNSAT
  const blackNodes = ["3,1", "5,1", "5,3", "3,5", "5,5"];
  const result = solveLoop(5, rootNodeId, nodeIds, adj, blackNodes);
  assert(ctx, !result.satisfiable, "Loop of 5 nodes with only 4 non-black is UNSAT");
}

// Test 10: Loop with black nodes but still feasible short path
console.log("\nTest 10: Short loop avoiding black nodes");
{
  // Black out all except root and its neighbor 1,3
  const blackNodes = ["3,1", "5,1", "5,3", "3,3", "3,5", "5,5"];
  const result = solveLoop(2, rootNodeId, nodeIds, adj, blackNodes);
  assert(ctx, result.satisfiable, "Loop of 2 with restricted non-black nodes is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    const pathContainsBlack = result.pathNodeIds.some(id => blackNodes.includes(id));
    assert(ctx, !pathContainsBlack, "No black node in the path");
  }
}

reportResults(ctx);
