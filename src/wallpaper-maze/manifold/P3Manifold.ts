/**
 * P3Manifold - 3-fold rotational symmetry
 *
 * In P3, boundaries wrap with 120° rotation relationships.
 * Note: P4 uses the same topology, just different rendering.
 */

import type { ManifoldNode, ManifoldType } from "./types";
import { BaseManifold } from "./BaseManifold";

/**
 * P3 Manifold: 3-fold rotational symmetry
 *
 * Boundary wrapping rules:
 * - North of (0, k) wraps to (n-1-k, n-1)
 * - East of (row, n-1) wraps to (0, n-1-row)
 * - West of (k, 0) wraps to (n-1, n-1-k)
 * - South of (n-1, k) wraps to (n-1-k, 0)
 */
export class P3Manifold extends BaseManifold {
  readonly type: ManifoldType = "P3";

  getNeighbors(
    node: ManifoldNode
  ): { N: ManifoldNode; S: ManifoldNode; E: ManifoldNode; W: ManifoldNode } {
    const { row, col } = node;
    const n = this.size;

    let N: ManifoldNode, S: ManifoldNode, E: ManifoldNode, W: ManifoldNode;

    // North
    if (row === 0) {
      N = { row: n - 1 - col, col: n - 1 };
    } else {
      N = { row: row - 1, col };
    }

    // South
    if (row === n - 1) {
      S = { row: n - 1 - col, col: 0 };
    } else {
      S = { row: row + 1, col };
    }

    // West
    if (col === 0) {
      W = { row: n - 1, col: n - 1 - row };
    } else {
      W = { row, col: col - 1 };
    }

    // East
    if (col === n - 1) {
      E = { row: 0, col: n - 1 - row };
    } else {
      E = { row, col: col + 1 };
    }

    return { N, S, E, W };
  }
}
