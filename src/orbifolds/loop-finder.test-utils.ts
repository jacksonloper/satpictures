/**
 * Shared utilities for loop finder tests.
 *
 * Contains SAT encoding functions and helper utilities used across test files.
 */

import { DPLLSolver } from "../solvers/dpll-solver.js";
import { createOrbifoldGrid } from "./createOrbifolds.js";
import { buildAdjacency, type Matrix3x3, matMul, I3, voltageKey } from "./orbifoldbasics.js";
import type { SATSolver } from "../solvers/types.js";

/**
 * Sinz sequential counter encoding for at-most-one constraint.
 * (Same as in loop-finder.worker.ts)
 */
export function addSinzAtMostOne(solver: SATSolver, lits: number[]): void {
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
export function solveLoop(
  loopLength: number,
  rootNodeId: string,
  nodeIds: string[],
  adjacency: Record<string, string[]>,
  blackNodeIds?: string[],
): { satisfiable: boolean; pathNodeIds?: string[]; error?: string } {
  const L = loopLength + 1;
  const N = nodeIds.length;
  const solver = new DPLLSolver();

  // Build set of black node indices
  const blackSet = new Set(blackNodeIds ?? []);

  // Validate: there must be at least one non-black node
  const hasNonBlack = nodeIds.some(id => !blackSet.has(id));
  if (!hasNonBlack) {
    return { satisfiable: false, error: "No non-black nodes available for the loop" };
  }

  // Validate: root must not be black
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
  // Black nodes are excluded entirely — they cannot appear at any step.
  for (let v = 0; v < N; v++) {
    const isBlack = blackSet.has(nodeIds[v]);
    if (isBlack) {
      // Black nodes must not appear at any step
      for (let t = 0; t < L; t++) {
        solver.addClause([-x[t][v]]);
      }
    } else if (v === rootIdx) {
      // Root must NOT appear at any intermediate step
      const lits: number[] = [];
      for (let t = 1; t < L - 1; t++) {
        lits.push(x[t][v]);
      }
      for (const lit of lits) {
        solver.addClause([-lit]);
      }
    } else {
      const lits: number[] = [];
      for (let t = 1; t < L - 1; t++) {
        lits.push(x[t][v]);
      }
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
export function buildAdjFromGrid(grid: ReturnType<typeof createOrbifoldGrid>): Record<string, string[]> {
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

/**
 * Edge info with voltages, mirroring OrbifoldEdgeInfo in the worker.
 */
export interface TestEdgeInfo {
  edgeId: string;
  endpoints: [string, string];
  halfEdgeVoltages: Record<string, Matrix3x3>;
}

/**
 * Build edge info with voltages from an orbifold grid.
 */
export function buildEdgeInfoFromGrid(grid: ReturnType<typeof createOrbifoldGrid>): TestEdgeInfo[] {
  const edgesData: TestEdgeInfo[] = [];
  for (const [edgeId, edge] of grid.edges) {
    const endpoints = Array.from(edge.halfEdges.keys());
    const halfEdgeVoltages: Record<string, Matrix3x3> = {};
    for (const [nodeId, halfEdge] of edge.halfEdges) {
      halfEdgeVoltages[nodeId] = halfEdge.voltage;
    }
    if (endpoints.length === 1) {
      edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[0]], halfEdgeVoltages });
    } else {
      edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[1]], halfEdgeVoltages });
    }
  }
  return edgesData;
}

/**
 * BFS on the orbifold graph (via lifted graph) to find all reachable
 * voltages at the root node within maxLength steps.
 * Mirrors computeReachableVoltages in the worker.
 */
export function computeReachableVoltagesBFS(
  maxLength: number,
  rootNodeId: string,
  nodeIds: string[],
  edges: TestEdgeInfo[],
  blackNodeIds?: string[],
): Array<{ key: string; matrix: Matrix3x3 }> {
  const blackSet = new Set(blackNodeIds ?? []);

  // Build per-node outgoing half-edges
  const outgoing = new Map<string, Array<{to: string; voltage: Matrix3x3}>>();
  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, []);
  }
  for (const edge of edges) {
    for (const [fromNode, voltage] of Object.entries(edge.halfEdgeVoltages)) {
      let toNode: string;
      if (edge.endpoints[0] === edge.endpoints[1]) {
        toNode = edge.endpoints[0];
      } else {
        toNode = edge.endpoints[0] === fromNode ? edge.endpoints[1] : edge.endpoints[0];
      }
      if (!blackSet.has(toNode)) {
        outgoing.get(fromNode)?.push({ to: toNode, voltage });
      }
    }
  }

  type BFSState = { nodeId: string; voltage: Matrix3x3; voltageKeyStr: string };

  const identityK = voltageKey(I3);
  let frontier: BFSState[] = [{ nodeId: rootNodeId, voltage: I3, voltageKeyStr: identityK }];
  const visited = new Set<string>();
  visited.add(`${rootNodeId}#${identityK}`);

  const reachableVoltageMap = new Map<string, Matrix3x3>();

  for (let step = 1; step <= maxLength; step++) {
    const nextFrontier: BFSState[] = [];
    for (const state of frontier) {
      if (blackSet.has(state.nodeId)) continue;
      const neighbors = outgoing.get(state.nodeId) ?? [];
      for (const { to, voltage: edgeVoltage } of neighbors) {
        if (blackSet.has(to)) continue;
        const newVoltage = matMul(state.voltage, edgeVoltage);
        const newVoltageK = voltageKey(newVoltage);
        const stateKey = `${to}#${newVoltageK}`;
        // Record voltage at root before visited check (root+identity is pre-visited)
        if (to === rootNodeId) {
          if (!reachableVoltageMap.has(newVoltageK)) {
            reachableVoltageMap.set(newVoltageK, newVoltage);
          }
        }
        if (!visited.has(stateKey)) {
          visited.add(stateKey);
          nextFrontier.push({ nodeId: to, voltage: newVoltage, voltageKeyStr: newVoltageK });
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return Array.from(reachableVoltageMap.entries()).map(([key, matrix]) => ({ key, matrix }));
}

/**
 * New SAT encoding with max length, null states, and voltage tracking.
 * Mirrors solveLoopFinder in the worker.
 */
export function solveLoopWithVoltage(
  maxLength: number,
  rootNodeId: string,
  nodeIds: string[],
  adjacency: Record<string, string[]>,
  edges: TestEdgeInfo[],
  targetVoltageKey: string,
  reachableVoltages: Array<{ key: string; matrix: Matrix3x3 }>,
  blackNodeIds?: string[],
  minLength?: number,
): { satisfiable: boolean; pathNodeIds?: string[]; error?: string } {
  const L = maxLength + 1;
  const N = nodeIds.length;
  const V = reachableVoltages.length;
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

  // Build full voltage list
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

  // Create SAT variables
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

  // Step 0: at root, not null, identity voltage
  solver.addClause([x[0][rootIdx]]);
  for (let v = 0; v < N; v++) {
    if (v !== rootIdx) solver.addClause([-x[0][v]]);
  }
  solver.addClause([-nl[0]]);
  solver.addClause([volt[0][identityVoltIdx!]]);
  for (let k = 0; k < totalVoltages; k++) {
    if (k !== identityVoltIdx) solver.addClause([-volt[0][k]]);
  }

  // One-hot: exactly one of {nodes..., null}
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

  // Minimum length: forbid null at steps 1..minLen
  for (let t = 1; t <= minLen && t < L; t++) {
    solver.addClause([-nl[t]]);
  }

  // Early termination: root at t >= 1 => null at t+1
  for (let t = 1; t < L - 1; t++) {
    solver.addClause([-x[t][rootIdx], nl[t + 1]]);
  }

  // Must return to root at some point
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
      const clause = [-x[t][v], ...neighborIndices.map(nb => x[t - 1][nb])];
      solver.addClause(clause);
    }
  }

  // Identify nodes with self-edges
  const hasSelfEdge = new Set<number>();
  for (const edge of edges) {
    if (edge.endpoints[0] === edge.endpoints[1]) {
      const idx = nodeIndex.get(edge.endpoints[0]);
      if (idx !== undefined) hasSelfEdge.add(idx);
    }
  }

  // Non-self-intersecting constraints.
  // For nodes WITHOUT self-edges: at most once in steps 1..L-1.
  // For non-root nodes WITH self-edges: "consecutive block" constraint.
  for (let v = 0; v < N; v++) {
    const isBlack = blackSet.has(nodeIds[v]);
    if (isBlack) {
      for (let t = 0; t < L; t++) {
        solver.addClause([-x[t][v]]);
      }
    } else if (v === rootIdx) {
      const rootLits: number[] = [];
      for (let t = 1; t < L; t++) {
        rootLits.push(x[t][rootIdx]);
      }
      addSinzAtMostOne(solver, rootLits);
    } else if (hasSelfEdge.has(v)) {
      // Consecutive block: allow consecutive visits for self-edge traversal
      // but prevent returning after leaving.
      const prevVisited: number[] = [];
      for (let t = 1; t < L; t++) {
        prevVisited.push(solver.newVariable());
      }
      // v != root so x[0][v] is forced false, so prevVisited[0] = false
      solver.addClause([-prevVisited[0]]);

      for (let ti = 0; ti < prevVisited.length; ti++) {
        const t = ti + 1;
        if (ti + 1 < prevVisited.length) {
          solver.addClause([-x[t][v], prevVisited[ti + 1]]);
          solver.addClause([-prevVisited[ti], prevVisited[ti + 1]]);
        }
        solver.addClause([-prevVisited[ti], x[t - 1][v], -x[t][v]]);
      }
    } else {
      const lits: number[] = [];
      for (let t = 1; t < L; t++) {
        lits.push(x[t][v]);
      }
      addSinzAtMostOne(solver, lits);
    }
  }

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

  // Target voltage at return-to-root step
  for (let t = 1; t < L; t++) {
    solver.addClause([-x[t][rootIdx], volt[t][targetVoltIdx]]);
  }

  // Solve
  const result = solver.solve();
  if (!result.satisfiable) {
    return { satisfiable: false };
  }

  const assignment = result.assignment;

  // Extract path (skip null steps)
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

  const pathNodeIds = path.map(v => nodeIds[v]);
  return { satisfiable: true, pathNodeIds };
}

/**
 * Test harness utilities
 */
export interface TestContext {
  passed: number;
  failed: number;
}

export function createTestContext(): TestContext {
  return { passed: 0, failed: 0 };
}

export function assert(ctx: TestContext, condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    ctx.passed++;
  } else {
    console.log(`  ❌ ${message}`);
    ctx.failed++;
  }
}

export function reportResults(ctx: TestContext): void {
  console.log(`\n=== Results: ${ctx.passed} passed, ${ctx.failed} failed ===`);
  if (ctx.failed > 0) {
    process.exit(1);
  }
}
