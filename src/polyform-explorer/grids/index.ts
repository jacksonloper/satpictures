/**
 * Grid Definitions Index
 * 
 * Exports all grid definitions and related types for the polyform explorer.
 */

// Types
export type {
  Coord,
  NeighborInfo,
  TransformResult,
  Vertex,
  GridDefinition,
  CellEdges,
  EdgeState,
} from './types';

// Utility functions
export {
  applyTransformN,
  normalizeCoords,
  generateAllTransforms,
  getBoundingBox,
  isInGrid,
  createEmptyEdgeState,
  toggleEdge,
  transformEdgeState,
  rotateEdgeState,
  flipEdgeState,
} from './types';

// Grid definitions
export { squareGridDefinition } from './squareGridDef';
export { hexGridDefinition } from './hexGridDef';
export { triGridDefinition, upTriNeighbors, downTriNeighbors } from './triGridDef';

// Unified tiling solver
export type { UnifiedPlacement, UnifiedTilingResult, EdgeAdjacencyViolation } from './unifiedTiling';
export { 
  gridToCoords, 
  generateAllPlacements, 
  solveUnifiedTiling, 
  findPlacementOverlaps,
  checkEdgeAdjacencyConsistency,
} from './unifiedTiling';

// Unified React components
export { UnifiedTilingViewer } from './UnifiedTilingViewer';
export type { UnifiedTilingViewerProps } from './UnifiedTilingViewer';
export { UnifiedGridEditor } from './UnifiedGridEditor';
export type { UnifiedGridEditorProps, EditorMode } from './UnifiedGridEditor';

// Import for the lookup map
import { squareGridDefinition } from './squareGridDef';
import { hexGridDefinition } from './hexGridDef';
import { triGridDefinition } from './triGridDef';
import type { GridDefinition } from './types';

/**
 * Map from polyform type name to grid definition.
 */
export const gridDefinitions: Record<string, GridDefinition> = {
  polyomino: squareGridDefinition,
  polyhex: hexGridDefinition,
  polyiamond: triGridDefinition,
  // Aliases
  square: squareGridDefinition,
  hex: hexGridDefinition,
  triangle: triGridDefinition,
};

/**
 * Get the grid definition for a polyform type.
 */
export function getGridDefinition(polyformType: string): GridDefinition {
  const def = gridDefinitions[polyformType];
  if (!def) {
    throw new Error(`Unknown polyform type: ${polyformType}`);
  }
  return def;
}
