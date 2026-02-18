/**
 * Test that every self-edge in every orbifold has a voltage that is its own inverse.
 *
 * A self-edge (halfEdges.size === 1) must have an involutive voltage (A * A = I),
 * meaning the voltage is its own inverse. This ensures the orbifold structure is
 * well-defined and avoids confusing non-involutive self-edges.
 *
 * Run with: npx tsx src/orbifolds/self-edge-involution.test.ts
 */

import { createOrbifoldGrid, type WallpaperGroupType } from "./createOrbifolds.js";
import { buildAdjacency, isInvolutive, formatVoltage } from "./orbifoldbasics.js";

const groups: { type: WallpaperGroupType; sizes: number[] }[] = [
  { type: "P1", sizes: [2, 3, 4, 5] },
  { type: "P2", sizes: [2, 4, 6] },
  { type: "P3", sizes: [2, 3, 4, 5] },
  { type: "P4", sizes: [2, 3, 4, 5] },
  { type: "P4g", sizes: [4, 5, 6] },
  { type: "pgg", sizes: [2, 3, 4, 5] },
];

let passed = 0;
let failed = 0;

console.log("=== Self-Edge Involution Test ===\n");

for (const { type, sizes } of groups) {
  for (const n of sizes) {
    const label = `${type} n=${n}`;
    try {
      const grid = createOrbifoldGrid(type, n);
      buildAdjacency(grid);

      let selfEdgeCount = 0;
      for (const [edgeId, edge] of grid.edges) {
        if (edge.halfEdges.size === 1) {
          selfEdgeCount++;
          const [nodeId, halfEdge] = Array.from(edge.halfEdges.entries())[0];
          if (!isInvolutive(halfEdge.voltage)) {
            throw new Error(
              `Self-edge ${edgeId} on node ${nodeId} has non-involutive voltage ${formatVoltage(halfEdge.voltage)}`
            );
          }
        }
      }

      console.log(`  ✅ ${label}: all ${selfEdgeCount} self-edge(s) have involutive voltages`);
      passed++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ❌ ${label}: FAILED - ${msg}`);
      failed++;
    }
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}
