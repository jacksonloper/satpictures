/**
 * Verify correct voltages for all P3 border directions
 */

function applyMatrix(m: number[][], x: number, y: number): [number, number] {
  return [
    m[0][0]*x + m[0][1]*y + m[0][2],
    m[1][0]*x + m[1][1]*y + m[1][2],
  ];
}

const n = 3;
const maxOdd = 2 * n - 1;  // 5

console.log("=== P3 Voltage Analysis for all border directions (n=3) ===\n");

// For P3, the fundamental domain tiles with 120° rotations.
// The key insight is that adjacent domains are rotated 120° relative to each other.
// This affects where the "same" point appears in different domains.

// Let me think about this more geometrically.
// In P3 tiling, going from one domain to its neighbor means:
// 1. The content is rotated 120°
// 2. The domain is translated to tile next to ours
//
// For north neighbor: the adjacent domain to the north is rotated 120° CCW.
// For west neighbor: the adjacent domain to the west is rotated 120° CW.
// (Based on how the P3 orbifold structure works)

// The fundamental domain spans coords 1 to 5 (odd only), so it's effectively
// a 3×3 grid. The domain covers from 0 to 6 in coordinate space.

// NORTH: from (i, 1) to orbifold node (maxOdd, maxOdd+1-i) = (5, 6-i)
// The neighbor position should be 2 units north of source: (?, j-2) = (?, -1)
// But what x-coordinate?
//
// User says (1,1)→N should be at (3,-1), not (1,-1).
// The +2 in x comes from the 120° rotation effect.
//
// Let me work out what makes sense geometrically:
// In P3 tiling, when you go north across the boundary, you enter a domain
// that's rotated 120° CCW. The point (5,5) in that domain corresponds to
// a position that's been rotated+translated.

// NORTH: source (i, 1), target (5, 6-i), want position (i+2, -1)
console.log("=== NORTH ===");
for (let i = 1; i <= 5; i += 2) {
  const newI = 5;
  const newJ = 6 - i;
  
  // User says (1,1)→N→(3,-1), so pattern is (i+2, -1)
  const wantX = i + 2;
  const wantY = -1;
  
  // Using 120° CCW: [[0,-1,tx],[1,1,ty]] × (newI, newJ) = (-newJ+tx, newI+newJ+ty)
  // Want (-newJ+tx, newI+newJ+ty) = (wantX, wantY)
  // tx = wantX + newJ
  // ty = wantY - newI - newJ
  const tx = wantX + newJ;
  const ty = wantY - newI - newJ;
  
  console.log(`(${i},1) → (${newI},${newJ}): want (${wantX},${wantY}), need tx=${tx}, ty=${ty}`);
  
  // Current formula: tx = i + newJ, ty = -1 - newI - newJ
  const curTx = i + newJ;
  const curTy = -1 - newI - newJ;
  console.log(`  Current: tx=${curTx}, ty=${curTy}`);
  console.log(`  Fix: tx needs +2`);
}

// SOUTH: source (i, maxOdd), target (1, 6-i), want position (?, maxOdd+2)
// By symmetry with north, the x-offset should also be +2
console.log("\n=== SOUTH ===");
for (let i = 1; i <= 5; i += 2) {
  const newI = 1;
  const newJ = 6 - i;
  
  // Pattern should be (i+2, maxOdd+2) = (i+2, 7)
  const wantX = i + 2;
  const wantY = maxOdd + 2;
  
  // Using 120° CCW: [[0,-1,tx],[1,1,ty]] × (newI, newJ) = (-newJ+tx, newI+newJ+ty)
  const tx = wantX + newJ;
  const ty = wantY - newI - newJ;
  
  console.log(`(${i},5) → (${newI},${newJ}): want (${wantX},${wantY}), need tx=${tx}, ty=${ty}`);
  
  const curTx = i + newJ;
  const curTy = maxOdd + 2 - newI - newJ;
  console.log(`  Current: tx=${curTx}, ty=${curTy}`);
  console.log(`  Fix: tx needs +2`);
}

// EAST: source (maxOdd, j), target (6-j, 1)
// Using 120° CW: [[1,1,tx],[-1,0,ty]] × (newI, newJ) = (newI+newJ+tx, -newI+ty)
// Want position (maxOdd+2, ?)
console.log("\n=== EAST ===");
for (let j = 1; j <= 5; j += 2) {
  const newI = 6 - j;
  const newJ = 1;
  
  // For east, the y-offset should be +2 (by symmetry with north x-offset)
  const wantX = maxOdd + 2;  // = 7
  const wantY = j + 2;
  
  // Using 120° CW: [[1,1,tx],[-1,0,ty]] × (newI, newJ) = (newI+newJ+tx, -newI+ty)
  // Want (newI+newJ+tx, -newI+ty) = (wantX, wantY)
  // tx = wantX - newI - newJ
  // ty = wantY + newI
  const tx = wantX - newI - newJ;
  const ty = wantY + newI;
  
  console.log(`(5,${j}) → (${newI},${newJ}): want (${wantX},${wantY}), need tx=${tx}, ty=${ty}`);
  
  // Current formula: tx = maxOdd+2-newI-newJ, ty = j+newI
  const curTx = maxOdd + 2 - newI - newJ;
  const curTy = j + newI;
  console.log(`  Current: tx=${curTx}, ty=${curTy}`);
  
  if (tx !== curTx) console.log(`  Fix: tx needs ${tx - curTx > 0 ? '+' : ''}${tx - curTx}`);
  if (ty !== curTy) console.log(`  Fix: ty needs ${ty - curTy > 0 ? '+' : ''}${ty - curTy}`);
}

// WEST: source (1, j), target (6-j, maxOdd)
// Using 120° CW: [[1,1,tx],[-1,0,ty]] × (newI, newJ) = (newI+newJ+tx, -newI+ty)
// Want position (-1, ?)
console.log("\n=== WEST ===");
for (let j = 1; j <= 5; j += 2) {
  const newI = 6 - j;
  const newJ = maxOdd;  // = 5
  
  // For west, by symmetry the y-offset should be +2
  const wantX = -1;
  const wantY = j + 2;
  
  // Using 120° CW: [[1,1,tx],[-1,0,ty]] × (newI, newJ) = (newI+newJ+tx, -newI+ty)
  const tx = wantX - newI - newJ;
  const ty = wantY + newI;
  
  console.log(`(1,${j}) → (${newI},${newJ}): want (${wantX},${wantY}), need tx=${tx}, ty=${ty}`);
  
  // Current formula: tx = -1-newI-newJ, ty = j+newI
  const curTx = -1 - newI - newJ;
  const curTy = j + newI;
  console.log(`  Current: tx=${curTx}, ty=${curTy}`);
  
  if (tx !== curTx) console.log(`  Fix: tx needs ${tx - curTx > 0 ? '+' : ''}${tx - curTx}`);
  if (ty !== curTy) console.log(`  Fix: ty needs ${ty - curTy > 0 ? '+' : ''}${ty - curTy}`);
}

console.log("\n=== SUMMARY ===");
console.log("North: tx needs +2");
console.log("South: tx needs +2");
console.log("East: ty needs +2");
console.log("West: ty needs +2");
