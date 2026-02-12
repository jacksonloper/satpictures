/**
 * P2Manifold - 180° rotation at boundaries
 *
 * In a P2 group, boundary wrapping involves 180° rotation.
 */

import type { ManifoldNode, ManifoldType } from "./types";
import { BaseManifold } from "./BaseManifold";

/**
 * P2 Manifold: 180° rotation at boundaries
 *
 * Boundary wrapping rules:
 * - Western edge of (row, 0) wraps to western edge of (n-1-row, 0)
 * - Eastern edge of (row, n-1) wraps to eastern edge of (n-1-row, n-1)
 * - Northern edge of (0, col) wraps to northern edge of (0, n-1-col)
 * - Southern edge of (n-1, col) wraps to southern edge of (n-1, n-1-col)
 */
export class P2Manifold extends BaseManifold {
  readonly type: ManifoldType = "P2";

  getNeighbors(
    node: ManifoldNode
  ): { N: ManifoldNode; S: ManifoldNode; E: ManifoldNode; W: ManifoldNode } {
    const { row, col } = node;
    const n = this.size;

    let N: ManifoldNode, S: ManifoldNode, E: ManifoldNode, W: ManifoldNode;

    // North
    if (row === 0) {
      N = { row: 0, col: n - 1 - col }; // 180° rotation at top edge
    } else {
      N = { row: row - 1, col };
    }

    // South
    if (row === n - 1) {
      S = { row: n - 1, col: n - 1 - col }; // 180° rotation at bottom edge
    } else {
      S = { row: row + 1, col };
    }

    // West
    if (col === 0) {
      W = { row: n - 1 - row, col: 0 }; // 180° rotation at left edge
    } else {
      W = { row, col: col - 1 };
    }

    // East
    if (col === n - 1) {
      E = { row: n - 1 - row, col: n - 1 }; // 180° rotation at right edge
    } else {
      E = { row, col: col + 1 };
    }

    return { N, S, E, W };
  }
}
