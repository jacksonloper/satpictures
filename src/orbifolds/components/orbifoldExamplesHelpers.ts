/**
 * Pure (non-React) helpers for orbifold example transitions.
 *
 * Extracted so they can be imported by both the viewer component and the
 * throughput benchmark without triggering react-refresh lint warnings.
 */

import {
  type Matrix3x3,
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  matMul,
  matEq,
} from "../orbifoldbasics";
import type { ColorData, EdgeStyleData } from "../createOrbifolds";

/** Check if two node voltages "agree" across a half-edge voltage.
 *  Agreement means: voltageB == voltageA * edgeVoltage
 */
export function voltagesAgree(
  voltageA: Matrix3x3,
  edgeVoltage: Matrix3x3,
  voltageB: Matrix3x3,
): boolean {
  return matEq(matMul(voltageA, edgeVoltage), voltageB);
}

/**
 * Check if the set of "solid" edges (those whose node voltages agree)
 * forms a single connected component over ALL orbifold nodes.
 */
export function isSingleComponent(
  nodeIds: OrbifoldNodeId[],
  solidEdges: Set<OrbifoldEdgeId>,
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
): boolean {
  if (nodeIds.length <= 1) return true;

  const adj = new Map<OrbifoldNodeId, OrbifoldNodeId[]>();
  for (const nid of nodeIds) adj.set(nid, []);

  for (const eid of solidEdges) {
    const edge = grid.edges.get(eid);
    if (!edge) continue;
    const endpoints = Array.from(edge.halfEdges.keys());
    if (endpoints.length === 2) {
      adj.get(endpoints[0])?.push(endpoints[1]);
      adj.get(endpoints[1])?.push(endpoints[0]);
    }
  }

  const visited = new Set<OrbifoldNodeId>();
  const queue = [nodeIds[0]];
  visited.add(nodeIds[0]);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of adj.get(cur) ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited.size === nodeIds.length;
}

/**
 * Compute the set of solid edges from the current node-voltage assignment.
 */
export function computeSolidEdges(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  nodeVoltages: Map<OrbifoldNodeId, Matrix3x3>,
): Set<OrbifoldEdgeId> {
  const solid = new Set<OrbifoldEdgeId>();
  for (const [eid, edge] of grid.edges) {
    const entries = Array.from(edge.halfEdges.entries());
    if (entries.length === 2) {
      const [nA, hA] = entries[0];
      const vA = nodeVoltages.get(nA);
      const vB = nodeVoltages.get(hA.to);
      if (vA && vB && voltagesAgree(vA, hA.voltage, vB)) {
        solid.add(eid);
      }
    } else if (entries.length === 1) {
      const [nA, hA] = entries[0];
      const vA = nodeVoltages.get(nA);
      if (vA && voltagesAgree(vA, hA.voltage, vA)) {
        solid.add(eid);
      }
    }
  }
  return solid;
}

/**
 * Pure (non-React) transition step: attempt one voltage flip.
 *
 * Picks a random dashed edge, proposes flipping one endpoint's voltage to
 * agree, and accepts only if solid edges still form a single connected
 * component.  Returns { attempted: true, accepted } so callers can count.
 *
 * Mutates `nodeVoltages` and `solidEdges` **in-place** when accepted for
 * maximum throughput (the caller should treat these as owned mutable state).
 */
export function doStepPure(
  nodeVoltages: Map<OrbifoldNodeId, Matrix3x3>,
  solidEdges: Set<OrbifoldEdgeId>,
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  nodeIds: OrbifoldNodeId[],
  edgeIds: OrbifoldEdgeId[],
): { attempted: boolean; accepted: boolean } {
  // collect dashed edges
  const dashedEdges: OrbifoldEdgeId[] = [];
  for (const eid of edgeIds) {
    if (!solidEdges.has(eid)) dashedEdges.push(eid);
  }
  if (dashedEdges.length === 0) return { attempted: false, accepted: false };

  // pick random dashed edge
  const eid = dashedEdges[Math.floor(Math.random() * dashedEdges.length)];
  const edge = grid.edges.get(eid);
  if (!edge) return { attempted: false, accepted: false };

  const entries = Array.from(edge.halfEdges.entries());
  if (entries.length !== 2) return { attempted: false, accepted: false };

  // pick a random endpoint to change
  const idx = Math.random() < 0.5 ? 0 : 1;
  const [nodeToChange] = entries[idx];
  const [otherNode, halfFromOther] = entries[1 - idx];

  const vOther = nodeVoltages.get(otherNode);
  if (!vOther) return { attempted: true, accepted: false };
  const requiredVoltage = matMul(vOther, halfFromOther.voltage);

  const currentVoltage = nodeVoltages.get(nodeToChange);
  if (currentVoltage && matEq(currentVoltage, requiredVoltage))
    return { attempted: true, accepted: false };

  // Temporarily apply the change
  const saved = nodeVoltages.get(nodeToChange)!;
  nodeVoltages.set(nodeToChange, requiredVoltage);

  // Compute new solid edges
  const newSolid = computeSolidEdges(grid, nodeVoltages);

  if (isSingleComponent(nodeIds, newSolid, grid)) {
    // Accept — update solidEdges in-place
    solidEdges.clear();
    for (const s of newSolid) solidEdges.add(s);
    return { attempted: true, accepted: true };
  } else {
    // Reject — revert
    nodeVoltages.set(nodeToChange, saved);
    return { attempted: true, accepted: false };
  }
}
