/**
 * Debug P3 lifted graph to understand what absolute positions we're getting
 */

import {
  createOrbifoldGrid,
  type ColorData,
} from "./createOrbifolds.js";

import {
  type Matrix3x3,
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
} from "./orbifoldbasics.js";

function applyMatrix(matrix: Matrix3x3, x: number, y: number): { x: number; y: number } {
  const w = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  return {
    x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / w,
    y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / w,
  };
}

function formatVoltage(v: Matrix3x3): string {
  return `[[${v[0].join(",")}], [${v[1].join(",")}], [${v[2].join(",")}]]`;
}

const n = 3;
const grid = createOrbifoldGrid("P3", n);
buildAdjacency(grid);

const lifted = constructLiftedGraphFromOrbifold<ColorData>(grid);

// Do a few expansions
for (let i = 0; i < 2; i++) {
  processAllNonInteriorOnce(lifted);
}

console.log("=== P3 Lifted Graph Debug ===\n");
console.log(`Lifted nodes: ${lifted.nodes.size}`);

// Find all lifted nodes and their absolute positions
const positionMap = new Map<string, string[]>();

for (const [id, node] of lifted.nodes) {
  const orbNode = grid.nodes.get(node.orbifoldNode);
  if (!orbNode) continue;
  
  const [ox, oy] = orbNode.coord;
  const pos = applyMatrix(node.voltage, ox, oy);
  const posKey = `${pos.x.toFixed(1)},${pos.y.toFixed(1)}`;
  
  if (!positionMap.has(posKey)) {
    positionMap.set(posKey, []);
  }
  positionMap.get(posKey)!.push(`${node.orbifoldNode} with voltage ${formatVoltage(node.voltage)}`);
}

console.log("\n=== Positions with multiple nodes (collision detection) ===");
let collisions = 0;
for (const [pos, nodes] of positionMap) {
  if (nodes.length > 1) {
    collisions++;
    console.log(`Position ${pos}:`);
    for (const n of nodes) {
      console.log(`  - ${n}`);
    }
  }
}
console.log(`\nTotal collisions: ${collisions}`);

// Specifically look at what happens when we go north from (1,1)
console.log("\n=== Tracing north from (1,1) ===");

// Find the node at (1,1) with identity voltage
let node11Id: string | null = null;
for (const [id, node] of lifted.nodes) {
  if (node.orbifoldNode === "1,1") {
    const v = node.voltage;
    const isIdentity = v[0][0] === 1 && v[0][1] === 0 && v[0][2] === 0 &&
                      v[1][0] === 0 && v[1][1] === 1 && v[1][2] === 0;
    if (isIdentity) {
      node11Id = id;
      break;
    }
  }
}

if (node11Id) {
  console.log(`Found (1,1) with identity: ${node11Id}`);
  
  // Find all edges from this node
  for (const [edgeId, edge] of lifted.edges) {
    if (edge.a === node11Id || edge.b === node11Id) {
      const otherId = edge.a === node11Id ? edge.b : edge.a;
      const otherNode = lifted.nodes.get(otherId);
      if (!otherNode) continue;
      
      const orbNode = grid.nodes.get(otherNode.orbifoldNode);
      if (!orbNode) continue;
      
      const [ox, oy] = orbNode.coord;
      const pos = applyMatrix(otherNode.voltage, ox, oy);
      
      console.log(`  Edge to ${otherNode.orbifoldNode}:`);
      console.log(`    Voltage: ${formatVoltage(otherNode.voltage)}`);
      console.log(`    Orbifold coord: (${ox}, ${oy})`);
      console.log(`    Absolute position: (${pos.x}, ${pos.y})`);
    }
  }
}

// What SHOULD happen for P3:
// The user says north of (1,1) should be at position (3, -1)
// Target orbifold node is (5,5)
// So we need V such that V × (5,5) = (3,-1)

console.log("\n=== Computing correct voltage ===");
console.log("North of (1,1) → orbifold node (5,5), want absolute position (3,-1)");

// For 120° CCW rotation: (x, y) → (-y, x+y)
// Matrix: [[0, -1, tx], [1, 1, ty], [0, 0, 1]]
// Applied to (5,5): 
//   x' = 0*5 + -1*5 + tx = -5 + tx
//   y' = 1*5 + 1*5 + ty = 10 + ty
// Want x' = 3, y' = -1
// So: tx = 3 + 5 = 8, ty = -1 - 10 = -11

console.log("If using 120° CCW:");
console.log("  Matrix: [[0,-1,tx],[1,1,ty],[0,0,1]]");
console.log("  (5,5) → (-5+tx, 10+ty)");
console.log("  Want (3,-1)");
console.log("  So tx=8, ty=-11");

// Verify
const v_ccw: Matrix3x3 = [[0, -1, 8], [1, 1, -11], [0, 0, 1]];
const result = applyMatrix(v_ccw, 5, 5);
console.log(`  Verification: ${formatVoltage(v_ccw)} × (5,5) = (${result.x}, ${result.y})`);
