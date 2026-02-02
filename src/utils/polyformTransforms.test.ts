// Test edge state rotation matching cell rotation

import {
  rotatePolyhex,
  rotatePolyhexEdgeState,
  flipPolyhexEdgeStateH,
  transformPolyhex,
  rotatePolyomino,
  rotatePolyominoEdgeState,
} from "./polyformTransforms.js";

type EdgeState = boolean[][][];

console.log("=== Test: Edge State Rotation Matching ===\n");

// Test 1: Polyomino rotation
console.log("Test 1: Polyomino 90° rotation");
const sq_cells: boolean[][] = [
  [true, true],
  [true, false],
];
const sq_edges: EdgeState = [
  [[true, false, false, false], [false, true, false, false]],
  [[false, false, true, false], [false, false, false, false]],
];

const sq_rotatedCells = rotatePolyomino(sq_cells);
const sq_rotatedEdges = rotatePolyominoEdgeState(sq_edges);

console.log(`  Cells: ${sq_cells[0].length}x${sq_cells.length} -> ${sq_rotatedCells[0].length}x${sq_rotatedCells.length}`);
console.log(`  Edges: ${sq_edges[0].length}x${sq_edges.length} -> ${sq_rotatedEdges[0].length}x${sq_rotatedEdges.length}`);

if (sq_rotatedCells.length === sq_rotatedEdges.length && 
    sq_rotatedCells[0].length === sq_rotatedEdges[0].length) {
  console.log("  ✅ Dimensions match!");
} else {
  console.log("  ❌ Dimension mismatch!");
}

// Test 2: Hex rotation
console.log("\nTest 2: Hex 60° rotation");
const cells1: boolean[][] = [
  [true, true],
  [true, false],
];
const edgeState1: EdgeState = [
  [[true, true, false, false, false, false], [false, false, true, true, false, false]],
  [[false, false, false, false, true, true], [false, false, false, false, false, false]],
];

const rotatedCells1 = rotatePolyhex(cells1);
const rotatedEdges1 = rotatePolyhexEdgeState(edgeState1);

console.log(`  Cells: ${cells1[0].length}x${cells1.length} -> ${rotatedCells1[0].length}x${rotatedCells1.length}`);
console.log(`  Edges: ${edgeState1[0].length}x${edgeState1.length} -> ${rotatedEdges1[0].length}x${rotatedEdges1.length}`);

// Check dimensions match
if (rotatedCells1.length === rotatedEdges1.length && 
    rotatedCells1[0].length === rotatedEdges1[0].length) {
  console.log("  ✅ Dimensions match!");
} else {
  console.log("  ❌ Dimension mismatch!");
}

// Print the rotated shapes
console.log("  Rotated cells:");
for (let r = 0; r < rotatedCells1.length; r++) {
  console.log(`    Row ${r}: ${rotatedCells1[r].map(c => c ? 'X' : '.').join('')}`);
}

// Check that filled cells have valid edge arrays
let allValid = true;
for (let r = 0; r < rotatedCells1.length; r++) {
  for (let c = 0; c < rotatedCells1[r].length; c++) {
    if (rotatedCells1[r][c]) {
      const edges = rotatedEdges1[r]?.[c];
      if (!edges || edges.length !== 6) {
        console.log(`  ❌ Missing/invalid edges at [${r}][${c}]`);
        allValid = false;
      }
    }
  }
}
if (allValid) {
  console.log("  ✅ All filled cells have valid edge arrays");
}

// Test 3: Multiple rotations
console.log("\nTest 3: Multiple hex rotations (should not grow exponentially)");
let cells = [[true, true]];
let edges: EdgeState = [[[true, false, false, false, false, false], [false, true, false, false, false, false]]];

for (let i = 0; i < 6; i++) {
  console.log(`  After ${i} rotations: cells ${cells[0].length}x${cells.length}, edges ${edges[0].length}x${edges.length}`);
  cells = rotatePolyhex(cells);
  edges = rotatePolyhexEdgeState(edges);
}
console.log(`  After 6 rotations: cells ${cells[0].length}x${cells.length}, edges ${edges[0].length}x${edges.length}`);

// After 6 rotations of 60° each, should be back to similar size
if (cells.length <= 3 && cells[0].length <= 3 && edges.length <= 3 && edges[0].length <= 3) {
  console.log("  ✅ Grid size stayed bounded after 6 rotations");
} else {
  console.log("  ❌ Grid size grew unexpectedly!");
}

// Test 4: Flip H
console.log("\nTest 4: Hex horizontal flip");
const cells3: boolean[][] = [[true, true]];
const edgeState3: EdgeState = [[[true, true, false, false, false, false], [false, false, true, true, false, false]]];

const flippedCells3 = transformPolyhex(cells3, "flipH");
const flippedEdges3 = flipPolyhexEdgeStateH(edgeState3);

console.log(`  Cells: ${cells3[0].length}x${cells3.length} -> ${flippedCells3[0].length}x${flippedCells3.length}`);
console.log(`  Edges: ${edgeState3[0].length}x${edgeState3.length} -> ${flippedEdges3[0].length}x${flippedEdges3.length}`);

if (flippedCells3.length === flippedEdges3.length && 
    flippedCells3[0].length === flippedEdges3[0].length) {
  console.log("  ✅ Dimensions match!");
} else {
  console.log("  ❌ Dimension mismatch!");
}

console.log("\n=== Summary ===");
console.log("All rotation/flip tests completed!");
