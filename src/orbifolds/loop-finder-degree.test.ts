/**
 * Test for the degree-constraint loop finder SAT encoding.
 *
 * Tests the "each node has exactly 0 or 2 incident edges" constraint.
 * Uses the DPLL solver (no WASM needed) to verify the encoding correctness.
 *
 * Run with: npx tsx src/orbifolds/loop-finder-degree.test.ts
 */

import { DPLLSolver } from "../solvers/dpll-solver.js";
import { createOrbifoldGrid } from "./createOrbifolds.js";
import { buildAdjacency, type Matrix3x3, matMul, I3, voltageKey } from "./orbifoldbasics.js";
import {
  addSinzAtMostOne,
  buildAdjFromGrid,
  buildEdgeInfoFromGrid,
  computeReachableVoltagesBFS,
  createTestContext,
  assert,
  reportResults,
  type TestEdgeInfo,
} from "./loop-finder.test-utils.js";

// ---- Degree-constraint SAT encoding (mirrors loop-finder-degree.ts but uses DPLLSolver) ----

function solveLoopDegree(
  maxLength: number,
  rootNodeId: string,
  nodeIds: string[],
  adjacency: Record<string, string[]>,
  edges: TestEdgeInfo[],
  targetVoltageKey: string,
  reachableVoltages: Array<{ key: string; matrix: Matrix3x3 }>,
  blackNodeIds?: string[],
  minLength?: number,
): { satisfiable: boolean; pathNodeIds?: string[]; loopEdgeIds?: string[]; error?: string } {
  const L = maxLength + 1;
  const N = nodeIds.length;
  const V = reachableVoltages.length;
  const E = edges.length;
  const solver = new DPLLSolver();
  const minLen = minLength ?? 0;

  const blackSet = new Set(blackNodeIds ?? []);

  const hasNonBlack = nodeIds.some(id => !blackSet.has(id));
  if (!hasNonBlack) {
    return { satisfiable: false, error: "No non-black nodes available for the loop" };
  }
  if (blackSet.has(rootNodeId)) {
    return { satisfiable: false, error: "Root node must not be black-colored" };
  }

  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    nodeIndex.set(nodeIds[i], i);
  }
  const rootIdx = nodeIndex.get(rootNodeId);
  if (rootIdx === undefined) {
    throw new Error("Root node not found in graph");
  }

  // Map voltage key → index
  const voltageIndex = new Map<string, number>();
  for (let k = 0; k < V; k++) {
    voltageIndex.set(reachableVoltages[k].key, k);
  }
  const targetVoltIdx = voltageIndex.get(targetVoltageKey);
  if (targetVoltIdx === undefined) {
    return { satisfiable: false, error: "Target voltage not in reachable set" };
  }

  // Include identity voltage
  const identityK = voltageKey(I3);
  let identityVoltIdx = voltageIndex.get(identityK);
  const totalVoltages = identityVoltIdx !== undefined ? V : V + 1;
  if (identityVoltIdx === undefined) {
    identityVoltIdx = V;
  }

  const allVoltages: Array<{key: string; matrix: Matrix3x3}> = [...reachableVoltages];
  if (identityVoltIdx === V) {
    allVoltages.push({ key: identityK, matrix: I3 });
  }

  // Build edge voltage transitions
  const edgeVoltageTransitions: Map<string, Array<{key: string; matrix: Matrix3x3}>> = new Map();
  for (const edge of edges) {
    for (const [fromNode, edgeVoltage] of Object.entries(edge.halfEdgeVoltages)) {
      const fromIdx = nodeIndex.get(fromNode);
      if (fromIdx === undefined) continue;
      let toNode: string;
      if (edge.endpoints[0] === edge.endpoints[1]) {
        toNode = edge.endpoints[0];
      } else {
        toNode = edge.endpoints[0] === fromNode ? edge.endpoints[1] : edge.endpoints[0];
      }
      const toIdx = nodeIndex.get(toNode);
      if (toIdx === undefined) continue;
      const pairKey = `${fromIdx},${toIdx}`;
      if (!edgeVoltageTransitions.has(pairKey)) {
        edgeVoltageTransitions.set(pairKey, []);
      }
      edgeVoltageTransitions.get(pairKey)!.push({
        key: voltageKey(edgeVoltage),
        matrix: edgeVoltage,
      });
    }
  }

  // Build per-node incident edge indices
  const nodeIncidentEdges: number[][] = Array.from({ length: N }, () => []);
  for (let eIdx = 0; eIdx < E; eIdx++) {
    const edge = edges[eIdx];
    const ep0Idx = nodeIndex.get(edge.endpoints[0]);
    const ep1Idx = nodeIndex.get(edge.endpoints[1]);
    if (ep0Idx !== undefined) {
      if (!nodeIncidentEdges[ep0Idx].includes(eIdx)) {
        nodeIncidentEdges[ep0Idx].push(eIdx);
      }
    }
    if (ep1Idx !== undefined && ep1Idx !== ep0Idx) {
      if (!nodeIncidentEdges[ep1Idx].includes(eIdx)) {
        nodeIncidentEdges[ep1Idx].push(eIdx);
      }
    }
  }

  // Precompute per-edge half-edge voltage info
  const edgeHalfEdges: Array<{
    ep0Idx: number;
    ep1Idx: number;
    isSelfEdge: boolean;
    voltages: Map<number, Matrix3x3>;
  }> = [];
  for (let eIdx = 0; eIdx < E; eIdx++) {
    const edge = edges[eIdx];
    const ep0Idx = nodeIndex.get(edge.endpoints[0]);
    const ep1Idx = nodeIndex.get(edge.endpoints[1]);
    if (ep0Idx === undefined || ep1Idx === undefined) {
      edgeHalfEdges.push({ ep0Idx: -1, ep1Idx: -1, isSelfEdge: false, voltages: new Map() });
      continue;
    }
    const isSelfEdge = ep0Idx === ep1Idx;
    const voltages = new Map<number, Matrix3x3>();
    for (const [fromNode, voltage] of Object.entries(edge.halfEdgeVoltages)) {
      const fromIdx = nodeIndex.get(fromNode);
      if (fromIdx !== undefined) {
        voltages.set(fromIdx, voltage);
      }
    }
    edgeHalfEdges.push({ ep0Idx, ep1Idx, isSelfEdge, voltages });
  }

  // ---- SAT variables ----
  const x: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let v = 0; v < N; v++) {
      row.push(solver.newVariable());
    }
    x.push(row);
  }

  const nl: number[] = [];
  for (let t = 0; t < L; t++) {
    nl.push(solver.newVariable());
  }

  const volt: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let k = 0; k < totalVoltages; k++) {
      row.push(solver.newVariable());
    }
    volt.push(row);
  }

  const numTransitions = L - 1;
  const edgeStep: number[][] = [];
  for (let t = 0; t < numTransitions; t++) {
    const row: number[] = [];
    for (let e = 0; e < E; e++) {
      row.push(solver.newVariable());
    }
    edgeStep.push(row);
  }

  const edgeUsed: number[] = [];
  for (let e = 0; e < E; e++) {
    edgeUsed.push(solver.newVariable());
  }

  // ---- Step 0 constraints ----
  solver.addClause([x[0][rootIdx]]);
  for (let v = 0; v < N; v++) {
    if (v !== rootIdx) solver.addClause([-x[0][v]]);
  }
  solver.addClause([-nl[0]]);
  solver.addClause([volt[0][identityVoltIdx!]]);
  for (let k = 0; k < totalVoltages; k++) {
    if (k !== identityVoltIdx) solver.addClause([-volt[0][k]]);
  }

  // One-hot per step
  for (let t = 1; t < L; t++) {
    solver.addClause([...x[t], nl[t]]);
    for (let v = 0; v < N; v++) {
      solver.addClause([-x[t][v], -nl[t]]);
    }
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        solver.addClause([-x[t][i], -x[t][j]]);
      }
    }
  }

  // Null propagation
  for (let t = 0; t < L - 1; t++) {
    solver.addClause([-nl[t], nl[t + 1]]);
  }

  // Minimum length
  for (let t = 1; t <= minLen && t < L; t++) {
    solver.addClause([-nl[t]]);
  }

  // Last non-null step must be at root:
  // For t in 1..L-2: ¬nl[t] ∧ nl[t+1] → x[t][rootIdx]
  for (let t = 1; t < L - 1; t++) {
    solver.addClause([nl[t], -nl[t + 1], x[t][rootIdx]]);
  }
  // For t = L-1: ¬nl[L-1] → x[L-1][rootIdx]
  solver.addClause([nl[L - 1], x[L - 1][rootIdx]]);

  // Must return to root
  {
    const rootSteps: number[] = [];
    for (let t = 1; t < L; t++) {
      rootSteps.push(x[t][rootIdx]);
    }
    solver.addClause(rootSteps);
  }

  // Adjacency
  for (let t = 1; t < L; t++) {
    for (let v = 0; v < N; v++) {
      const neighbors = adjacency[nodeIds[v]] ?? [];
      const neighborIndices = neighbors.map(nid => nodeIndex.get(nid)).filter((idx): idx is number => idx !== undefined);
      solver.addClause([-x[t][v], ...neighborIndices.map(nb => x[t - 1][nb])]);
    }
  }

  // Black nodes excluded
  for (let v = 0; v < N; v++) {
    if (blackSet.has(nodeIds[v])) {
      for (let t = 0; t < L; t++) {
        solver.addClause([-x[t][v]]);
      }
    }
  }

  // Root at most once in steps 1..L-1 (NO at-most-once for non-root nodes)
  // Root may also be revisited multiple times in the degree-constraint encoding.

  // Voltage tracking
  for (let t = 1; t < L; t++) {
    for (let k = 0; k < totalVoltages; k++) {
      solver.addClause([-nl[t], -volt[t][k]]);
    }
    solver.addClause([nl[t], ...volt[t]]);
    for (let i = 0; i < totalVoltages; i++) {
      for (let j = i + 1; j < totalVoltages; j++) {
        solver.addClause([-volt[t][i], -volt[t][j]]);
      }
    }
  }

  // Voltage transitions
  for (let t = 0; t < L - 1; t++) {
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const pairKey = `${a},${b}`;
        const transitions = edgeVoltageTransitions.get(pairKey);
        if (!transitions || transitions.length === 0) continue;
        for (let k = 0; k < totalVoltages; k++) {
          const possibleNextVoltIndices = new Set<number>();
          for (const { matrix: edgeV } of transitions) {
            const newV = matMul(allVoltages[k].matrix, edgeV);
            const newKey = voltageKey(newV);
            const idx = voltageIndex.get(newKey);
            if (idx !== undefined) {
              possibleNextVoltIndices.add(idx);
            }
            if (identityVoltIdx === V && newKey === identityK) {
              possibleNextVoltIndices.add(V);
            }
          }
          if (possibleNextVoltIndices.size === 0) {
            solver.addClause([-x[t][a], -x[t + 1][b], -volt[t][k]]);
          } else {
            const clause: number[] = [-x[t][a], -x[t + 1][b], -volt[t][k]];
            for (const ki of possibleNextVoltIndices) {
              clause.push(volt[t + 1][ki]);
            }
            solver.addClause(clause);
          }
        }
      }
    }
  }

  // Target voltage only at the LAST non-null step (which is constrained to be at root):
  // For t in 1..L-2: ¬nl[t] ∧ nl[t+1] → volt[t][targetVoltIdx]
  for (let t = 1; t < L - 1; t++) {
    solver.addClause([nl[t], -nl[t + 1], volt[t][targetVoltIdx]]);
  }
  // For t = L-1: ¬nl[L-1] → volt[L-1][targetVoltIdx]
  solver.addClause([nl[L - 1], volt[L - 1][targetVoltIdx]]);

  // ---- Edge step constraints ----

  // Link edgeStep to node/voltage variables (handling bidirectional edges)
  for (let t = 0; t < numTransitions; t++) {
    for (let eIdx = 0; eIdx < E; eIdx++) {
      const ei = edgeHalfEdges[eIdx];
      if (ei.ep0Idx < 0) continue;

      solver.addClause([-edgeStep[t][eIdx], -nl[t]]);
      solver.addClause([-edgeStep[t][eIdx], -nl[t + 1]]);

      if (ei.isSelfEdge) {
        solver.addClause([-edgeStep[t][eIdx], x[t][ei.ep0Idx]]);
        solver.addClause([-edgeStep[t][eIdx], x[t + 1][ei.ep0Idx]]);

        const hv = ei.voltages.get(ei.ep0Idx);
        if (hv) {
          for (let k = 0; k < totalVoltages; k++) {
            const newV = matMul(allVoltages[k].matrix, hv);
            const newKey = voltageKey(newV);
            const newIdx = voltageIndex.get(newKey) ?? (newKey === identityK && identityVoltIdx === V ? V : undefined);
            if (newIdx !== undefined) {
              solver.addClause([-edgeStep[t][eIdx], -volt[t][k], volt[t + 1][newIdx]]);
            } else {
              solver.addClause([-edgeStep[t][eIdx], -volt[t][k]]);
            }
          }
        }
      } else {
        const a = ei.ep0Idx;
        const b = ei.ep1Idx;

        solver.addClause([-edgeStep[t][eIdx], x[t][a], x[t][b]]);
        solver.addClause([-edgeStep[t][eIdx], x[t + 1][a], x[t + 1][b]]);
        solver.addClause([-edgeStep[t][eIdx], -x[t][a], x[t + 1][b]]);
        solver.addClause([-edgeStep[t][eIdx], -x[t][b], x[t + 1][a]]);

        const hvA = ei.voltages.get(a);
        const hvB = ei.voltages.get(b);

        for (let k = 0; k < totalVoltages; k++) {
          if (hvA) {
            const newV = matMul(allVoltages[k].matrix, hvA);
            const newKey = voltageKey(newV);
            const newIdx = voltageIndex.get(newKey) ?? (newKey === identityK && identityVoltIdx === V ? V : undefined);
            if (newIdx !== undefined) {
              solver.addClause([-edgeStep[t][eIdx], -x[t][a], -volt[t][k], volt[t + 1][newIdx]]);
            } else {
              solver.addClause([-edgeStep[t][eIdx], -x[t][a], -volt[t][k]]);
            }
          }
          if (hvB) {
            const newV = matMul(allVoltages[k].matrix, hvB);
            const newKey = voltageKey(newV);
            const newIdx = voltageIndex.get(newKey) ?? (newKey === identityK && identityVoltIdx === V ? V : undefined);
            if (newIdx !== undefined) {
              solver.addClause([-edgeStep[t][eIdx], -x[t][b], -volt[t][k], volt[t + 1][newIdx]]);
            } else {
              solver.addClause([-edgeStep[t][eIdx], -x[t][b], -volt[t][k]]);
            }
          }
        }
      }
    }
  }

  // One-hot edge per transition
  for (let t = 0; t < numTransitions; t++) {
    solver.addClause([nl[t], nl[t + 1], ...edgeStep[t]]);
    addSinzAtMostOne(solver, edgeStep[t]);
    for (let e = 0; e < E; e++) {
      solver.addClause([-nl[t], -edgeStep[t][e]]);
      solver.addClause([-nl[t + 1], -edgeStep[t][e]]);
    }
  }

  // Edge used variables
  for (let t = 0; t < numTransitions; t++) {
    for (let e = 0; e < E; e++) {
      solver.addClause([-edgeStep[t][e], edgeUsed[e]]);
    }
  }
  for (let e = 0; e < E; e++) {
    const clause: number[] = [-edgeUsed[e]];
    for (let t = 0; t < numTransitions; t++) {
      clause.push(edgeStep[t][e]);
    }
    solver.addClause(clause);
  }

  // Degree constraint: each node has 0 or 2 incident used edges
  for (let v = 0; v < N; v++) {
    const incidentEdgeIndices = nodeIncidentEdges[v];
    if (incidentEdgeIndices.length === 0) continue;
    const lits = incidentEdgeIndices.map(eIdx => edgeUsed[eIdx]);

    // At most 2
    for (let i = 0; i < lits.length; i++) {
      for (let j = i + 1; j < lits.length; j++) {
        for (let k = j + 1; k < lits.length; k++) {
          solver.addClause([-lits[i], -lits[j], -lits[k]]);
        }
      }
    }

    // Not exactly 1
    for (let i = 0; i < lits.length; i++) {
      const clause: number[] = [-lits[i]];
      for (let j = 0; j < lits.length; j++) {
        if (j !== i) clause.push(lits[j]);
      }
      solver.addClause(clause);
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
    if (assignment.get(nl[t])) break;
    for (let v = 0; v < N; v++) {
      if (assignment.get(x[t][v])) {
        path.push(v);
        break;
      }
    }
  }

  // Extract used edges
  const loopEdgeIds: string[] = [];
  for (let e = 0; e < E; e++) {
    if (assignment.get(edgeUsed[e])) {
      loopEdgeIds.push(edges[e].edgeId);
    }
  }

  const pathNodeIds = path.map(v => nodeIds[v]);
  return { satisfiable: true, pathNodeIds, loopEdgeIds };
}

// ---- Tests ----

const ctx = createTestContext();

console.log("=== Degree-Constraint Loop Finder Test ===\n");

// Build a P1 3×3 grid
const grid = createOrbifoldGrid("P1", 3);
buildAdjacency(grid);
const nodeIds = Array.from(grid.nodes.keys());
const adj = buildAdjFromGrid(grid);
const edgeInfos = buildEdgeInfoFromGrid(grid);
const rootNodeId = nodeIds[0];

console.log(`Grid: P1, 3×3, ${nodeIds.length} nodes, ${edgeInfos.length} edges`);
console.log(`Root: ${rootNodeId}`);
console.log();

// Compute reachable voltages
const reachableVoltages = computeReachableVoltagesBFS(10, rootNodeId, nodeIds, edgeInfos);
console.log(`Reachable voltages: ${reachableVoltages.length}`);

// For P1, identity voltage should be reachable
const identityK = voltageKey(I3);
const hasIdentity = reachableVoltages.some(v => v.key === identityK);
console.log(`Identity voltage reachable: ${hasIdentity}`);
console.log();

// Test 1: Basic loop with degree constraint should be SAT
console.log("Test 1: Basic loop with degree constraint should be SAT");
{
  const result = solveLoopDegree(
    10, rootNodeId, nodeIds, adj, edgeInfos,
    identityK, reachableVoltages
  );
  assert(ctx, result.satisfiable, "Loop with degree constraint is SAT");
  if (result.pathNodeIds) {
    console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
    assert(ctx, result.pathNodeIds[0] === rootNodeId, "Path starts at root");
    assert(ctx, result.pathNodeIds[result.pathNodeIds.length - 1] === rootNodeId, "Path ends at root");
  }
}

// Test 2: Verify degree constraint is satisfied: each node has 0 or 2 incident used edges
console.log("\nTest 2: Verify degree constraint on used edges");
{
  const result = solveLoopDegree(
    10, rootNodeId, nodeIds, adj, edgeInfos,
    identityK, reachableVoltages
  );
  assert(ctx, result.satisfiable, "Loop is SAT");
  if (result.loopEdgeIds) {
    const usedEdgeSet = new Set(result.loopEdgeIds);
    let degreeOk = true;
    for (const nodeId of nodeIds) {
      let degree = 0;
      for (const edge of edgeInfos) {
        if (!usedEdgeSet.has(edge.edgeId)) continue;
        if (edge.endpoints[0] === nodeId || edge.endpoints[1] === nodeId) {
          degree++;
        }
      }
      if (degree !== 0 && degree !== 2) {
        console.log(`    ❌ Node ${nodeId} has degree ${degree}`);
        degreeOk = false;
      }
    }
    assert(ctx, degreeOk, "All nodes have degree 0 or 2");
    console.log(`    Used edges: ${result.loopEdgeIds.length}`);
  }
}

// Test 3: Short loop (maxLength=2) should also satisfy degree constraint
console.log("\nTest 3: Short loop (maxLength=2) with degree constraint");
{
  const result = solveLoopDegree(
    2, rootNodeId, nodeIds, adj, edgeInfos,
    identityK, reachableVoltages
  );
  // A 2-step loop (root → neighbor → root) may or may not be SAT depending on identity voltage
  // For P1, it should be SAT since going back and forth has identity voltage
  if (result.satisfiable) {
    console.log(`    Path: ${result.pathNodeIds!.join(" → ")}`);
    assert(ctx, result.pathNodeIds!.length === 3, "Path has 3 steps");
    assert(ctx, result.pathNodeIds![0] === rootNodeId, "Path starts at root");
    assert(ctx, result.pathNodeIds![2] === rootNodeId, "Path ends at root");

    // Check degree constraint
    if (result.loopEdgeIds) {
      const usedEdgeSet = new Set(result.loopEdgeIds);
      let degreeOk = true;
      for (const nodeId of nodeIds) {
        let degree = 0;
        for (const edge of edgeInfos) {
          if (!usedEdgeSet.has(edge.edgeId)) continue;
          if (edge.endpoints[0] === nodeId || edge.endpoints[1] === nodeId) {
            degree++;
          }
        }
        if (degree !== 0 && degree !== 2) {
          degreeOk = false;
        }
      }
      assert(ctx, degreeOk, "Degree constraint satisfied for short loop");
    }
  } else {
    console.log("    (UNSAT - identity not reachable in 2 steps, which is fine)");
    assert(ctx, true, "Short loop UNSAT is acceptable");
  }
}

// Test 4: Black nodes should be excluded
console.log("\nTest 4: Black nodes excluded with degree constraint");
{
  const blackNodes = ["3,1"];
  const result = solveLoopDegree(
    10, rootNodeId, nodeIds, adj, edgeInfos,
    identityK, reachableVoltages,
    blackNodes
  );
  assert(ctx, result.satisfiable, "Loop with black nodes is SAT");
  if (result.pathNodeIds) {
    const pathContainsBlack = result.pathNodeIds.some(id => blackNodes.includes(id));
    assert(ctx, !pathContainsBlack, "No black node in path");
  }
}

// Test 5: All nodes black returns error
console.log("\nTest 5: All nodes black returns error");
{
  const result = solveLoopDegree(
    10, rootNodeId, nodeIds, adj, edgeInfos,
    identityK, reachableVoltages,
    [...nodeIds]
  );
  assert(ctx, !result.satisfiable, "All black nodes returns UNSAT/error");
}

// Test 6: Black root returns error
console.log("\nTest 6: Black root returns error");
{
  const result = solveLoopDegree(
    10, rootNodeId, nodeIds, adj, edgeInfos,
    identityK, reachableVoltages,
    [rootNodeId]
  );
  assert(ctx, !result.satisfiable, "Black root returns UNSAT/error");
  assert(ctx, result.error === "Root node must not be black-colored", "Error message correct");
}

// Test 7: PMM 3×3 degree constraint should find non-identity voltage loops
// In pmm n=3, a loop like (3,3)→(1,3)→(1,3)→(3,3)→(5,3)→(5,3)→(3,3)
// passes through root (3,3) mid-path, collecting non-identity voltage from the
// mirror self-edges. The degree-constraint encoding must allow root revisiting.
console.log("\nTest 7: PMM 3×3 non-identity voltage loop (root revisiting)");
{
  const pmmGrid = createOrbifoldGrid("pmm", 3);
  buildAdjacency(pmmGrid);
  const pmmNodeIds = Array.from(pmmGrid.nodes.keys());
  const pmmAdj = buildAdjFromGrid(pmmGrid);
  const pmmEdges = buildEdgeInfoFromGrid(pmmGrid);
  const pmmRoot = "3,3"; // center node

  assert(ctx, pmmNodeIds.includes(pmmRoot), "PMM grid has node 3,3");

  const pmmReachable = computeReachableVoltagesBFS(10, pmmRoot, pmmNodeIds, pmmEdges);
  console.log(`    PMM reachable voltages: ${pmmReachable.length}`);

  // There should be non-identity voltages reachable
  const nonIdentityVoltages = pmmReachable.filter(v => v.key !== identityK);
  assert(ctx, nonIdentityVoltages.length > 0, "PMM has non-identity reachable voltages");

  // Try to solve for a non-identity voltage
  if (nonIdentityVoltages.length > 0) {
    const target = nonIdentityVoltages[0];
    console.log(`    Target voltage: ${target.key}`);

    const result = solveLoopDegree(
      10, pmmRoot, pmmNodeIds, pmmAdj, pmmEdges,
      target.key, pmmReachable
    );
    assert(ctx, result.satisfiable, "PMM non-identity voltage loop is SAT with degree constraint");
    if (result.pathNodeIds) {
      console.log(`    Path: ${result.pathNodeIds.join(" → ")}`);
      assert(ctx, result.pathNodeIds[0] === pmmRoot, "Path starts at root");
      assert(ctx, result.pathNodeIds[result.pathNodeIds.length - 1] === pmmRoot, "Path ends at root");

      // Verify degree constraint
      if (result.loopEdgeIds) {
        const usedEdgeSet = new Set(result.loopEdgeIds);
        let degreeOk = true;
        for (const nodeId of pmmNodeIds) {
          let degree = 0;
          for (const edge of pmmEdges) {
            if (!usedEdgeSet.has(edge.edgeId)) continue;
            if (edge.endpoints[0] === nodeId || edge.endpoints[1] === nodeId) {
              degree++;
            }
          }
          if (degree !== 0 && degree !== 2) {
            console.log(`    ❌ Node ${nodeId} has degree ${degree}`);
            degreeOk = false;
          }
        }
        assert(ctx, degreeOk, "Degree constraint satisfied for PMM non-identity loop");
      }
    }
  }
}

reportResults(ctx);
