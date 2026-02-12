/**
 * P3OrbifoldLift - Hexagonal tiling with 3-fold rotation
 *
 * Creates hexagons, each containing 3 rhombi (rotated 0°, 120°, 240°).
 * This is also used for P4 (which uses the same manifold topology as P3).
 */

import type {
  SubManifold,
  ManifoldType,
  OrbifoldLiftGraph,
  LiftedNode,
  LiftedEdge,
  ManifoldNode,
} from "../manifold/types";
import { BaseOrbifoldLift } from "./BaseOrbifoldLift";

// Shear constants for rhombus rendering
const SHEAR_X = 0.5; // cos(60°)
const SHEAR_Y = Math.sqrt(3) / 2; // sin(60°)

/**
 * P3 Orbifold Lift: Hexagonal tiling with 3 rhombi per hexagon
 * Also compatible with P4 manifolds.
 */
export class P3OrbifoldLift extends BaseOrbifoldLift {
  readonly type: string = "P3";
  readonly supportedManifolds: ManifoldType[] = ["P3"];

  /**
   * Get the center position of a cell in local rhombus coordinates
   */
  private getCellCenterLocal(
    row: number,
    col: number,
    cellSize: number
  ): { x: number; y: number } {
    const baseWidth = cellSize;
    const baseHeight = cellSize * SHEAR_Y;

    const localX = col * baseWidth + row * baseWidth * SHEAR_X;
    const localY = row * baseHeight;

    return {
      x: localX + baseWidth * 0.5 + baseWidth * SHEAR_X * 0.5,
      y: localY + baseHeight * 0.5,
    };
  }

  /**
   * Apply rotation transform around a pivot point
   */
  private applyRotation(
    point: { x: number; y: number },
    angle: number,
    pivot: { x: number; y: number }
  ): { x: number; y: number } {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;

    return {
      x: dx * cos - dy * sin + pivot.x,
      y: dx * sin + dy * cos + pivot.y,
    };
  }

  /**
   * Get pivot point for rotation
   */
  private getPivotPoint(size: number, cellSize: number): { x: number; y: number } {
    return { x: size * cellSize, y: 0 };
  }

  /**
   * Get hexagon translation in the tiled grid
   */
  private getHexagonTranslation(
    hexRow: number,
    hexCol: number,
    size: number,
    cellSize: number
  ): { x: number; y: number } {
    const rhombusWidth = size * cellSize * (1 + SHEAR_X);
    const rhombusHeight = size * cellSize * SHEAR_Y;

    const horizSpacing = rhombusWidth;
    const vertSpacing = 2 * rhombusHeight;

    const x = hexCol * horizSpacing;
    const y = hexRow * vertSpacing + (hexCol % 2) * rhombusHeight;

    return { x, y };
  }

  /**
   * Get position of a node in the lifted graph
   */
  private getNodePosition(
    hexRow: number,
    hexCol: number,
    rhombusIdx: number,
    row: number,
    col: number,
    size: number,
    cellSize: number
  ): { x: number; y: number } {
    const localCenter = this.getCellCenterLocal(row, col, cellSize);
    const pivot = this.getPivotPoint(size, cellSize);
    const rotationAngle = rhombusIdx * 120;
    const rotatedCenter = this.applyRotation(localCenter, rotationAngle, pivot);
    const hexTranslation = this.getHexagonTranslation(hexRow, hexCol, size, cellSize);

    return {
      x: rotatedCenter.x + hexTranslation.x,
      y: rotatedCenter.y + hexTranslation.y,
    };
  }

  /**
   * Create a unique key for a P3 node position
   */
  private p3NodeKey(
    hexRow: number,
    hexCol: number,
    rhombusIdx: number,
    node: ManifoldNode
  ): string {
    return `${hexRow},${hexCol},${rhombusIdx},${node.row},${node.col}`;
  }

  /**
   * Get the neighbor's location (hexRow, hexCol, rhombusIdx) for a P3 node
   */
  private getP3Neighbor(
    hexRow: number,
    hexCol: number,
    rhombusIdx: number,
    fromNode: ManifoldNode,
    _toNode: ManifoldNode,
    direction: "N" | "S" | "E" | "W",
    size: number
  ): { hexRow: number; hexCol: number; rhombusIdx: number } {
    let neighborHexRow = hexRow;
    let neighborHexCol = hexCol;
    let neighborRhombusIdx = rhombusIdx;

    const isNorthBoundary = direction === "N" && fromNode.row === 0;
    const isSouthBoundary = direction === "S" && fromNode.row === size - 1;
    const isEastBoundary = direction === "E" && fromNode.col === size - 1;
    const isWestBoundary = direction === "W" && fromNode.col === 0;

    if (isNorthBoundary || isEastBoundary) {
      // These boundaries connect within the SAME hexagon
      if (isNorthBoundary) {
        neighborRhombusIdx = (rhombusIdx + 1) % 3;
      } else {
        neighborRhombusIdx = (rhombusIdx + 2) % 3;
      }
    } else if (isSouthBoundary || isWestBoundary) {
      // These boundaries connect to ADJACENT hexagons
      if (rhombusIdx === 0) {
        if (isSouthBoundary) {
          neighborHexRow = hexRow + 1;
          neighborRhombusIdx = 1;
        } else {
          neighborHexCol = hexCol - 1;
          if (hexCol % 2 === 1) neighborHexRow = hexRow + 1;
          neighborRhombusIdx = 2;
        }
      } else if (rhombusIdx === 1) {
        if (isSouthBoundary) {
          if (hexCol % 2 === 0) neighborHexRow = hexRow - 1;
          neighborHexCol = hexCol - 1;
          neighborRhombusIdx = 2;
        } else {
          neighborHexRow = hexRow - 1;
          neighborRhombusIdx = 0;
        }
      } else {
        if (isSouthBoundary) {
          neighborHexCol = hexCol + 1;
          if (hexCol % 2 === 0) neighborHexRow = hexRow - 1;
          neighborRhombusIdx = 0;
        } else {
          if (hexCol % 2 === 1) neighborHexRow = hexRow + 1;
          neighborHexCol = hexCol + 1;
          neighborRhombusIdx = 1;
        }
      }
    }

    return { hexRow: neighborHexRow, hexCol: neighborHexCol, rhombusIdx: neighborRhombusIdx };
  }

  /**
   * Detect which direction an edge goes
   */
  private detectDirection(
    fromNode: ManifoldNode,
    toNode: ManifoldNode,
    manifold: SubManifold["manifold"]
  ): "N" | "S" | "E" | "W" | null {
    const neighbors = manifold.getNeighbors(fromNode);
    if (neighbors.N.row === toNode.row && neighbors.N.col === toNode.col) return "N";
    if (neighbors.S.row === toNode.row && neighbors.S.col === toNode.col) return "S";
    if (neighbors.E.row === toNode.row && neighbors.E.col === toNode.col) return "E";
    if (neighbors.W.row === toNode.row && neighbors.W.col === toNode.col) return "W";
    return null;
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

    // Create nodes for each copy (hexRow × hexCol × 3 rhombi)
    let nodeId = 0;
    for (let hexRow = 0; hexRow < multiplier; hexRow++) {
      for (let hexCol = 0; hexCol < multiplier; hexCol++) {
        for (let rhombusIdx = 0; rhombusIdx < 3; rhombusIdx++) {
          for (const origNode of manifold.getNodes()) {
            if (blockedNodes.has(manifold.nodeKey(origNode))) {
              continue;
            }

            const pos = this.getNodePosition(
              hexRow,
              hexCol,
              rhombusIdx,
              origNode.row,
              origNode.col,
              manifold.size,
              cellSize
            );

            const liftedNode: LiftedNode = {
              id: nodeId,
              x: pos.x,
              y: pos.y,
              originalNode: origNode,
              copyIndex: hexRow * multiplier * 3 + hexCol * 3 + rhombusIdx,
            };

            nodes.push(liftedNode);
            nodeMap.set(this.p3NodeKey(hexRow, hexCol, rhombusIdx, origNode), nodeId);
            nodeId++;
          }
        }
      }
    }

    // Create edges
    for (let hexRow = 0; hexRow < multiplier; hexRow++) {
      for (let hexCol = 0; hexCol < multiplier; hexCol++) {
        for (let rhombusIdx = 0; rhombusIdx < 3; rhombusIdx++) {
          for (const origEdge of subManifold.getIncludedEdges()) {
            const direction = this.detectDirection(origEdge.from, origEdge.to, manifold);
            if (direction === null) continue;

            const neighborLoc = this.getP3Neighbor(
              hexRow,
              hexCol,
              rhombusIdx,
              origEdge.from,
              origEdge.to,
              direction,
              manifold.size
            );

            // Check bounds
            if (
              neighborLoc.hexRow < 0 ||
              neighborLoc.hexRow >= multiplier ||
              neighborLoc.hexCol < 0 ||
              neighborLoc.hexCol >= multiplier
            ) {
              continue;
            }

            const fromKey = this.p3NodeKey(hexRow, hexCol, rhombusIdx, origEdge.from);
            const toKey = this.p3NodeKey(
              neighborLoc.hexRow,
              neighborLoc.hexCol,
              neighborLoc.rhombusIdx,
              origEdge.to
            );

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
    }

    return this.buildGraph(nodes, edges, manifold);
  }
}

/**
 * P4OrbifoldLift - Uses P3 manifold but with 4-fold rotation rendering
 * Note: The P4 manifold topology is the same as P3
 */
export class P4OrbifoldLift extends P3OrbifoldLift {
  override readonly type = "P4";
  override readonly supportedManifolds: ManifoldType[] = ["P3"];
}
