/**
 * P2OrbifoldLift - Checkerboard pattern with 180° rotation
 *
 * Creates a multiplier × multiplier grid where alternating copies are rotated 180°.
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
 * P2 Orbifold Lift: Checkerboard pattern with 180° rotation
 */
export class P2OrbifoldLift extends BaseOrbifoldLift {
  readonly type = "P2";
  readonly supportedManifolds: ManifoldType[] = ["P2"];

  /**
   * Get the copy type: 0 = unrotated, 1 = 180° rotated
   */
  private getCopyType(copyRow: number, copyCol: number): number {
    return (copyRow + copyCol) % 2;
  }

  /**
   * Transform position based on copy type
   */
  private transformPosition(
    row: number,
    col: number,
    size: number,
    copyType: number
  ): { row: number; col: number } {
    if (copyType === 0) {
      return { row, col };
    } else {
      return { row: size - 1 - row, col: size - 1 - col };
    }
  }

  lift(
    subManifold: SubManifold,
    multiplier: number,
    cellSize: number
  ): OrbifoldLiftGraph {
    const { manifold, blockedNodes } = subManifold;
    const nodes: LiftedNode[] = [];
    const edges: LiftedEdge[] = [];
    const nodeMap = new Map<string, number>();

    // Create nodes for each copy
    let nodeId = 0;
    for (let copyRow = 0; copyRow < multiplier; copyRow++) {
      for (let copyCol = 0; copyCol < multiplier; copyCol++) {
        const copyType = this.getCopyType(copyRow, copyCol);

        for (const origNode of manifold.getNodes()) {
          if (blockedNodes.has(manifold.nodeKey(origNode))) {
            continue;
          }

          // Transform position based on copy type
          const transformed = this.transformPosition(
            origNode.row,
            origNode.col,
            manifold.size,
            copyType
          );

          const x =
            (copyCol * manifold.size + transformed.col) * cellSize + cellSize / 2;
          const y =
            (copyRow * manifold.size + transformed.row) * cellSize + cellSize / 2;

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

          // Check if this edge wraps (for P2, boundaries stay at edge but mirror position)
          const neighbors = manifold.getNeighbors(fromNode);

          if (neighbors.N.row === toNode.row && neighbors.N.col === toNode.col) {
            if (fromNode.row === 0 && toNode.row === 0) {
              toCopyRow = (copyRow - 1 + multiplier) % multiplier;
            }
          }
          if (neighbors.S.row === toNode.row && neighbors.S.col === toNode.col) {
            if (fromNode.row === manifold.size - 1 && toNode.row === manifold.size - 1) {
              toCopyRow = (copyRow + 1) % multiplier;
            }
          }
          if (neighbors.E.row === toNode.row && neighbors.E.col === toNode.col) {
            if (fromNode.col === manifold.size - 1 && toNode.col === manifold.size - 1) {
              toCopyCol = (copyCol + 1) % multiplier;
            }
          }
          if (neighbors.W.row === toNode.row && neighbors.W.col === toNode.col) {
            if (fromNode.col === 0 && toNode.col === 0) {
              toCopyCol = (copyCol - 1 + multiplier) % multiplier;
            }
          }

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
