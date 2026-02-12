/**
 * PGGManifold - Glide reflection symmetry
 *
 * In PGG, boundaries wrap with glide reflections (flip + translate).
 */

import type { ManifoldNode, ManifoldType } from "./types";
import { BaseManifold } from "./BaseManifold";

/**
 * PGG Manifold: Glide reflection symmetry
 *
 * Boundary wrapping rules (torus-like but with flips):
 * - North of (0, k) wraps to (n-1, n-k-1)
 * - South of (n-1, k) wraps to (0, n-k-1)
 * - West of (k, 0) wraps to (n-k-1, n-1)
 * - East of (k, n-1) wraps to (n-k-1, 0)
 */
export class PGGManifold extends BaseManifold {
  readonly type: ManifoldType = "PGG";

  getNeighbors(
    node: ManifoldNode
  ): { N: ManifoldNode; S: ManifoldNode; E: ManifoldNode; W: ManifoldNode } {
    const { row, col } = node;
    const n = this.size;

    let N: ManifoldNode, S: ManifoldNode, E: ManifoldNode, W: ManifoldNode;

    // North
    if (row === 0) {
      N = { row: n - 1, col: n - col - 1 };
    } else {
      N = { row: row - 1, col };
    }

    // South
    if (row === n - 1) {
      S = { row: 0, col: n - col - 1 };
    } else {
      S = { row: row + 1, col };
    }

    // West
    if (col === 0) {
      W = { row: n - row - 1, col: n - 1 };
    } else {
      W = { row, col: col - 1 };
    }

    // East
    if (col === n - 1) {
      E = { row: n - row - 1, col: 0 };
    } else {
      E = { row, col: col + 1 };
    }

    return { N, S, E, W };
  }
}
