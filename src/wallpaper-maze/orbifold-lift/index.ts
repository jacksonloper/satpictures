/**
 * OrbifoldLift module exports
 */

// Type exports (re-export from manifold)
export type { OrbifoldLift, OrbifoldLiftGraph, LiftedNode, LiftedEdge } from "../manifold/types";

// Class exports
export { BaseOrbifoldLift } from "./BaseOrbifoldLift";
export { P1OrbifoldLift } from "./P1OrbifoldLift";
export { P2OrbifoldLift } from "./P2OrbifoldLift";
export { P3OrbifoldLift, P4OrbifoldLift } from "./P3OrbifoldLift";
export { PGGOrbifoldLift } from "./PGGOrbifoldLift";

// Factory function
import type { ManifoldType, OrbifoldLift } from "../manifold/types";
import { P1OrbifoldLift } from "./P1OrbifoldLift";
import { P2OrbifoldLift } from "./P2OrbifoldLift";
import { P3OrbifoldLift, P4OrbifoldLift } from "./P3OrbifoldLift";
import { PGGOrbifoldLift } from "./PGGOrbifoldLift";

/**
 * Get all available orbifold lifts
 */
export function getOrbifoldLifts(): OrbifoldLift[] {
  return [
    new P1OrbifoldLift(),
    new P2OrbifoldLift(),
    new P3OrbifoldLift(),
    new P4OrbifoldLift(),
    new PGGOrbifoldLift(),
  ];
}

/**
 * Get orbifold lifts compatible with a given manifold type
 */
export function getCompatibleLifts(manifoldType: ManifoldType): OrbifoldLift[] {
  return getOrbifoldLifts().filter((lift) => lift.supports(manifoldType));
}

/**
 * Get a specific orbifold lift by type
 */
export function getOrbifoldLift(type: string): OrbifoldLift | null {
  const lifts = getOrbifoldLifts();
  return lifts.find((lift) => lift.type === type) ?? null;
}
