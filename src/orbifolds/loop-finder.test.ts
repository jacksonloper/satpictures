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

import { DPLLSolver } from "../solvers/dpll-solver.js";
import { createOrbifoldGrid } from "./createOrbifolds.js";
import { buildAdjacency } from "./orbifoldbasics.js";
import type { SATSolver } from "../solvers/types.js";

/**
 * Sinz sequential counter encoding for at-most-one constraint.
 * (Same as in loop-finder.worker.ts)
 */
function addSinzAtMostOne(solver: SATSolver, lits: number[]): void {
  const n = lits.length;
  if (n <= 1) return;
  if (n === 2) {
    solver.addClause([-lits[0], -lits[1]]);
    return;
  }
  const regs: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    regs.push(solver.newVariable());
  }
  for (let i = 0; i < n - 1; i++) {
    solver.addClause([-lits[i], regs[i]]);
  }
  for (let i = 0; i < n - 2; i++) {
    solver.addClause([-regs[i], regs[i + 1]]);
  }
  for (let i = 0; i < n - 1; i++) {
    solver.addClause([-lits[i + 1], -regs[i]]);
  }
}

/**
 * Core SAT encoding for loop finding (mirrors loop-finder.worker.ts).
 * loopLength = number of distinct nodes in the loop.
 * Internally uses L = loopLength + 1 steps.
 * Returns { satisfiable, path? } where path is the ordered node IDs if SAT.
 */
function solveLoop(
  loopLength: number,
  rootNodeId: string,
  nodeIds: string[],
  adjacency: Record<string, string[]>,
): { satisfiable: boolean; pathNodeIds?: string[] } {
  const L = loopLength + 1;
  const N = nodeIds.length;
  const solver = new DPLLSolver();

  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    nodeIndex.set(nodeIds[i], i);
  }

  const rootIdx = nodeIndex.get(rootNodeId);
  if (rootIdx === undefined) {
    throw new Error("Root node not found in graph");
  }

  // Create variables: x[t][v]
  const x: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let v = 0; v < N; v++) {
      row.push(solver.newVariable());
    }
    x.push(row);
  }

  // Step 0 is deterministically the root
  solver.addClause([x[0][rootIdx]]);
  for (let v = 0; v < N; v++) {
    if (v !== rootIdx) solver.addClause([-x[0][v]]);
  }

  // Step L-1 is deterministically the root
  solver.addClause([x[L - 1][rootIdx]]);
  for (let v = 0; v < N; v++) {
    if (v !== rootIdx) solver.addClause([-x[L - 1][v]]);
  }

  // One-hot per step: exactly one node active at each intermediate step
  for (let t = 1; t < L - 1; t++) {
    solver.addClause(x[t].slice());
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        solver.addClause([-x[t][i], -x[t][j]]);
      }
    }
  }

  // Adjacency constraints
  for (let t = 1; t < L; t++) {
    for (let v = 0; v < N; v++) {
      const neighbors = adjacency[nodeIds[v]] ?? [];
      const neighborIndices = neighbors.map(nid => nodeIndex.get(nid)).filter((idx): idx is number => idx !== undefined);
      const clause = [-x[t][v], ...neighborIndices.map(nb => x[t - 1][nb])];
      solver.addClause(clause);
    }
  }

  // Non-self-intersecting: each node used at most once across intermediate steps
  for (let v = 0; v < N; v++) {
    const lits: number[] = [];
    for (let t = 1; t < L - 1; t++) {
      lits.push(x[t][v]);
    }
    if (v === rootIdx) {
      // Root must NOT appear at any intermediate step
      for (const lit of lits) {
        solver.addClause([-lit]);
      }
    } else {
      addSinzAtMostOne(solver, lits);
    }
  }

  // Solve
  const result = solver.solve();
  if (!result.satisfiable) {
    return { satisfiable: false };
  }

  const assignment = result.assignment;

  // Extract path
  const path: number[] = [];
  for (let t = 0; t < L; t++) {
    for (let v = 0; v < N; v++) {
      if (assignment.get(x[t][v])) {
        path.push(v);
        break;
      }
    }
  }

  const pathNodeIds = path.map(v => nodeIds[v]);
  return { satisfiable: true, pathNodeIds };
}

/**
 * Build adjacency from an orbifold grid (same logic as OrbifoldsExplorer).
 */
function buildAdjFromGrid(grid: ReturnType<typeof createOrbifoldGrid>): Record<string, string[]> {
  buildAdjacency(grid);
  const nodeIds = Array.from(grid.nodes.keys());
  const adj: Record<string, string[]> = {};
  for (const nodeId of nodeIds) {
    const edgeIds = grid.adjacency?.get(nodeId) ?? [];
    const neighbors: string[] = [];
    for (const edgeId of edgeIds) {
      const edge = grid.edges.get(edgeId);
      if (!edge) continue;
      const halfEdge = edge.halfEdges.get(nodeId);
      if (!halfEdge) continue;
      if (!neighbors.includes(halfEdge.to)) {
        neighbors.push(halfEdge.to);
      }
    }
    adj[nodeId] = neighbors;
  }
  return adj;
}

// ---- Tests ----

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

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
  assert(!result.satisfiable, "Loop of 16 nodes is UNSAT");
}

// Test 2: Loop of 10 nodes should also be UNSAT (only 9 nodes exist)
console.log("\nTest 2: Loop of 10 nodes on 3×3 P1 grid should be UNSAT");
{
  const result = solveLoop(10, rootNodeId, nodeIds, adj);
  assert(!result.satisfiable, "Loop of 10 nodes is UNSAT");
}

// Test 3: Loop of 9 nodes should be SAT (Hamiltonian cycle: visit all 9 nodes)
console.log("\nTest 3: Loop of 9 nodes on 3×3 P1 grid should be SAT (Hamiltonian cycle)");
{
  const result = solveLoop(9, rootNodeId, nodeIds, adj);
  assert(result.satisfiable, "Loop of 9 nodes is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    // Path has 10 steps (9 nodes + return to root)
    assert(result.pathNodeIds.length === 10, "Path has 10 steps (9 nodes + return to root)");
    // Verify path properties
    assert(result.pathNodeIds[0] === rootNodeId, "Path starts at root");
    assert(result.pathNodeIds[result.pathNodeIds.length - 1] === rootNodeId, "Path ends at root");
    // Check all intermediate nodes are unique
    const intermediateNodes = result.pathNodeIds.slice(1, -1);
    const uniqueIntermediate = new Set(intermediateNodes);
    assert(uniqueIntermediate.size === intermediateNodes.length, "All intermediate nodes are unique");
    // Check root doesn't appear in intermediate nodes
    assert(!intermediateNodes.includes(rootNodeId), "Root does not appear in intermediate steps");
    // Check number of distinct nodes = 9
    const allDistinct = new Set(result.pathNodeIds);
    assert(allDistinct.size === 9, "9 distinct nodes visited");
  }
}

// Test 4: Smallest valid loop (2 nodes: root → neighbor → root)
console.log("\nTest 4: Loop of 2 nodes on 3×3 P1 grid should be SAT");
{
  const result = solveLoop(2, rootNodeId, nodeIds, adj);
  assert(result.satisfiable, "Loop of 2 nodes is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    assert(result.pathNodeIds.length === 3, "Path has 3 steps (2 distinct nodes + return)");
    assert(result.pathNodeIds[0] === rootNodeId, "Path starts at root");
    assert(result.pathNodeIds[2] === rootNodeId, "Path ends at root");
    // The intermediate node must be a neighbor of root
    const intermediateNode = result.pathNodeIds[1];
    assert(adj[rootNodeId].includes(intermediateNode), "Intermediate node is neighbor of root");
    assert(adj[intermediateNode].includes(rootNodeId), "Root is neighbor of intermediate node");
    // 2 distinct nodes
    const allDistinct = new Set(result.pathNodeIds);
    assert(allDistinct.size === 2, "2 distinct nodes visited");
  }
}

// Test 5: Verify path adjacency is correct for a found path (4 nodes)
console.log("\nTest 5: Verify all consecutive steps in path are adjacent (4 nodes)");
{
  const result = solveLoop(4, rootNodeId, nodeIds, adj);
  assert(result.satisfiable, "Loop of 4 nodes is SAT");
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
    assert(allAdjacent, "All consecutive steps are adjacent");
    // 4 distinct nodes
    const allDistinct = new Set(result.pathNodeIds);
    assert(allDistinct.size === 4, "4 distinct nodes visited");
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
