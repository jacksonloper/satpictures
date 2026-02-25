/**
 * Test runner for the loop finder SAT encoding tests.
 *
 * This file imports and runs all loop finder test suites:
 * - Basic loop tests (loop-finder-basic.test.ts)
 * - Voltage tracking tests (loop-finder-voltage.test.ts)
 * - Min length tests (loop-finder-minlength.test.ts)
 *
 * Run with: npx tsx src/orbifolds/loop-finder.test.ts
 */

import "./loop-finder-basic.test.js";
import "./loop-finder-voltage.test.js";
import "./loop-finder-minlength.test.js";
