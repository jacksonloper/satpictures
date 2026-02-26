/**
 * Degree-constraint loop finder SAT encoding.
 *
 * Unlike the standard loop finder which requires each node to be used at most
 * once (non-self-intersecting), this encoding allows nodes to be revisited but
 * enforces a degree constraint: considering all the orbifold edges used
 * anywhere in the loop, each node must be incident to exactly 0 or exactly 2
 * of those used edges.
 *
 * Auxiliary variables:
 *   edgeStep[t][e] = "at step t→t+1 transition, orbifold edge e is used"
 *     One-hot over all orbifold edges for each non-null step transition.
 *     Determined by (node at t, node at t+1, voltage at t, voltage at t+1).
 *
 *   edgeUsed[e] = "edge e is used at least once across all steps"
 *     Derived from edgeStep: edgeUsed[e] ↔ OR(edgeStep[t][e] for all t)
 *
 * Degree constraint per node v:
 *   Let E_v = { e : v is an endpoint of e }
 *   sum(edgeUsed[e] for e in E_v) ∈ {0, 2}
 *
 * This file provides the SAT encoding function used by the worker.
 */

import type { CadicalSolver } from "../solvers";
import type { LoopFinderRequest, LoopFinderResponse, VoltageMatrix, OrbifoldEdgeInfo } from "./loop-finder.worker";

/** A 3x3 matrix multiply (same as in the worker). */
function matMulV(A: VoltageMatrix, B: VoltageMatrix): VoltageMatrix {
  const r = (i: 0|1|2, j: 0|1|2): number =>
    A[i][0]*B[0][j] + A[i][1]*B[1][j] + A[i][2]*B[2][j];
  return [
    [r(0,0), r(0,1), r(0,2)],
    [r(1,0), r(1,1), r(1,2)],
    [r(2,0), r(2,1), r(2,2)],
  ];
}

function voltageKeyFromMatrix(V: VoltageMatrix): string {
  return `${V[0][0]},${V[0][1]},${V[0][2]};${V[1][0]},${V[1][1]},${V[1][2]};${V[2][0]},${V[2][1]},${V[2][2]}`;
}

const IDENTITY_MATRIX: VoltageMatrix = [[1,0,0],[0,1,0],[0,0,1]];

/**
 * Sinz sequential counter encoding for at-most-one constraint.
 */
function addSinzAtMostOne(solver: CadicalSolver, lits: number[]): void {
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
 * SAT encoding for loop finding with degree constraint.
 *
 * Variables:
 *   x[t][v] = "node v visited at step t"
 *   nl[t]   = "null at step t"
 *   volt[t][k] = "accumulated voltage at step t is voltage k"
 *   edgeStep[t][e] = "at transition t→t+1, orbifold edge e is traversed"
 *   edgeUsed[e] = "orbifold edge e is used somewhere in the loop"
 *
 * Degree constraint:
 *   For each node v, sum(edgeUsed[e] for e incident to v) ∈ {0, 2}
 */
export function solveLoopFinderDegree(
  req: LoopFinderRequest,
  solver: CadicalSolver,
  postProgress?: (msg: LoopFinderResponse) => void,
): LoopFinderResponse {
  const { maxLength, minLength: minLengthRaw, rootNodeId, nodeIds, adjacency, edges, blackNodeIds,
          targetVoltageKey, reachableVoltages } = req;
  const minLength = minLengthRaw ?? 0;

  if (!targetVoltageKey || !reachableVoltages || reachableVoltages.length === 0) {
    return { success: false, error: "No target voltage specified", messageType: "result" };
  }

  const L = maxLength + 1; // steps 0..maxLength
  const N = nodeIds.length;
  const V = reachableVoltages.length;
  const E = edges.length; // number of orbifold edges

  const blackSet = new Set(blackNodeIds ?? []);

  const hasNonBlack = nodeIds.some(id => !blackSet.has(id));
  if (!hasNonBlack) {
    return { success: false, error: "No non-black nodes available for the loop", messageType: "result" };
  }
  if (blackSet.has(rootNodeId)) {
    return { success: false, error: "Root node must not be black-colored", messageType: "result" };
  }

  // Map nodeId → index
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    nodeIndex.set(nodeIds[i], i);
  }
  const rootIdx = nodeIndex.get(rootNodeId);
  if (rootIdx === undefined) {
    return { success: false, error: "Root node not found in graph", messageType: "result" };
  }

  // Map voltage key → index
  const voltageIndex = new Map<string, number>();
  for (let k = 0; k < V; k++) {
    voltageIndex.set(reachableVoltages[k].key, k);
  }
  const targetVoltIdx = voltageIndex.get(targetVoltageKey);
  if (targetVoltIdx === undefined) {
    return { success: false, error: "Target voltage not in reachable set", messageType: "result" };
  }

  // Include identity voltage
  const identityKey = voltageKeyFromMatrix(IDENTITY_MATRIX);
  let identityVoltIdx = voltageIndex.get(identityKey);
  const totalVoltages = identityVoltIdx !== undefined ? V : V + 1;
  if (identityVoltIdx === undefined) {
    identityVoltIdx = V;
  }

  const allVoltages: Array<{key: string; matrix: VoltageMatrix}> = [...reachableVoltages];
  if (identityVoltIdx === V) {
    allVoltages.push({ key: identityKey, matrix: IDENTITY_MATRIX });
  }

  // Build edge voltage transitions (same as standard method)
  const edgeVoltageTransitions: Map<string, Array<{key: string; matrix: VoltageMatrix}>> = new Map();
  for (const edge of edges) {
    for (const [fromNode, voltage] of Object.entries(edge.halfEdgeVoltages)) {
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
        key: voltageKeyFromMatrix(voltage as VoltageMatrix),
        matrix: voltage as VoltageMatrix,
      });
    }
  }

  // Build per-node incident edge indices (which orbifold edges are incident to each node)
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

  // ---- Create SAT variables ----

  // x[t][v] = "at step t we are at node v"
  const x: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let v = 0; v < N; v++) {
      row.push(solver.newVariable());
    }
    x.push(row);
  }

  // nl[t] = "null at step t"
  const nl: number[] = [];
  for (let t = 0; t < L; t++) {
    nl.push(solver.newVariable());
  }

  // volt[t][k] = "accumulated voltage at step t is voltage k"
  const volt: number[][] = [];
  for (let t = 0; t < L; t++) {
    const row: number[] = [];
    for (let k = 0; k < totalVoltages; k++) {
      row.push(solver.newVariable());
    }
    volt.push(row);
  }

  // edgeStep[t][e] = "at transition t→t+1, orbifold edge e is used"
  // t ranges over 0..L-2 (transitions between consecutive steps)
  const numTransitions = L - 1;
  const edgeStep: number[][] = [];
  for (let t = 0; t < numTransitions; t++) {
    const row: number[] = [];
    for (let e = 0; e < E; e++) {
      row.push(solver.newVariable());
    }
    edgeStep.push(row);
  }

  // edgeUsed[e] = "orbifold edge e is used at least once"
  const edgeUsed: number[] = [];
  for (let e = 0; e < E; e++) {
    edgeUsed.push(solver.newVariable());
  }

  // ---- Constraints (same as standard for basic structure) ----

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

  // At each step: exactly one of {x[t][0], ..., x[t][N-1], nl[t]}
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
  for (let t = 1; t <= minLength && t < L; t++) {
    solver.addClause([-nl[t]]);
  }

  // Early termination: root at t >= 1 => null at t+1
  for (let t = 1; t < L - 1; t++) {
    solver.addClause([-x[t][rootIdx], nl[t + 1]]);
  }

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

  // NO at-most-once constraint for non-root nodes (key difference from standard method)
  // Root still appears at step 0 and must return exactly once
  {
    const rootLits: number[] = [];
    for (let t = 1; t < L; t++) {
      rootLits.push(x[t][rootIdx]);
    }
    addSinzAtMostOne(solver, rootLits);
  }

  // ---- Voltage tracking (same as standard) ----

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

  // Voltage transitions (same as standard)
  for (let t = 0; t < L - 1; t++) {
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const pairKey = `${a},${b}`;
        const transitions = edgeVoltageTransitions.get(pairKey);
        if (!transitions || transitions.length === 0) continue;

        for (let k = 0; k < totalVoltages; k++) {
          const possibleNextVoltIndices = new Set<number>();
          for (const { matrix: edgeV } of transitions) {
            const newV = matMulV(allVoltages[k].matrix, edgeV);
            const newKey = voltageKeyFromMatrix(newV);
            const idx = voltageIndex.get(newKey);
            if (idx !== undefined) {
              possibleNextVoltIndices.add(idx);
            }
            if (identityVoltIdx === V && newKey === identityKey) {
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

  // ---- Edge step variables ----

  // For each edge e with endpoints A and B:
  //   edgeStep[t][e] => we are at one endpoint at t and the other at t+1
  //   edgeStep[t][e] ∧ x[t][A] => x[t+1][B]   (traversing A→B)
  //   edgeStep[t][e] ∧ x[t][B] => x[t+1][A]   (traversing B→A)
  //   edgeStep[t][e] => (x[t][A] ∨ x[t][B])    (at some endpoint at t)
  //   edgeStep[t][e] => not null at t and t+1

  // Precompute per-edge half-edge voltage info
  const edgeHalfEdges: Array<{
    ep0Idx: number;
    ep1Idx: number;
    isSelfEdge: boolean;
    voltages: Map<number, VoltageMatrix>; // fromIdx → halfEdgeVoltage
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
    const voltages = new Map<number, VoltageMatrix>();
    for (const [fromNode, voltage] of Object.entries(edge.halfEdgeVoltages)) {
      const fromIdx = nodeIndex.get(fromNode);
      if (fromIdx !== undefined) {
        voltages.set(fromIdx, voltage as VoltageMatrix);
      }
    }
    edgeHalfEdges.push({ ep0Idx, ep1Idx, isSelfEdge, voltages });
  }

  for (let t = 0; t < numTransitions; t++) {
    for (let eIdx = 0; eIdx < E; eIdx++) {
      const ei = edgeHalfEdges[eIdx];
      if (ei.ep0Idx < 0) continue;

      // Not null constraints
      solver.addClause([-edgeStep[t][eIdx], -nl[t]]);
      solver.addClause([-edgeStep[t][eIdx], -nl[t + 1]]);

      if (ei.isSelfEdge) {
        // Self-edge: must be at the self-edge node at both t and t+1
        solver.addClause([-edgeStep[t][eIdx], x[t][ei.ep0Idx]]);
        solver.addClause([-edgeStep[t][eIdx], x[t + 1][ei.ep0Idx]]);

        // Voltage transition for self-edge
        const hv = ei.voltages.get(ei.ep0Idx);
        if (hv) {
          for (let k = 0; k < totalVoltages; k++) {
            const newV = matMulV(allVoltages[k].matrix, hv);
            const newKey = voltageKeyFromMatrix(newV);
            const newIdx = voltageIndex.get(newKey) ?? (newKey === identityKey && identityVoltIdx === V ? V : undefined);
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

        // Must be at one of the two endpoints at time t
        solver.addClause([-edgeStep[t][eIdx], x[t][a], x[t][b]]);
        // Must be at one of the two endpoints at time t+1
        solver.addClause([-edgeStep[t][eIdx], x[t + 1][a], x[t + 1][b]]);

        // If at A at time t, must be at B at time t+1
        // edgeStep[t][e] ∧ x[t][a] => x[t+1][b]
        solver.addClause([-edgeStep[t][eIdx], -x[t][a], x[t + 1][b]]);
        // If at B at time t, must be at A at time t+1
        // edgeStep[t][e] ∧ x[t][b] => x[t+1][a]
        solver.addClause([-edgeStep[t][eIdx], -x[t][b], x[t + 1][a]]);

        // Voltage transitions for each direction
        const hvA = ei.voltages.get(a); // voltage when traversing from A
        const hvB = ei.voltages.get(b); // voltage when traversing from B

        for (let k = 0; k < totalVoltages; k++) {
          // Direction A→B: edgeStep[t][e] ∧ x[t][a] ∧ volt[t][k] => volt[t+1][k']
          if (hvA) {
            const newV = matMulV(allVoltages[k].matrix, hvA);
            const newKey = voltageKeyFromMatrix(newV);
            const newIdx = voltageIndex.get(newKey) ?? (newKey === identityKey && identityVoltIdx === V ? V : undefined);
            if (newIdx !== undefined) {
              solver.addClause([-edgeStep[t][eIdx], -x[t][a], -volt[t][k], volt[t + 1][newIdx]]);
            } else {
              solver.addClause([-edgeStep[t][eIdx], -x[t][a], -volt[t][k]]);
            }
          }

          // Direction B→A: edgeStep[t][e] ∧ x[t][b] ∧ volt[t][k] => volt[t+1][k']
          if (hvB) {
            const newV = matMulV(allVoltages[k].matrix, hvB);
            const newKey = voltageKeyFromMatrix(newV);
            const newIdx = voltageIndex.get(newKey) ?? (newKey === identityKey && identityVoltIdx === V ? V : undefined);
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

  // If not null at t and not null at t+1, exactly one edgeStep is active
  for (let t = 0; t < numTransitions; t++) {
    // If both steps are not null, at least one edge must be active:
    // nl[t] ∨ nl[t+1] ∨ OR(edgeStep[t][e] for all e)
    solver.addClause([nl[t], nl[t + 1], ...edgeStep[t]]);

    // At most one edge per transition
    addSinzAtMostOne(solver, edgeStep[t]);

    // If either step is null, no edge is active:
    for (let e = 0; e < E; e++) {
      solver.addClause([-nl[t], -edgeStep[t][e]]);
      solver.addClause([-nl[t + 1], -edgeStep[t][e]]);
    }
  }

  // If both steps are not null, at least one edgeStep must match:
  // This is the reverse direction - if x[t][a] ∧ x[t+1][b], then some edge connecting a to b
  // This is already handled by the adjacency + "at least one edge" constraint above.

  // ---- Edge used variables ----

  // edgeStep[t][e] => edgeUsed[e]
  for (let t = 0; t < numTransitions; t++) {
    for (let e = 0; e < E; e++) {
      solver.addClause([-edgeStep[t][e], edgeUsed[e]]);
    }
  }

  // edgeUsed[e] => OR(edgeStep[t][e] for all t)
  for (let e = 0; e < E; e++) {
    const clause: number[] = [-edgeUsed[e]];
    for (let t = 0; t < numTransitions; t++) {
      clause.push(edgeStep[t][e]);
    }
    solver.addClause(clause);
  }

  // ---- Degree constraint ----
  // For each node v, sum(edgeUsed[e] for e incident to v) ∈ {0, 2}
  // Encoding: "at most 2" + "not exactly 1"
  for (let v = 0; v < N; v++) {
    const incidentEdgeIndices = nodeIncidentEdges[v];
    if (incidentEdgeIndices.length === 0) continue;

    const lits = incidentEdgeIndices.map(eIdx => edgeUsed[eIdx]);

    // "At most 2": for every triple, at least one must be false
    for (let i = 0; i < lits.length; i++) {
      for (let j = i + 1; j < lits.length; j++) {
        for (let k = j + 1; k < lits.length; k++) {
          solver.addClause([-lits[i], -lits[j], -lits[k]]);
        }
      }
    }

    // "Not exactly 1": if any edge is used, at least one other must also be used
    // For each e_i: ¬edgeUsed[e_i] ∨ OR(edgeUsed[e_j] for j ≠ i)
    for (let i = 0; i < lits.length; i++) {
      const clause: number[] = [-lits[i]];
      for (let j = 0; j < lits.length; j++) {
        if (j !== i) clause.push(lits[j]);
      }
      solver.addClause(clause);
    }
  }

  // ---- Send progress ----
  const stats = { numVars: solver.getVariableCount(), numClauses: solver.getClauseCount() };
  if (postProgress) {
    postProgress({ success: true, messageType: "progress", stats });
  }

  // ---- Solve ----
  const result = solver.solve();
  if (!result.satisfiable) {
    return { success: false, error: "No loop with degree constraint and this voltage exists", messageType: "result" };
  }

  const assignment = result.assignment;

  // Extract the path
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

  // Extract per-step edge IDs from edgeStep variables
  const pathEdgeIds: string[] = [];
  for (let t = 0; t < path.length - 1; t++) {
    let foundEdge: string | undefined;
    for (let e = 0; e < E; e++) {
      if (assignment.get(edgeStep[t][e])) {
        foundEdge = edges[e].edgeId;
        break;
      }
    }
    pathEdgeIds.push(foundEdge ?? "");
  }

  // Determine used edges
  const loopEdgeIds: string[] = [];
  for (let e = 0; e < E; e++) {
    if (assignment.get(edgeUsed[e])) {
      loopEdgeIds.push(edges[e].edgeId);
    }
  }

  const pathNodeIds = path.map(v => nodeIds[v]);

  return { success: true, messageType: "result", loopEdgeIds, pathNodeIds, pathEdgeIds };
}
