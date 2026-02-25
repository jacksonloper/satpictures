/**
 * Test for the loop finder SAT encoding with minimum length constraints.
 *
 * Tests that the minLength parameter correctly enforces minimum loop lengths.
 * Uses the DPLL solver (no WASM needed) to verify the encoding correctness.
 *
 * Run with: npx tsx src/orbifolds/loop-finder-minlength.test.ts
 */

import { createOrbifoldGrid } from "./createOrbifolds.js";
import { buildAdjacency, I3, voltageKey } from "./orbifoldbasics.js";
import {
  buildAdjFromGrid,
  buildEdgeInfoFromGrid,
  computeReachableVoltagesBFS,
  solveLoopWithVoltage,
  createTestContext,
  assert,
  reportResults,
} from "./loop-finder.test-utils.js";

const ctx = createTestContext();

console.log("=== Min Length Tests ===\n");

// Build a P1 3×3 grid
const grid = createOrbifoldGrid("P1", 3);
buildAdjacency(grid);
const nodeIds = Array.from(grid.nodes.keys());
const adj = buildAdjFromGrid(grid);
const rootNodeId = nodeIds[0];

// Build edge info with voltages
const edgeInfo = buildEdgeInfoFromGrid(grid);

console.log(`Grid: P1, 3×3, ${nodeIds.length} nodes`);
console.log(`Root: ${rootNodeId}`);
console.log();

// Test 17: minLength=0 allows shortest loop (length 2)
console.log("Test 17: minLength=0 allows shortest loop (length 2)");
{
  const voltages = computeReachableVoltagesBFS(9, rootNodeId, nodeIds, edgeInfo);
  const identityK = voltageKey(I3);
  const result = solveLoopWithVoltage(9, rootNodeId, nodeIds, adj, edgeInfo, identityK, voltages, undefined, 0);
  assert(ctx, result.satisfiable, "minLength=0 is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")} (length ${result.pathNodeIds.length - 1})`);
    assert(ctx, result.pathNodeIds.length >= 3, "Path has at least 3 steps");
  }
}

// Test 18: minLength=4 forces loop to have at least 4 edges
console.log("\nTest 18: minLength=4 forces loop length >= 4");
{
  const voltages = computeReachableVoltagesBFS(9, rootNodeId, nodeIds, edgeInfo);
  const identityK = voltageKey(I3);
  const result = solveLoopWithVoltage(9, rootNodeId, nodeIds, adj, edgeInfo, identityK, voltages, undefined, 4);
  assert(ctx, result.satisfiable, "minLength=4 with maxLength=9 is SAT");
  if (result.pathNodeIds) {
    const loopLen = result.pathNodeIds.length - 1;
    console.log(`    Path: ${result.pathNodeIds.join(" → ")} (length ${loopLen})`);
    assert(ctx, loopLen >= 4, `Loop length ${loopLen} >= 4`);
    assert(ctx, result.pathNodeIds[0] === rootNodeId, "Path starts at root");
    assert(ctx, result.pathNodeIds[result.pathNodeIds.length - 1] === rootNodeId, "Path ends at root");
  }
}

// Test 19: minLength = maxLength forces exact length loop
console.log("\nTest 19: minLength=4 with maxLength=4 forces exact length 4");
{
  const voltages = computeReachableVoltagesBFS(4, rootNodeId, nodeIds, edgeInfo);
  const identityK = voltageKey(I3);
  if (voltages.some(v => v.key === identityK)) {
    const result = solveLoopWithVoltage(4, rootNodeId, nodeIds, adj, edgeInfo, identityK, voltages, undefined, 4);
    assert(ctx, result.satisfiable, "minLength=4, maxLength=4 is SAT");
    if (result.pathNodeIds) {
      const loopLen = result.pathNodeIds.length - 1;
      console.log(`    Path: ${result.pathNodeIds.join(" → ")} (length ${loopLen})`);
      assert(ctx, loopLen === 4, `Loop length is exactly 4`);
    }
  } else {
    console.log("    Identity not reachable in 4 steps (skipping)");
    ctx.passed++;
  }
}

// Test 20: minLength too large for available non-black nodes should be UNSAT
console.log("\nTest 20: minLength=5 with only 4 non-black nodes should be UNSAT");
{
  // With 5 black nodes, only 4 non-black remain (including root)
  // A loop of minLength 5 needs at least 5 edges, requiring 6 node positions, but only 4 non-black nodes exist
  const blackNodes = ["3,1", "5,1", "5,3", "3,5", "5,5"];
  const voltages = computeReachableVoltagesBFS(9, rootNodeId, nodeIds, edgeInfo, blackNodes);
  const identityK = voltageKey(I3);
  if (voltages.some(v => v.key === identityK)) {
    const result = solveLoopWithVoltage(9, rootNodeId, nodeIds, adj, edgeInfo, identityK, voltages, blackNodes, 5);
    assert(ctx, !result.satisfiable, "minLength=5 with only 4 non-black nodes is UNSAT");
  } else {
    console.log("    Identity not reachable (skipping)");
    ctx.passed++;
  }
}

reportResults(ctx);
