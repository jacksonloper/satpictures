/**
 * Benchmark: how many transitions can run in 0.5 seconds?
 *
 * Measures both the total number of *attempts* and the number of *accepted*
 * transitions (those that don't disconnect the solid-edge graph).
 *
 * Run with: npx tsx src/orbifolds/transition-throughput.test.ts
 * Also runs as part of: npm test
 */

import { createOrbifoldGrid, type WallpaperGroupType } from "./createOrbifolds.js";
import { buildAdjacency, I3, type Matrix3x3, type OrbifoldNodeId } from "./orbifoldbasics.js";
import {
  computeSolidEdges,
  doStepPure,
} from "./components/orbifoldExamplesHelpers.js";

const BENCHMARK_DURATION_MS = 500;
const FIXED_N = 40;

const groups: WallpaperGroupType[] = ["P1", "P2", "P3", "P4", "P4g", "P6", "pgg"];

let passed = 0;
let failed = 0;

console.log("=== Transition Throughput Benchmark ===\n");
console.log(`Grid size: n=${FIXED_N}, duration: ${BENCHMARK_DURATION_MS}ms per group\n`);

for (const groupType of groups) {
  const label = `${groupType} n=${FIXED_N}`;
  try {
    const grid = createOrbifoldGrid(groupType, FIXED_N);
    buildAdjacency(grid);

    const nodeIds = Array.from(grid.nodes.keys());
    const edgeIds = Array.from(grid.edges.keys());

    // Initialize all node voltages to identity
    const nodeVoltages = new Map<OrbifoldNodeId, Matrix3x3>();
    for (const nid of grid.nodes.keys()) nodeVoltages.set(nid, I3);
    const solidEdges = computeSolidEdges(grid, nodeVoltages);

    let attempts = 0;
    let accepted = 0;

    const start = performance.now();
    while (performance.now() - start < BENCHMARK_DURATION_MS) {
      const result = doStepPure(nodeVoltages, solidEdges, grid, nodeIds, edgeIds);
      if (result.attempted) attempts++;
      if (result.accepted) accepted++;
    }
    const elapsed = performance.now() - start;

    const attemptsPerSec = Math.round(attempts / (elapsed / 1000));
    const acceptedPerSec = Math.round(accepted / (elapsed / 1000));

    console.log(
      `  ✅ ${label}: ${attempts} attempts (${attemptsPerSec}/s), ` +
      `${accepted} accepted (${acceptedPerSec}/s) in ${elapsed.toFixed(0)}ms`
    );

    // Sanity check: we should manage at least some attempts
    if (attempts < 10) {
      throw new Error(`Too few attempts (${attempts}) — something is broken`);
    }

    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ❌ ${label}: FAILED - ${msg}`);
    failed++;
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}
