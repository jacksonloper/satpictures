/**
 * Manifold module exports
 *
 * This module provides the core abstractions for wallpaper mazes:
 * - Manifold: A graph with nodes and edges on a wallpaper group topology
 * - SubManifold: A manifold with a subset of edges
 * - OrbifoldLift: Transforms a sub-manifold into a larger tiled graph
 */

// Type exports
export type {
  ManifoldNode,
  ManifoldEdge,
  ManifoldType,
  Manifold,
  SubManifold,
  LiftedNode,
  LiftedEdge,
  OrbifoldLiftGraph,
  OrbifoldLift,
} from "./types";

// Class exports
export { BaseManifold } from "./BaseManifold";
export { P1Manifold } from "./P1Manifold";
export { P2Manifold } from "./P2Manifold";
export { P3Manifold } from "./P3Manifold";
export { PGGManifold } from "./PGGManifold";
export { SubManifoldImpl } from "./SubManifoldImpl";

// Factory exports
export { createManifold, getManifoldTypes } from "./factory";
