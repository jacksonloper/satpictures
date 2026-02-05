/**
 * Test for P3 neighbor distance sanity check
 * 
 * For any node in the P3 tiled rendering, the 4 cardinal neighbors should all
 * be approximately equidistant. The ratio between the furthest and closest
 * neighbor should be less than 2.
 * 
 * Run with: npx tsx src/wallpaper-maze/p3-neighbor-distance.test.ts
 */

import { getWallpaperGroup } from "./WallpaperGroups.js";

// Shear constants (same as P3RhombusRenderer)
const SHEAR_X = 0.5;  // cos(60°)
const SHEAR_Y = Math.sqrt(3) / 2;  // sin(60°)

/**
 * Node position in the P3 tiled rendering
 */
interface P3Node {
  hexRow: number;
  hexCol: number;
  rhombusIdx: number;
  fundamentalRow: number;
  fundamentalCol: number;
  // Computed screen position
  x: number;
  y: number;
}

/**
 * Get the center position of a cell in local rhombus coordinates
 */
function getCellCenterLocal(row: number, col: number, cellSize: number): { x: number; y: number } {
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
 * Calculate the pivot point for P3 rotation.
 */
function getPivotPoint(length: number, cellSize: number): { x: number; y: number } {
  return { x: length * cellSize, y: 0 };
}

/**
 * Apply rotation transform around a pivot point
 */
function applyRotation(
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
 * Compute the translation for a hexagon in the tiled grid.
 */
function getHexagonTranslation(
  hexRow: number,
  hexCol: number,
  length: number,
  cellSize: number,
): { x: number; y: number } {
  const rhombusWidth = length * cellSize * (1 + SHEAR_X);
  const rhombusHeight = length * cellSize * SHEAR_Y;
  
  const horizSpacing = rhombusWidth;
  const vertSpacing = 2 * rhombusHeight;
  
  const x = hexCol * horizSpacing;
  const y = hexRow * vertSpacing + (hexCol % 2) * rhombusHeight;
  
  return { x, y };
}

/**
 * Get the screen position of a P3 node
 */
function getNodePosition(node: P3Node, length: number, cellSize: number): { x: number; y: number } {
  const localCenter = getCellCenterLocal(node.fundamentalRow, node.fundamentalCol, cellSize);
  const pivot = getPivotPoint(length, cellSize);
  const rotationAngle = node.rhombusIdx * 120;
  const rotatedCenter = applyRotation(localCenter, rotationAngle, pivot);
  const hexTranslation = getHexagonTranslation(node.hexRow, node.hexCol, length, cellSize);
  
  return {
    x: rotatedCenter.x + hexTranslation.x,
    y: rotatedCenter.y + hexTranslation.y,
  };
}

/**
 * CORRECTED neighbor computation for P3.
 * 
 * Key insights:
 * - Rhombus edge connections within a hexagon:
 *   - R0.Top connects to R1.Right (at row=0, neighbor is in R1 col=length-1)
 *   - R0.Right connects to R2.Top (at col=length-1, neighbor is in R2 row=0)
 *   - R0.Bottom and R0.Left are on the hexagon exterior (connect to adjacent hexagons)
 * - Similar patterns for R1 and R2 (just rotated)
 * - P3 wrapping tells us the fundamental cell coordinates
 * - We need to determine which rhombus/hexagon that wrapped cell is in
 */
function getAdjacentNeighbor_CORRECTED(
  node: P3Node,
  direction: "N" | "S" | "E" | "W",
  length: number,
): P3Node {
  const { hexRow, hexCol, rhombusIdx, fundamentalRow, fundamentalCol } = node;
  
  // Get the fundamental neighbor using wallpaper group wrapping
  const P3_WALLPAPER_GROUP = getWallpaperGroup("P3");
  const neighborFund = P3_WALLPAPER_GROUP.getWrappedNeighbor(fundamentalRow, fundamentalCol, direction, length);
  
  // Determine which rhombus/hexagon the neighbor is in
  let neighborHexRow = hexRow;
  let neighborHexCol = hexCol;
  let neighborRhombusIdx = rhombusIdx;
  
  // Check if we're crossing a boundary
  const isNorthBoundary = direction === "N" && fundamentalRow === 0;
  const isSouthBoundary = direction === "S" && fundamentalRow === length - 1;
  const isEastBoundary = direction === "E" && fundamentalCol === length - 1;
  const isWestBoundary = direction === "W" && fundamentalCol === 0;
  
  if (isNorthBoundary || isEastBoundary) {
    // These boundaries connect to another rhombus within the SAME hexagon
    // N from R0 goes to R1, E from R0 goes to R2
    // N from R1 goes to R2, E from R1 goes to R0
    // N from R2 goes to R0, E from R2 goes to R1
    if (isNorthBoundary) {
      neighborRhombusIdx = (rhombusIdx + 1) % 3;
    } else { // isEastBoundary
      neighborRhombusIdx = (rhombusIdx + 2) % 3;
    }
  } else if (isSouthBoundary || isWestBoundary) {
    // These boundaries connect to an ADJACENT hexagon
    // We need to determine which adjacent hexagon based on the rhombus
    
    // The direction to the adjacent hex depends on which rhombus we're in
    // Each rhombus has its own orientation, so "south" or "west" points differently
    
    // For rhombus 0 (no rotation):
    //   South boundary is at the bottom of the hex
    //   West boundary is at the left of the hex
    // For rhombus 1 (120° rotation):
    //   South boundary is pointing SW
    //   West boundary is pointing NW
    // For rhombus 2 (240° rotation):
    //   South boundary is pointing SE
    //   West boundary is pointing NE
    
    // The wrapped cell is in one of the adjacent rhombi of the adjacent hexagon
    // The specific rhombus depends on how the hexagons tile together
    
    // For now, let's use a simplified approach:
    // Find which adjacent hexagon contains a cell at the wrapped position
    // that is geometrically close to our node
    
    // This requires knowing the hexagon tiling pattern
    if (rhombusIdx === 0) {
      if (isSouthBoundary) {
        // R0 south goes to hex below (or below-left/below-right depending on stagger)
        neighborHexRow = hexRow + 1;
        // The neighbor is in rhombus 1 of that hex (its Right edge connects to our hex's R0 Bottom)
        neighborRhombusIdx = 1;
      } else { // isWestBoundary
        // R0 west goes to hex to the left
        neighborHexCol = hexCol - 1;
        // Adjust row for hex stagger
        if (hexCol % 2 === 1) {
          neighborHexRow = hexRow + 1;
        }
        // The neighbor is in rhombus 2 of that hex
        neighborRhombusIdx = 2;
      }
    } else if (rhombusIdx === 1) {
      if (isSouthBoundary) {
        // R1 south goes to hex above-left
        if (hexCol % 2 === 0) {
          neighborHexRow = hexRow - 1;
        }
        neighborHexCol = hexCol - 1;
        neighborRhombusIdx = 2;
      } else { // isWestBoundary
        // R1 west goes to hex above
        neighborHexRow = hexRow - 1;
        neighborRhombusIdx = 0;
      }
    } else { // rhombusIdx === 2
      if (isSouthBoundary) {
        // R2 south goes to hex to the right
        neighborHexCol = hexCol + 1;
        if (hexCol % 2 === 0) {
          neighborHexRow = hexRow - 1;
        }
        neighborRhombusIdx = 0;
      } else { // isWestBoundary
        // R2 west goes to hex below-right
        if (hexCol % 2 === 1) {
          neighborHexRow = hexRow + 1;
        }
        neighborHexCol = hexCol + 1;
        neighborRhombusIdx = 1;
      }
    }
  }
  
  return {
    hexRow: neighborHexRow,
    hexCol: neighborHexCol,
    rhombusIdx: neighborRhombusIdx,
    fundamentalRow: neighborFund.row,
    fundamentalCol: neighborFund.col,
    x: 0,
    y: 0,
  };
}

/**
 * Calculate Euclidean distance between two points
 */
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Run the neighbor distance ratio test
 */
function runCorrectedAlgorithmTest(length: number, multiplier: number): { passed: boolean; failedCount: number; details: string[] } {
  const cellSize = 20;
  
  // Generate all nodes
  const nodes: P3Node[] = [];
  
  for (let hexRow = 0; hexRow < multiplier; hexRow++) {
    for (let hexCol = 0; hexCol < multiplier; hexCol++) {
      for (let rhombusIdx = 0; rhombusIdx < 3; rhombusIdx++) {
        for (let row = 0; row < length; row++) {
          for (let col = 0; col < length; col++) {
            const node: P3Node = {
              hexRow,
              hexCol,
              rhombusIdx,
              fundamentalRow: row,
              fundamentalCol: col,
              x: 0,
              y: 0,
            };
            
            const pos = getNodePosition(node, length, cellSize);
            node.x = pos.x;
            node.y = pos.y;
            
            nodes.push(node);
          }
        }
      }
    }
  }
  
  console.log(`Generated ${nodes.length} nodes for P3 (length=${length}, multiplier=${multiplier})`);
  
  const directions: Array<"N" | "S" | "E" | "W"> = ["N", "S", "E", "W"];
  let failedCount = 0;
  const details: string[] = [];
  let showDetails = 5; // Show first N failures
  
  for (const node of nodes) {
    // Skip nodes at the boundary of the multiplier grid (their neighbors might be outside)
    const isOnBoundary = node.hexRow === 0 || node.hexRow === multiplier - 1 ||
                          node.hexCol === 0 || node.hexCol === multiplier - 1;
    if (isOnBoundary) continue;
    
    const nodePos = { x: node.x, y: node.y };
    const neighborDistances: { dir: string; dist: number; neighbor: P3Node }[] = [];
    
    for (const dir of directions) {
      const neighborNode = getAdjacentNeighbor_CORRECTED(node, dir, length);
      const neighborPos = getNodePosition(neighborNode, length, cellSize);
      neighborNode.x = neighborPos.x;
      neighborNode.y = neighborPos.y;
      
      const dist = distance(nodePos, neighborPos);
      neighborDistances.push({ dir, dist, neighbor: neighborNode });
    }
    
    const distances = neighborDistances.map(n => n.dist);
    const minDist = Math.min(...distances);
    const maxDist = Math.max(...distances);
    const ratio = maxDist / minDist;
    
    if (ratio >= 2) {
      failedCount++;
      if (showDetails > 0) {
        let detail = `\n❌ FAILED: Node at hex(${node.hexRow},${node.hexCol}) rhombus ${node.rhombusIdx} cell(${node.fundamentalRow},${node.fundamentalCol})`;
        detail += `\n   Position: (${node.x.toFixed(2)}, ${node.y.toFixed(2)})`;
        detail += `\n   Neighbor distances:`;
        for (const nd of neighborDistances) {
          detail += `\n     ${nd.dir}: ${nd.dist.toFixed(2)} at hex(${nd.neighbor.hexRow},${nd.neighbor.hexCol}) rhombus ${nd.neighbor.rhombusIdx} cell(${nd.neighbor.fundamentalRow},${nd.neighbor.fundamentalCol})`;
        }
        detail += `\n   Ratio: ${ratio.toFixed(2)} (max=${maxDist.toFixed(2)}, min=${minDist.toFixed(2)})`;
        details.push(detail);
        showDetails--;
      }
    }
  }
  
  return { passed: failedCount === 0, failedCount, details };
}

// Run tests
console.log("=== P3 Neighbor Distance Ratio Test ===\n");

const length = 4;
const multiplier = 3;

console.log("--- Testing CORRECTED algorithm ---");
const result = runCorrectedAlgorithmTest(length, multiplier);

for (const detail of result.details) {
  console.log(detail);
}

if (result.passed) {
  console.log(`\n✓ PASSED: All interior nodes have neighbor distance ratio < 2`);
} else {
  console.log(`\n❌ FAILED: ${result.failedCount} interior nodes have neighbor distance ratio >= 2`);
  process.exit(1);
}


