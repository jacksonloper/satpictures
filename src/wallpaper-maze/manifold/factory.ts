/**
 * Manifold factory functions
 */

import type { Manifold, ManifoldType } from "./types";
import { P1Manifold } from "./P1Manifold";
import { P2Manifold } from "./P2Manifold";
import { P3Manifold } from "./P3Manifold";
import { PGGManifold } from "./PGGManifold";

/**
 * Create a manifold of the specified type
 */
export function createManifold(type: ManifoldType, size: number): Manifold {
  switch (type) {
    case "P1":
      return new P1Manifold(size);
    case "P2":
      return new P2Manifold(size);
    case "P3":
      return new P3Manifold(size);
    case "PGG":
      return new PGGManifold(size);
    default:
      throw new Error(`Unknown manifold type: ${type}`);
  }
}

/**
 * Get all available manifold types
 */
export function getManifoldTypes(): ManifoldType[] {
  return ["P1", "P2", "P3", "PGG"];
}
