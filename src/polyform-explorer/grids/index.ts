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
} from './types';

// Utility functions
export {
  applyTransformN,
  normalizeCoords,
  generateAllTransforms,
  getBoundingBox,
  isInGrid,
} from './types';

// Grid definitions
export { squareGridDefinition } from './squareGridDef';
export { hexGridDefinition, offsetToAxial, axialToOffset } from './hexGridDef';
export { triGridDefinition, upTriNeighbors, downTriNeighbors } from './triGridDef';

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
