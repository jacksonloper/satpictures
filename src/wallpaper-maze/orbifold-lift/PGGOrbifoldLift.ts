/**
 * PGGOrbifoldLift - Glide reflection tiling
 *
 * Creates a 2×2 pattern of copies with different transformations:
 * - (0,0): identity
 * - (1,0): horizontal flip
 * - (0,1): vertical flip
 * - (1,1): 180° rotation
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
 * PGG Orbifold Lift: Glide reflection symmetry
 */
export class PGGOrbifoldLift extends BaseOrbifoldLift {
  readonly type = "PGG";
  readonly supportedManifolds: ManifoldType[] = ["PGG"];

  /**
   * Get the copy type based on position
   * Type 0: fundamental (identity)
   * Type 1: horizontal flip
   * Type 2: vertical flip
   * Type 3: 180° rotation
   */
  private getCopyType(copyRow: number, copyCol: number): number {
    return (copyRow % 2) + 2 * (copyCol % 2);
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
    switch (copyType) {
      case 0: // Identity
        return { row, col };
      case 1: // Horizontal flip
        return { row, col: size - 1 - col };
      case 2: // Vertical flip
        return { row: size - 1 - row, col };
      case 3: // 180° rotation
        return { row: size - 1 - row, col: size - 1 - col };
      default:
        return { row, col };
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

    // Create edges - similar to P1 but with PGG wrapping
    for (let copyRow = 0; copyRow < multiplier; copyRow++) {
      for (let copyCol = 0; copyCol < multiplier; copyCol++) {
        for (const origEdge of subManifold.getIncludedEdges()) {
          const fromNode = origEdge.from;
          const toNode = origEdge.to;

          let toCopyRow = copyRow;
          let toCopyCol = copyCol;

          const neighbors = manifold.getNeighbors(fromNode);

          // Check for boundary wrapping in PGG
          if (neighbors.N.row === toNode.row && neighbors.N.col === toNode.col) {
            if (fromNode.row === 0 && toNode.row === manifold.size - 1) {
              toCopyRow = (copyRow - 1 + multiplier) % multiplier;
            }
          }
          if (neighbors.S.row === toNode.row && neighbors.S.col === toNode.col) {
            if (fromNode.row === manifold.size - 1 && toNode.row === 0) {
              toCopyRow = (copyRow + 1) % multiplier;
            }
          }
          if (neighbors.E.row === toNode.row && neighbors.E.col === toNode.col) {
            if (fromNode.col === manifold.size - 1 && toNode.col === 0) {
              toCopyCol = (copyCol + 1) % multiplier;
            }
          }
          if (neighbors.W.row === toNode.row && neighbors.W.col === toNode.col) {
            if (fromNode.col === 0 && toNode.col === manifold.size - 1) {
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
