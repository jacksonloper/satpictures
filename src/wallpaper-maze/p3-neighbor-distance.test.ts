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

// Direction deltas
const DIRECTION_DELTAS = { 
  N: { row: -1, col: 0 }, 
  S: { row: 1, col: 0 }, 
  E: { row: 0, col: 1 }, 
  W: { row: 0, col: -1 } 
};

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
  
  // Position of this cell's top-left corner
  const localX = col * baseWidth + row * baseWidth * SHEAR_X;
  const localY = row * baseHeight;
  
  // Center of the cell (offset by half the cell dimensions)
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
  
  // Translate to pivot origin
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  
  // Rotate
  const rotatedX = dx * cos - dy * sin;
  const rotatedY = dx * sin + dy * cos;
  
  // Translate back
  return {
    x: rotatedX + pivot.x,
    y: rotatedY + pivot.y,
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
  // 1. Get local cell center
  const localCenter = getCellCenterLocal(node.fundamentalRow, node.fundamentalCol, cellSize);
  
  // 2. Apply rotation for the rhombus within the hexagon
  const pivot = getPivotPoint(length, cellSize);
  const rotationAngle = node.rhombusIdx * 120;
  const rotatedCenter = applyRotation(localCenter, rotationAngle, pivot);
  
  // 3. Apply hexagon translation
  const hexTranslation = getHexagonTranslation(node.hexRow, node.hexCol, length, cellSize);
  
  return {
    x: rotatedCenter.x + hexTranslation.x,
    y: rotatedCenter.y + hexTranslation.y,
  };
}

/**
 * Current (buggy) implementation of neighbor computation.
 * This is what we're testing - it should fail the ratio test.
 */
function getAdjacentNeighbor_BUGGY(
  node: P3Node,
  direction: "N" | "S" | "E" | "W",
  length: number,
): P3Node {
  const { hexRow, hexCol, rhombusIdx, fundamentalRow, fundamentalCol } = node;
  
  // Get the fundamental neighbor using wallpaper group wrapping
  const P3_WALLPAPER_GROUP = getWallpaperGroup("P3");
  const neighborFund = P3_WALLPAPER_GROUP.getWrappedNeighbor(fundamentalRow, fundamentalCol, direction, length);
  
  // Check if we crossed a boundary
  const delta = DIRECTION_DELTAS[direction];
  const rawRow = fundamentalRow + delta.row;
  const rawCol = fundamentalCol + delta.col;
  
  let neighborHexRow = hexRow;
  let neighborHexCol = hexCol;
  let neighborRhombusIdx = rhombusIdx;
  
  // If we wrapped, we need to adjust the rhombus index
  if (rawRow < 0 || rawRow >= length || rawCol < 0 || rawCol >= length) {
    if (direction === "N" && rawRow < 0) {
      neighborRhombusIdx = (rhombusIdx + 2) % 3;
    } else if (direction === "S" && rawRow >= length) {
      neighborRhombusIdx = (rhombusIdx + 1) % 3;
    } else if (direction === "E" && rawCol >= length) {
      neighborRhombusIdx = (rhombusIdx + 1) % 3;
    } else if (direction === "W" && rawCol < 0) {
      neighborRhombusIdx = (rhombusIdx + 2) % 3;
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
 * Find the actual geometrically adjacent neighbor by searching all nodes.
 * This is the ground truth - the closest node in the specified direction.
 */
function findGeometricNeighbor(
  node: P3Node,
  direction: "N" | "S" | "E" | "W",
  allNodes: P3Node[],
  length: number,
  cellSize: number,
): P3Node | null {
  const nodePos = { x: node.x, y: node.y };
  
  // Get the fundamental neighbor using wallpaper group - this tells us the cell coordinates
  const P3_WALLPAPER_GROUP = getWallpaperGroup("P3");
  const neighborFund = P3_WALLPAPER_GROUP.getWrappedNeighbor(
    node.fundamentalRow, node.fundamentalCol, direction, length
  );
  
  // Find all nodes with this fundamental coordinate
  const candidateNodes = allNodes.filter(n => 
    n.fundamentalRow === neighborFund.row && n.fundamentalCol === neighborFund.col
  );
  
  if (candidateNodes.length === 0) return null;
  
  // Find the closest one to our node
  let closestNode: P3Node | null = null;
  let closestDist = Infinity;
  
  for (const candidate of candidateNodes) {
    const dx = candidate.x - nodePos.x;
    const dy = candidate.y - nodePos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < closestDist && dist > 0.01) { // Avoid self
      closestDist = dist;
      closestNode = candidate;
    }
  }
  
  return closestNode;
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
 * Run the neighbor distance ratio test using the current (buggy) algorithm
 */
function runBuggyAlgorithmTest(length: number, multiplier: number): { passed: boolean; failedCount: number } {
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
  
  for (const node of nodes) {
    const nodePos = { x: node.x, y: node.y };
    const neighborDistances: number[] = [];
    
    for (const dir of directions) {
      const neighborNode = getAdjacentNeighbor_BUGGY(node, dir, length);
      const neighborPos = getNodePosition(neighborNode, length, cellSize);
      neighborNode.x = neighborPos.x;
      neighborNode.y = neighborPos.y;
      
      const dist = distance(nodePos, neighborPos);
      neighborDistances.push(dist);
    }
    
    const minDist = Math.min(...neighborDistances);
    const maxDist = Math.max(...neighborDistances);
    const ratio = maxDist / minDist;
    
    if (ratio >= 2) {
      failedCount++;
    }
  }
  
  return { passed: failedCount === 0, failedCount };
}

/**
 * Run the neighbor distance ratio test using geometric search (ground truth)
 */
function runGeometricSearchTest(length: number, multiplier: number): { passed: boolean; failedCount: number } {
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
  let sampleOutput = true;
  
  for (const node of nodes) {
    const nodePos = { x: node.x, y: node.y };
    const neighborDistances: { dir: string; dist: number; neighbor: P3Node | null }[] = [];
    
    for (const dir of directions) {
      const neighborNode = findGeometricNeighbor(node, dir, nodes, length, cellSize);
      if (neighborNode) {
        const dist = distance(nodePos, { x: neighborNode.x, y: neighborNode.y });
        neighborDistances.push({ dir, dist, neighbor: neighborNode });
      }
    }
    
    if (neighborDistances.length < 4) continue; // Skip if not all neighbors found
    
    const distances = neighborDistances.map(n => n.dist);
    const minDist = Math.min(...distances);
    const maxDist = Math.max(...distances);
    const ratio = maxDist / minDist;
    
    if (ratio >= 2) {
      if (sampleOutput) {
        console.log(`\n❌ FAILED (geometric): Node at hex(${node.hexRow},${node.hexCol}) rhombus ${node.rhombusIdx} cell(${node.fundamentalRow},${node.fundamentalCol})`);
        console.log(`   Position: (${node.x.toFixed(2)}, ${node.y.toFixed(2)})`);
        console.log(`   Neighbor distances:`);
        for (const nd of neighborDistances) {
          if (nd.neighbor) {
            console.log(`     ${nd.dir}: ${nd.dist.toFixed(2)} at hex(${nd.neighbor.hexRow},${nd.neighbor.hexCol}) rhombus ${nd.neighbor.rhombusIdx} cell(${nd.neighbor.fundamentalRow},${nd.neighbor.fundamentalCol})`);
          }
        }
        console.log(`   Ratio: ${ratio.toFixed(2)} (max=${maxDist.toFixed(2)}, min=${minDist.toFixed(2)})`);
        sampleOutput = false;
      }
      failedCount++;
    }
  }
  
  return { passed: failedCount === 0, failedCount };
}

// Run tests
console.log("=== P3 Neighbor Distance Ratio Test ===\n");

const length = 4;
const multiplier = 3;

console.log("\n--- Test 1: Current (buggy) algorithm ---");
const buggyResult = runBuggyAlgorithmTest(length, multiplier);
if (buggyResult.passed) {
  console.log(`\n✓ PASSED: All nodes have neighbor distance ratio < 2`);
} else {
  console.log(`\n❌ FAILED: ${buggyResult.failedCount} nodes have neighbor distance ratio >= 2`);
}

console.log("\n--- Test 2: Geometric search (ground truth) ---");
const geoResult = runGeometricSearchTest(length, multiplier);
if (geoResult.passed) {
  console.log(`\n✓ PASSED: All nodes have neighbor distance ratio < 2`);
} else {
  console.log(`\n❌ FAILED: ${geoResult.failedCount} nodes have neighbor distance ratio >= 2`);
}

// Final verdict
console.log("\n=== Summary ===");
if (!buggyResult.passed) {
  console.log("Current algorithm FAILS the neighbor distance ratio test.");
  console.log("This indicates the neighbor computation in P3RhombusRenderer needs to be fixed.");
  process.exit(1);
}

