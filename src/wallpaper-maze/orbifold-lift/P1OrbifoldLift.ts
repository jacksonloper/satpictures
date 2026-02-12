/**
 * P1OrbifoldLift - Simple torus tiling
 *
 * Creates a multiplier × multiplier grid of copies of the sub-manifold.
 * Edges at boundaries connect to adjacent copies.
 */

import type {
  SubManifold,
  ManifoldType,
  OrbifoldLiftGraph,
  LiftedNode,
  LiftedEdge,
} from "../manifold/types";
import { BaseOrbifoldLift } from "./BaseOrbifoldLift";

/**
 * P1 Orbifold Lift: Simple square tiling
 */
export class P1OrbifoldLift extends BaseOrbifoldLift {
  readonly type = "P1";
  readonly supportedManifolds: ManifoldType[] = ["P1"];

  lift(
    subManifold: SubManifold,
    multiplier: number,
    cellSize: number
  ): OrbifoldLiftGraph {
    const { manifold, blockedNodes } = subManifold;
    const nodes: LiftedNode[] = [];
    const edges: LiftedEdge[] = [];
    const nodeMap = new Map<string, number>(); // positionKey -> nodeId

    // Create nodes for each copy
    let nodeId = 0;
    for (let copyRow = 0; copyRow < multiplier; copyRow++) {
      for (let copyCol = 0; copyCol < multiplier; copyCol++) {
        for (const origNode of manifold.getNodes()) {
          // Skip blocked nodes
          if (blockedNodes.has(manifold.nodeKey(origNode))) {
            continue;
          }

          const x = (copyCol * manifold.size + origNode.col) * cellSize + cellSize / 2;
          const y = (copyRow * manifold.size + origNode.row) * cellSize + cellSize / 2;

          const liftedNode: LiftedNode = {
            id: nodeId,
            x,
            y,
            originalNode: origNode,
            copyIndex: this.getCopyIndex(copyRow, copyCol, multiplier),
          };

          nodes.push(liftedNode);
          nodeMap.set(this.positionKey(copyRow, copyCol, origNode), nodeId);
          nodeId++;
        }
      }
    }

    // Create edges
    for (let copyRow = 0; copyRow < multiplier; copyRow++) {
      for (let copyCol = 0; copyCol < multiplier; copyCol++) {
        for (const origEdge of subManifold.getIncludedEdges()) {
          const fromNode = origEdge.from;
          const toNode = origEdge.to;

          // Determine which copy the "to" node is in
          let toCopyRow = copyRow;
          let toCopyCol = copyCol;

          // Check if this edge wraps
          const neighbors = manifold.getNeighbors(fromNode);
          let wrapsNorth = false,
            wrapsSouth = false,
            wrapsEast = false,
            wrapsWest = false;

          if (neighbors.N.row === toNode.row && neighbors.N.col === toNode.col) {
            if (fromNode.row === 0) wrapsNorth = true;
          }
          if (neighbors.S.row === toNode.row && neighbors.S.col === toNode.col) {
            if (fromNode.row === manifold.size - 1) wrapsSouth = true;
          }
          if (neighbors.E.row === toNode.row && neighbors.E.col === toNode.col) {
            if (fromNode.col === manifold.size - 1) wrapsEast = true;
          }
          if (neighbors.W.row === toNode.row && neighbors.W.col === toNode.col) {
            if (fromNode.col === 0) wrapsWest = true;
          }

          // Adjust target copy based on wrapping
          if (wrapsNorth) toCopyRow = (copyRow - 1 + multiplier) % multiplier;
          if (wrapsSouth) toCopyRow = (copyRow + 1) % multiplier;
          if (wrapsWest) toCopyCol = (copyCol - 1 + multiplier) % multiplier;
          if (wrapsEast) toCopyCol = (copyCol + 1) % multiplier;

          // Look up node IDs
          const fromKey = this.positionKey(copyRow, copyCol, fromNode);
          const toKey = this.positionKey(toCopyRow, toCopyCol, toNode);
          const fromId = nodeMap.get(fromKey);
          const toId = nodeMap.get(toKey);

          if (fromId !== undefined && toId !== undefined) {
            edges.push({
              fromId,
              toId,
              originalEdge: origEdge,
            });
          }
        }
      }
    }

    return this.buildGraph(nodes, edges, manifold);
  }
}
