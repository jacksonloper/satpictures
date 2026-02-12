/**
 * Tests for ManifoldOrbifold data structures
 * 
 * Run with: npx tsx src/wallpaper-maze/ManifoldOrbifold.test.ts
 */

import {
  buildP1Manifold,
  buildP1Orbifold,
  buildP2Manifold,
  buildP2Orbifold,
  expandCopies,
  applyMatrix3x3,
  matmul3x3,
  inverse3x3,
  IDENTITY_3X3,
  type Matrix3x3,
} from "./ManifoldOrbifold.js";

// Test utilities
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================================
// P1 Tests
// ============================================================================

console.log("=== P1 Manifold Tests ===\n");

// Test P1 node count
{
  for (const n of [2, 3, 4, 5]) {
    const manifold = buildP1Manifold(n);
    assert(manifold.nodes.length === n * n, `P1 n=${n}: expected ${n*n} nodes, got ${manifold.nodes.length}`);
    console.log(`✓ P1 n=${n}: ${manifold.nodes.length} nodes`);
  }
}

// Test P1 lifted graph - all neighbors 1 unit away (for n >= 3 to avoid degeneracy)
{
  for (const n of [3, 4, 5]) {
    const orbifold = buildP1Orbifold(n);
    
    let allCorrect = true;
    let errorCount = 0;
    
    for (const node of orbifold.nodes) {
      const basePos = applyMatrix3x3(IDENTITY_3X3, node.col + 0.5, node.row + 0.5);
      const outgoingEdges = orbifold.edges.filter(e => e.from === node.index);
      
      for (const edge of outgoingEdges) {
        const targetNode = orbifold.nodes[edge.to];
        const targetCopyMatrix = matmul3x3(IDENTITY_3X3, edge.voltage);
        const targetPos = applyMatrix3x3(targetCopyMatrix, targetNode.col + 0.5, targetNode.row + 0.5);
        
        const dist = Math.sqrt(
          Math.pow(targetPos.x - basePos.x, 2) + 
          Math.pow(targetPos.y - basePos.y, 2)
        );
        
        if (Math.abs(dist - 1) > 0.001) {
          allCorrect = false;
          errorCount++;
          if (errorCount <= 3) {
            console.log(`  ❌ P1 n=${n}: (${node.row},${node.col}) -> (${targetNode.row},${targetNode.col}): dist=${dist.toFixed(3)}`);
          }
        }
      }
    }
    assert(allCorrect, `P1 n=${n}: all neighbors should be 1 unit away (${errorCount} errors)`);
    console.log(`✓ P1 n=${n}: all lifted graph neighbors are 1 unit away`);
  }
}

// ============================================================================
// P2 Tests
// ============================================================================

console.log("\n=== P2 Manifold Tests ===\n");

// Test P2 node count
{
  for (const n of [2, 3, 4, 5]) {
    const manifold = buildP2Manifold(n);
    assert(manifold.nodes.length === n * n, `P2 n=${n}: expected ${n*n} nodes, got ${manifold.nodes.length}`);
    console.log(`✓ P2 n=${n}: ${manifold.nodes.length} nodes`);
  }
}

// Test P2 all nodes have 4 edges (counting multi-edges and self-loops) - for n >= 3
{
  for (const n of [3, 4, 5]) {
    const manifold = buildP2Manifold(n);
    let allHave4 = true;
    for (const node of manifold.nodes) {
      const edgeCount = manifold.edges.filter(e => e.from === node.index || e.to === node.index).length;
      if (edgeCount !== 4) {
        allHave4 = false;
        console.log(`  ❌ P2 n=${n}: node (${node.row},${node.col}) has ${edgeCount} edges`);
      }
    }
    assert(allHave4, `P2 n=${n}: all nodes should have 4 edges`);
    console.log(`✓ P2 n=${n}: all nodes have 4 edges`);
  }
}

// Test P2 orbifold symmetry - all nodes should have 4 outgoing edges
{
  for (const n of [2, 3, 4, 5]) {
    const orbifold = buildP2Orbifold(n);
    const outgoingCounts = new Set<number>();
    
    for (const node of orbifold.nodes) {
      const outgoing = orbifold.edges.filter(e => e.from === node.index).length;
      outgoingCounts.add(outgoing);
    }
    
    assert(outgoingCounts.size === 1 && outgoingCounts.has(4), 
      `P2 n=${n}: all nodes should have 4 outgoing edges`);
    console.log(`✓ P2 n=${n}: all nodes have 4 outgoing orbifold edges`);
  }
}

// Test P2 lifted graph - all neighbors 1 unit away (the key test!)
{
  for (const n of [2, 3, 4, 5]) {
    const orbifold = buildP2Orbifold(n);
    
    let allCorrect = true;
    let errorCount = 0;
    
    for (const node of orbifold.nodes) {
      const basePos = applyMatrix3x3(IDENTITY_3X3, node.col + 0.5, node.row + 0.5);
      const outgoingEdges = orbifold.edges.filter(e => e.from === node.index);
      
      for (const edge of outgoingEdges) {
        const targetNode = orbifold.nodes[edge.to];
        const targetCopyMatrix = matmul3x3(IDENTITY_3X3, edge.voltage);
        const targetPos = applyMatrix3x3(targetCopyMatrix, targetNode.col + 0.5, targetNode.row + 0.5);
        
        const dist = Math.sqrt(
          Math.pow(targetPos.x - basePos.x, 2) + 
          Math.pow(targetPos.y - basePos.y, 2)
        );
        
        if (Math.abs(dist - 1) > 0.001) {
          allCorrect = false;
          errorCount++;
          if (errorCount <= 3) {
            console.log(`  ❌ P2 n=${n}: (${node.row},${node.col}) -> (${targetNode.row},${targetNode.col}): dist=${dist.toFixed(3)}`);
          }
        }
      }
    }
    
    assert(allCorrect, `P2 n=${n}: all neighbors should be 1 unit away (${errorCount} errors)`);
    console.log(`✓ P2 n=${n}: all lifted graph neighbors are 1 unit away`);
  }
}

// Test P2 lifted graph has no duplicate coordinates
// This verifies that the voltages are correct and create a proper infinite grid
{
  for (const n of [3, 4, 5]) {
    const multiplier = 2;
    const orbifold = buildP2Orbifold(n);
    const copies = expandCopies(orbifold, multiplier);
    
    // Collect all lifted node positions
    const positions = new Map<string, string>();  // "x,y" -> "node description"
    let duplicates = 0;
    
    for (const copy of copies) {
      for (const node of orbifold.nodes) {
        // Apply copy transformation to get lifted position
        const pos = applyMatrix3x3(copy.matrix, node.col + 0.5, node.row + 0.5);
        // Round to avoid floating point issues
        const key = `${Math.round(pos.x * 1000) / 1000},${Math.round(pos.y * 1000) / 1000}`;
        const desc = `(${node.row},${node.col}) in copy [${copy.matrix[2]},${copy.matrix[5]}]`;
        
        if (positions.has(key)) {
          if (duplicates < 3) {
            console.log(`  ❌ Duplicate position ${key}: ${desc} and ${positions.get(key)}`);
          }
          duplicates++;
        } else {
          positions.set(key, desc);
        }
      }
    }
    
    assert(duplicates === 0, `P2 n=${n}: lifted graph should have no duplicate coordinates (found ${duplicates})`);
    console.log(`✓ P2 n=${n}, multiplier=${multiplier}: no duplicate coordinates in lifted graph (${positions.size} unique positions)`);
  }
}

// Test P2 voltage determinants are all 1 (proper rotations, not reflections)
{
  for (const n of [3, 4, 5]) {
    const orbifold = buildP2Orbifold(n);
    
    let allDet1 = true;
    for (const edge of orbifold.edges) {
      const v = edge.voltage;
      // For 3x3 homogeneous matrix, the relevant 2x2 determinant is v[0]*v[4] - v[1]*v[3]
      const det = v[0] * v[4] - v[1] * v[3];
      if (det !== 1) {
        allDet1 = false;
        const from = orbifold.nodes[edge.from];
        const to = orbifold.nodes[edge.to];
        console.log(`  ❌ Non-unit determinant: (${from.row},${from.col}) -> (${to.row},${to.col}) has det=${det}`);
      }
    }
    
    assert(allDet1, `P2 n=${n}: all voltages should have determinant 1 (proper rotations)`);
    console.log(`✓ P2 n=${n}: all voltages have determinant 1 (proper rotations, not reflections)`);
  }
}

// Test P2 voltage matrices are in the group generated by the boundary voltages
// P2 uses 180° rotations at boundaries (not reflections - det = 1)
{
  const n = 3;
  const orbifold = buildP2Orbifold(n);
  
  // Collect all non-identity voltages as potential generators
  const voltageSet = new Set<string>();
  for (const edge of orbifold.edges) {
    const key = edge.voltage.join(",");
    if (key !== IDENTITY_3X3.join(",")) {
      voltageSet.add(key);
    }
  }
  
  // Use these voltages as generators
  const generators: Matrix3x3[] = [];
  for (const key of voltageSet) {
    const parts = key.split(",").map(Number);
    generators.push(parts as Matrix3x3);
    generators.push(inverse3x3(parts as Matrix3x3));
  }
  generators.push(IDENTITY_3X3);
  
  // Generate group elements via BFS
  const groupElements = new Set<string>();
  const queue: Matrix3x3[] = [IDENTITY_3X3];
  groupElements.add(IDENTITY_3X3.join(","));
  
  for (let depth = 0; depth < 5; depth++) {
    const nextQueue: Matrix3x3[] = [];
    for (const elem of queue) {
      for (const gen of generators) {
        const product = matmul3x3(elem, gen);
        const key = product.join(",");
        if (!groupElements.has(key)) {
          groupElements.add(key);
          nextQueue.push(product);
        }
      }
    }
    queue.length = 0;
    queue.push(...nextQueue);
  }
  
  // Check all edge voltages are in the group
  let allInGroup = true;
  for (const edge of orbifold.edges) {
    const key = edge.voltage.join(",");
    if (!groupElements.has(key)) {
      allInGroup = false;
      const from = orbifold.nodes[edge.from];
      const to = orbifold.nodes[edge.to];
      console.log(`  ❌ Voltage not in group: (${from.row},${from.col}) -> (${to.row},${to.col}): [${edge.voltage.join(",")}]`);
    }
  }
  
  assert(allInGroup, "P2: all edge voltages should be in the generated group");
  console.log(`✓ P2 n=${n}: all edge voltages are in the generated group (${groupElements.size} elements)`);
}

// Test P2 copy matrices are in the group
{
  const n = 3;
  const multiplier = 2;
  const orbifold = buildP2Orbifold(n);
  const copies = expandCopies(orbifold, multiplier);
  
  // Collect all non-identity voltages as potential generators
  const voltageSet = new Set<string>();
  for (const edge of orbifold.edges) {
    const key = edge.voltage.join(",");
    if (key !== IDENTITY_3X3.join(",")) {
      voltageSet.add(key);
    }
  }
  
  // Use these voltages as generators
  const generators: Matrix3x3[] = [];
  for (const key of voltageSet) {
    const parts = key.split(",").map(Number);
    generators.push(parts as Matrix3x3);
    generators.push(inverse3x3(parts as Matrix3x3));
  }
  generators.push(IDENTITY_3X3);
  
  // Generate group elements via BFS
  const groupElements = new Set<string>();
  const queue: Matrix3x3[] = [IDENTITY_3X3];
  groupElements.add(IDENTITY_3X3.join(","));
  
  for (let depth = 0; depth < 5; depth++) {
    const nextQueue: Matrix3x3[] = [];
    for (const elem of queue) {
      for (const gen of generators) {
        const product = matmul3x3(elem, gen);
        const key = product.join(",");
        if (!groupElements.has(key)) {
          groupElements.add(key);
          nextQueue.push(product);
        }
      }
    }
    queue.length = 0;
    queue.push(...nextQueue);
  }
  
  let allInGroup = true;
  for (const copy of copies) {
    const key = copy.matrix.join(",");
    if (!groupElements.has(key)) {
      allInGroup = false;
      console.log(`  ❌ Copy matrix not in group: [${copy.matrix.join(",")}]`);
    }
  }
  
  assert(allInGroup, "P2: all copy matrices should be in the generated group");
  console.log(`✓ P2 n=${n}, multiplier=${multiplier}: all ${copies.length} copy matrices are in the generated group`);
}

console.log("\n=== All tests passed! ===");
