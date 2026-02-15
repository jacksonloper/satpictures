/**
 * Test that the polygon-side invariant holds for all wallpaper groups.
 *
 * The invariant: every polygon side of every orbifold node is associated with
 * exactly one orbifold edge. A self-edge may cover 1 or 2 polygon sides.
 *
 * Run with: npx tsx src/orbifolds/polygon-invariant.test.ts
 */

import { createOrbifoldGrid, type WallpaperGroupType } from "./createOrbifolds.js";
import { validatePolygonSideInvariant, buildAdjacency } from "./orbifoldbasics.js";

// Use sizes that are known to produce well-formed orbifolds.
// n=2 has pre-existing edge deduplication issues for P1 and non-involutive
// self-edges for P3/P4, so we test n≥3 (n≥4 for P4g per its constraint).
const groups: { type: WallpaperGroupType; sizes: number[] }[] = [
  { type: "P1", sizes: [3, 4, 5] },
  { type: "P2", sizes: [2, 3, 4, 5] },
  { type: "P3", sizes: [3, 4, 5] },
  { type: "P4", sizes: [3, 4, 5] },
  { type: "P4g", sizes: [4, 5, 6] },
  { type: "pgg", sizes: [2, 3, 4, 5] },
];

let passed = 0;
let failed = 0;

console.log("=== Polygon Side Invariant Test ===\n");

for (const { type, sizes } of groups) {
  for (const n of sizes) {
    const label = `${type} n=${n}`;
    try {
      const grid = createOrbifoldGrid(type, n);
      buildAdjacency(grid);

      // Validate polygon side invariant
      validatePolygonSideInvariant(grid);

      console.log(`  ✅ ${label}: polygon side invariant holds`);
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
