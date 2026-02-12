/**
 * P1Manifold - Simple torus with regular wrapping
 *
 * This is the simplest manifold where opposite edges wrap directly.
 */

import type { ManifoldNode, ManifoldType } from "./types";
import { BaseManifold } from "./BaseManifold";

/**
 * P1 Manifold: Simple torus topology
 *
 * Edges wrap around: top↔bottom, left↔right
 */
export class P1Manifold extends BaseManifold {
  readonly type: ManifoldType = "P1";

  getNeighbors(
    node: ManifoldNode
  ): { N: ManifoldNode; S: ManifoldNode; E: ManifoldNode; W: ManifoldNode } {
    const { row, col } = node;
    const n = this.size;

    return {
      N: { row: (row - 1 + n) % n, col },
      S: { row: (row + 1) % n, col },
      E: { row, col: (col + 1) % n },
      W: { row, col: (col - 1 + n) % n },
    };
  }
}
