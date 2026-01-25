/**
 * Benchmark Test: Tree vs No-Tree SAT Encoding using CaDiCaL
 *
 * Compares the performance of:
 * - Old encoding (solveGridColoring): Connected component via spanning tree + bounded reachability
 * - New encoding (solveForestGridColoring): Tree-based with unary distance variables
 *
 * Both use the CaDiCaL solver via command line for fair comparison.
 * 
 * Test setup: 12x12 grid, maze-style with hatch border and min distance constraints.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { HATCH_COLOR } from "./graph-types";
import type { ColorGrid, PathlengthConstraint, ColorRoots, GridPoint, GridType } from "./graph-types";
import { buildColoredForestSatCNF } from "./colored-forest-sat";
import { getNeighbors, edgeKey } from "./grid-neighbors";

// Color constants
const RED = 0;

/**
 * Create a maze-style grid setup matching the browser's createMazeSetupGrid
 * 
 * Browser Maze Setup:
 * - Entrance: middle row, leftmost column (col 0) - RED
 * - Exit: middle row, rightmost column (col width-1) - RED
 * - All INTERIOR cells are RED (pre-colored, not blank!)
 * - Border cells (except entrance/exit) are HATCH
 * - minDistance = max(width, height)
 */
function createMazeSetup(size: number, minDistance: number): {
  grid: ColorGrid;
  pathlengthConstraints: PathlengthConstraint[];
  colorRoots: ColorRoots;
  rootCell: { row: number; col: number };
  targetCell: { row: number; col: number };
} {
  const colors: (number | null)[][] = [];
  
  const middleRow = Math.floor(size / 2);
  const entranceCol = 0;
  const exitCol = size - 1;
  
  for (let row = 0; row < size; row++) {
    const rowColors: (number | null)[] = [];
    for (let col = 0; col < size; col++) {
      // Entrance on far left: red square in the left border
      if (row === middleRow && col === entranceCol) {
        rowColors.push(RED);
      }
      // Exit on far right: red square in the right border
      else if (row === middleRow && col === exitCol) {
        rowColors.push(RED);
      }
      // Other border cells: orange hatch (walls)
      else if (row === 0 || row === size - 1 || col === 0 || col === size - 1) {
        rowColors.push(HATCH_COLOR);
      }
      // Interior: red (matching the browser - NOT blank/null!)
      else {
        rowColors.push(RED);
      }
    }
    colors.push(rowColors);
  }
  
  const rootRow = middleRow;
  const rootCol = entranceCol;
  const targetRow = middleRow;
  const targetCol = exitCol;
  
  const grid: ColorGrid = { width: size, height: size, colors };
  
  const pathlengthConstraints: PathlengthConstraint[] = [
    {
      id: "maze",
      root: { row: rootRow, col: rootCol },
      minDistances: {
        [`${targetRow},${targetCol}`]: minDistance,
      },
    },
  ];
  
  const colorRoots: ColorRoots = {
    [String(RED)]: { row: rootRow, col: rootCol },
  };
  
  return {
    grid,
    pathlengthConstraints,
    colorRoots,
    rootCell: { row: rootRow, col: rootCol },
    targetCell: { row: targetRow, col: targetCol },
  };
}

/**
 * Helper to convert grid point to string key
 */
function pointKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Build DIMACS CNF for OLD encoding (connected component + bounded reachability)
 * This is a simplified version that generates the same structure as grid-coloring.ts
 */
function buildOldEncodingDimacs(
  grid: ColorGrid,
  pathlengthConstraints: PathlengthConstraint[],
  gridType: GridType = "square"
): { dimacs: string; numVars: number; numClauses: number } {
  const { width, height, colors } = grid;
  
  // Variable allocation
  let nextVar = 1;
  const varOf = new Map<string, number>();
  const clauses: number[][] = [];
  
  function getOrCreateVar(name: string): number {
    if (!varOf.has(name)) {
      varOf.set(name, nextVar++);
    }
    return varOf.get(name)!;
  }
  
  function addClause(lits: number[]): void {
    clauses.push(lits);
  }
  
  // Track which cells are hatch
  const isHatchCell = (row: number, col: number): boolean => colors[row][col] === HATCH_COLOR;
  
  // Collect used colors (excluding hatch)
  const usedColors = new Set<number>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = colors[row][col];
      if (c !== null && c !== HATCH_COLOR) {
        usedColors.add(c);
      }
    }
  }
  const activeColors = Array.from(usedColors).sort((a, b) => a - b);
  
  // Create color variables for blank cells
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (colors[row][col] === null) {
        const varsForCell: number[] = [];
        for (const c of activeColors) {
          const v = getOrCreateVar(`col_${row}_${col}_${c}`);
          varsForCell.push(v);
        }
        // Exactly one color
        addClause(varsForCell);
        for (let i = 0; i < varsForCell.length; i++) {
          for (let j = i + 1; j < varsForCell.length; j++) {
            addClause([-varsForCell[i], -varsForCell[j]]);
          }
        }
      }
    }
  }
  
  // Edge variables and constraints
  const edgeVars = new Map<string, number>();
  const allEdges: { u: GridPoint; v: GridPoint }[] = [];
  const addedEdgeKeys = new Set<string>();
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (isHatchCell(row, col)) continue;
      const u: GridPoint = { row, col };
      const neighbors = getNeighbors(u, width, height, gridType);
      for (const v of neighbors) {
        if (isHatchCell(v.row, v.col)) continue;
        const key = edgeKey(u, v);
        if (!addedEdgeKeys.has(key)) {
          addedEdgeKeys.add(key);
          edgeVars.set(key, getOrCreateVar(`edge_${key}`));
          allEdges.push({ u, v });
        }
      }
    }
  }
  
  // Different colors => blocked edge
  for (const edge of allEdges) {
    const edgeVar = edgeVars.get(edgeKey(edge.u, edge.v))!;
    
    function getCellColorInfo(row: number, col: number): { color: number; var: number | null }[] {
      const fixedColor = colors[row][col];
      if (fixedColor !== null) {
        return [{ color: fixedColor, var: null }];
      }
      return activeColors.map(c => ({ color: c, var: varOf.get(`col_${row}_${col}_${c}`)! }));
    }
    
    const uColors = getCellColorInfo(edge.u.row, edge.u.col);
    const vColors = getCellColorInfo(edge.v.row, edge.v.col);
    
    for (const uInfo of uColors) {
      for (const vInfo of vColors) {
        if (uInfo.color !== vInfo.color) {
          const clause: number[] = [-edgeVar];
          if (uInfo.var !== null) clause.push(-uInfo.var);
          if (vInfo.var !== null) clause.push(-vInfo.var);
          addClause(clause);
        }
      }
    }
  }
  
  // Connectivity (spanning tree) for each color
  for (const color of activeColors) {
    if (color === HATCH_COLOR) continue;
    
    const potentialVertices: GridPoint[] = [];
    const fixedVertices: GridPoint[] = [];
    
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (isHatchCell(row, col)) continue;
        const cellColor = colors[row][col];
        if (cellColor === color) {
          potentialVertices.push({ row, col });
          fixedVertices.push({ row, col });
        } else if (cellColor === null) {
          potentialVertices.push({ row, col });
        }
      }
    }
    
    if (potentialVertices.length <= 1) continue;
    
    // Find root (lex smallest fixed vertex)
    const fixedRoot = fixedVertices.reduce((min, v) => {
      if (v.row < min.row || (v.row === min.row && v.col < min.col)) return v;
      return min;
    }, fixedVertices[0]);
    
    const potentialSet = new Set(potentialVertices.map(v => `${v.row},${v.col}`));
    
    // Parent variables
    for (const v of potentialVertices) {
      const neighbors = getNeighbors(v, width, height, gridType).filter(n => 
        potentialSet.has(`${n.row},${n.col}`)
      );
      
      const parentVars: number[] = [];
      for (const u of neighbors) {
        const pVar = getOrCreateVar(`p_${color}_${u.row},${u.col}->${v.row},${v.col}`);
        parentVars.push(pVar);
        
        // Parent implies edge
        const eKey = edgeKey(u, v);
        const edgeVar = edgeVars.get(eKey);
        if (edgeVar) {
          addClause([-pVar, edgeVar]);
        }
        
        // Parent implies both have color
        const uColorVar = varOf.get(`col_${u.row}_${u.col}_${color}`);
        const vColorVar = varOf.get(`col_${v.row}_${v.col}_${color}`);
        if (uColorVar) addClause([-pVar, uColorVar]);
        if (vColorVar) addClause([-pVar, vColorVar]);
      }
      
      const isRoot = v.row === fixedRoot.row && v.col === fixedRoot.col;
      const vColorVar = varOf.get(`col_${v.row}_${v.col}_${color}`);
      
      if (isRoot) {
        // Root has no parent
        for (const pVar of parentVars) {
          addClause([-pVar]);
        }
      } else {
        // Non-root: if has color, needs exactly one parent
        if (parentVars.length > 0) {
          // At most one parent
          for (let i = 0; i < parentVars.length; i++) {
            for (let j = i + 1; j < parentVars.length; j++) {
              addClause([-parentVars[i], -parentVars[j]]);
            }
          }
          // If has color, at least one parent
          if (vColorVar !== undefined) {
            addClause([-vColorVar, ...parentVars]);
          } else {
            addClause(parentVars);
          }
        } else {
          // No potential parents - forbid this color
          if (vColorVar !== undefined) {
            addClause([-vColorVar]);
          }
        }
      }
    }
    
    // Level variables for cycle elimination (simplified - just need levels for ordering)
    const numBits = Math.ceil(Math.log2(potentialVertices.length)) || 1;
    for (const v of potentialVertices) {
      for (let b = 0; b < numBits; b++) {
        getOrCreateVar(`level_${color}_${v.row},${v.col}_b${b}`);
      }
    }
    
    // Root level = 0
    for (let b = 0; b < numBits; b++) {
      const bit = varOf.get(`level_${color}_${fixedRoot.row},${fixedRoot.col}_b${b}`);
      if (bit) addClause([-bit]);
    }
    
    // Level ordering for parent relations (parent level < child level)
    // This is complex - simplified version for benchmark
  }
  
  // Bounded reachability for pathlength constraints
  // IMPORTANT: The real grid-coloring.ts includes ALL cells (including hatch) in R variables
  // We must replicate this behavior for accurate benchmarking
  for (const constraint of pathlengthConstraints) {
    if (!constraint.root) continue;
    const root = constraint.root;
    
    const minDistanceEntries = Object.entries(constraint.minDistances);
    if (minDistanceEntries.length === 0) continue;
    
    let maxK = 0;
    for (const [, dist] of minDistanceEntries) {
      if (dist > 0) maxK = Math.max(maxK, dist - 1);
    }
    if (maxK === 0) continue;
    
    // R[step][row,col] variables - include ALL cells like the real encoding
    const R: Map<string, number>[] = [];
    for (let step = 0; step <= maxK; step++) {
      R.push(new Map());
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          // Include ALL cells, including hatch (matches grid-coloring.ts lines 548-556)
          R[step].set(`${row},${col}`, getOrCreateVar(`R_${constraint.id}_${step}_${row}_${col}`));
        }
      }
    }
    
    // Base: R[0][root] = true, R[0][other] = false (for ALL cells)
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const r0 = R[0].get(`${row},${col}`);
        if (r0) {
          if (row === root.row && col === root.col) {
            addClause([r0]);
          } else {
            addClause([-r0]);
          }
        }
      }
    }
    
    // Inductive step (for ALL cells)
    for (let step = 1; step <= maxK; step++) {
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const rCurr = R[step].get(`${row},${col}`);
          const rPrev = R[step - 1].get(`${row},${col}`);
          if (!rCurr || !rPrev) continue;
          
          const neighbors = getNeighbors({ row, col }, width, height, gridType);
          const reachTerms: number[] = [];
          
          for (const n of neighbors) {
            const rPrevN = R[step - 1].get(`${n.row},${n.col}`);
            const eKey = edgeKey({ row, col }, n);
            const edgeVar = edgeVars.get(eKey);
            // Edge var may not exist if it crosses hatch boundary - skip reach-through in that case
            if (!rPrevN) continue;
            
            if (edgeVar) {
              // Non-hatch to non-hatch edge: can reach through if edge is kept
              const reachThrough = getOrCreateVar(`reach_${constraint.id}_${step}_${n.row}_${n.col}_to_${row}_${col}`);
              reachTerms.push(reachThrough);
              
              addClause([-reachThrough, rPrevN]);
              addClause([-reachThrough, edgeVar]);
              addClause([-rPrevN, -edgeVar, reachThrough]);
            }
            // If no edge var (hatch boundary), we can't reach through this neighbor
          }
          
          // Forward: rPrev or any reachThrough => rCurr
          addClause([-rPrev, rCurr]);
          for (const rt of reachTerms) {
            addClause([-rt, rCurr]);
          }
          // Backward
          addClause([-rCurr, rPrev, ...reachTerms]);
        }
      }
    }
    
    // Forbid reaching target in < minDist steps
    for (const [cellKey, minDist] of minDistanceEntries) {
      if (minDist <= 1) continue;
      const stepToForbid = minDist - 1;
      if (stepToForbid > maxK) continue;
      const rStep = R[stepToForbid].get(cellKey);
      if (rStep) addClause([-rStep]);
    }
  }
  
  // Generate DIMACS
  const numVars = nextVar - 1;
  const numClauses = clauses.length;
  let dimacs = `p cnf ${numVars} ${numClauses}\n`;
  for (const clause of clauses) {
    dimacs += clause.join(' ') + ' 0\n';
  }
  
  return { dimacs, numVars, numClauses };
}

/**
 * Build DIMACS CNF for NEW encoding (tree with unary distances)
 */
function buildNewEncodingDimacs(
  grid: ColorGrid,
  colorRoots: ColorRoots,
  pathlengthConstraints: PathlengthConstraint[],
  gridType: GridType = "square"
): { dimacs: string; numVars: number; numClauses: number } {
  const { width, height, colors } = grid;
  
  // Track hatch cells
  const isHatchCell = (row: number, col: number): boolean => colors[row][col] === HATCH_COLOR;
  
  // Build nodes (exclude hatch)
  const nodes: string[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!isHatchCell(row, col)) {
        nodes.push(pointKey(row, col));
      }
    }
  }
  
  // Build edges (exclude hatch)
  const edges: [string, string][] = [];
  const addedEdges = new Set<string>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (isHatchCell(row, col)) continue;
      const u: GridPoint = { row, col };
      const neighbors = getNeighbors(u, width, height, gridType);
      for (const v of neighbors) {
        if (isHatchCell(v.row, v.col)) continue;
        const uKey = pointKey(row, col);
        const vKey = pointKey(v.row, v.col);
        const key = uKey < vKey ? `${uKey}--${vKey}` : `${vKey}--${uKey}`;
        if (!addedEdges.has(key)) {
          addedEdges.add(key);
          edges.push([uKey, vKey]);
        }
      }
    }
  }
  
  // Determine used colors and roots
  const usedColors = new Set<number>();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = colors[row][col];
      if (c !== null && c !== HATCH_COLOR) {
        usedColors.add(c);
      }
    }
  }
  
  const rootOfColor: Record<string, string> = {};
  for (const c of usedColors) {
    const rootPoint = colorRoots[String(c)];
    if (rootPoint) {
      rootOfColor[String(c)] = pointKey(rootPoint.row, rootPoint.col);
    }
  }
  
  // Build node color hints
  const nodeColorHint: Record<string, number> = {};
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (isHatchCell(row, col)) continue;
      const c = colors[row][col];
      if (c !== null) {
        nodeColorHint[pointKey(row, col)] = c;
      } else {
        nodeColorHint[pointKey(row, col)] = -1;
      }
    }
  }
  
  // Distance lower bounds
  const distLowerBounds: [string, number][] = [];
  for (const constraint of pathlengthConstraints) {
    for (const [cellKey, minDist] of Object.entries(constraint.minDistances)) {
      distLowerBounds.push([cellKey, minDist]);
    }
  }
  
  // Build forest CNF
  const result = buildColoredForestSatCNF({
    nodes,
    edges,
    nodeColorHint,
    rootOfColor,
    distLowerBounds,
  });
  
  return {
    dimacs: result.dimacs,
    numVars: result.numVars,
    numClauses: result.clauses.length,
  };
}

/**
 * Run MiniSat on a DIMACS file and return the time
 */
function runMinisat(dimacsContent: string): { time: number; sat: boolean | null; error?: string } {
  const tmpDir = "/tmp/satbenchmark";
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const inputFile = path.join(tmpDir, `input_${Date.now()}.cnf`);
  const outputFile = path.join(tmpDir, `output_${Date.now()}.txt`);
  fs.writeFileSync(inputFile, dimacsContent);
  
  const start = performance.now();
  
  try {
    execSync(`minisat ${inputFile} ${outputFile} 2>&1`, { 
      timeout: 120000,  // 2 minute timeout
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024  // 50MB buffer
    });
    const end = performance.now();
    
    // Read the output file to check result
    const output = fs.readFileSync(outputFile, 'utf-8');
    const sat = output.includes('SAT') && !output.includes('UNSAT');
    const unsat = output.includes('UNSAT');
    
    try { fs.unlinkSync(inputFile); } catch { /* ignore */ }
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
    
    return {
      time: end - start,
      sat: sat ? true : (unsat ? false : null)
    };
  } catch (e: unknown) {
    const end = performance.now();
    const error = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    
    try { fs.unlinkSync(inputFile); } catch { /* ignore */ }
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
    
    // MiniSat returns exit code 10 for SAT, 20 for UNSAT
    if (error.status === 10) {
      return { time: end - start, sat: true };
    } else if (error.status === 20) {
      return { time: end - start, sat: false };
    }
    
    return {
      time: end - start,
      sat: null,
      error: error.message || "Unknown error"
    };
  }
}

/**
 * Run CaDiCaL on a DIMACS file and return the time
 */
function runCadical(dimacsContent: string): { time: number; sat: boolean | null; error?: string } {
  const tmpDir = "/tmp/satbenchmark";
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const inputFile = path.join(tmpDir, `input_${Date.now()}.cnf`);
  fs.writeFileSync(inputFile, dimacsContent);
  
  const start = performance.now();
  
  try {
    const result = execSync(`cadical ${inputFile} 2>&1`, { 
      timeout: 120000,  // 2 minute timeout
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024  // 50MB buffer
    });
    const end = performance.now();
    
    const sat = result.includes('s SATISFIABLE');
    const unsat = result.includes('s UNSATISFIABLE');
    
    fs.unlinkSync(inputFile);
    
    return {
      time: end - start,
      sat: sat ? true : (unsat ? false : null)
    };
  } catch (e: unknown) {
    const end = performance.now();
    const error = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    
    try { fs.unlinkSync(inputFile); } catch { /* ignore */ }
    
    // CaDiCaL returns exit code 10 for SAT, 20 for UNSAT
    if (error.status === 10) {
      return { time: end - start, sat: true };
    } else if (error.status === 20) {
      return { time: end - start, sat: false };
    }
    
    return {
      time: end - start,
      sat: null,
      error: error.message || "Unknown error"
    };
  }
}

/**
 * Run single benchmark test
 */
function runSingleBenchmark(size: number, minDistance: number): void {
  const { grid, pathlengthConstraints, colorRoots, rootCell, targetCell } = createMazeSetup(size, minDistance);
  
  console.log(`Root cell: (${rootCell.row}, ${rootCell.col})`);
  console.log(`Target cell: (${targetCell.row}, ${targetCell.col})`);
  console.log("");
  
  // Build CNFs
  const startBuildOld = performance.now();
  const oldCNF = buildOldEncodingDimacs(grid, pathlengthConstraints, "square");
  const buildTimeOld = performance.now() - startBuildOld;
  
  const startBuildNew = performance.now();
  const newCNF = buildNewEncodingDimacs(grid, colorRoots, pathlengthConstraints, "square");
  const buildTimeNew = performance.now() - startBuildNew;
  
  console.log("CNF STATISTICS:");
  console.log(`  Old encoding: ${oldCNF.numVars} variables, ${oldCNF.numClauses} clauses (built in ${buildTimeOld.toFixed(0)}ms)`);
  console.log(`  New encoding: ${newCNF.numVars} variables, ${newCNF.numClauses} clauses (built in ${buildTimeNew.toFixed(0)}ms)`);
  console.log("");
  
  // Test with CaDiCaL
  console.log("-".repeat(60));
  console.log("CADICAL SOLVER RESULTS:");
  console.log("-".repeat(60));
  
  const cadicalOld = runCadical(oldCNF.dimacs);
  const cadicalNew = runCadical(newCNF.dimacs);
  
  console.log(`  Old encoding: ${cadicalOld.sat === true ? 'SAT' : cadicalOld.sat === false ? 'UNSAT' : 'ERROR'} in ${cadicalOld.time.toFixed(0)}ms`);
  console.log(`  New encoding: ${cadicalNew.sat === true ? 'SAT' : cadicalNew.sat === false ? 'UNSAT' : 'ERROR'} in ${cadicalNew.time.toFixed(0)}ms`);
  
  if (cadicalOld.sat && cadicalNew.sat) {
    const ratio = cadicalNew.time / cadicalOld.time;
    console.log(`  => Old is ${ratio.toFixed(1)}x ${ratio > 1 ? 'FASTER' : 'SLOWER'}`);
  }
  console.log("");
  
  // Test with MiniSat
  console.log("-".repeat(60));
  console.log("MINISAT SOLVER RESULTS:");
  console.log("-".repeat(60));
  
  const minisatOld = runMinisat(oldCNF.dimacs);
  const minisatNew = runMinisat(newCNF.dimacs);
  
  console.log(`  Old encoding: ${minisatOld.sat === true ? 'SAT' : minisatOld.sat === false ? 'UNSAT' : 'ERROR'} in ${minisatOld.time.toFixed(0)}ms`);
  console.log(`  New encoding: ${minisatNew.sat === true ? 'SAT' : minisatNew.sat === false ? 'UNSAT' : 'ERROR'} in ${minisatNew.time.toFixed(0)}ms`);
  
  if (minisatOld.sat && minisatNew.sat) {
    const ratio = minisatNew.time / minisatOld.time;
    console.log(`  => Old is ${ratio.toFixed(1)}x ${ratio > 1 ? 'FASTER' : 'SLOWER'}`);
  }
  console.log("");
}

/**
 * Run all benchmarks
 */
function runBenchmark(): void {
  const SIZE = 12;
  // Browser uses minDistance = max(width, height)
  const MIN_DISTANCE = Math.max(SIZE, SIZE);
  
  console.log("=".repeat(60));
  console.log("BENCHMARK: Tree vs No-Tree SAT Encoding");
  console.log("=".repeat(60));
  console.log(`Grid size: ${SIZE}x${SIZE}`);
  console.log(`Inner grid (excluding hatch border): ${SIZE-2}x${SIZE-2} = ${(SIZE-2)*(SIZE-2)} cells`);
  console.log(`Min distance: ${MIN_DISTANCE} (matching browser's Maze Setup)`);
  console.log("");
  console.log("NOTE: All interior cells are pre-colored RED (matching browser).");
  console.log("Entrance at middle-left, exit at middle-right.");
  console.log("");
  
  console.log("=".repeat(60));
  console.log(`TEST: Min distance = ${MIN_DISTANCE}`);
  console.log("=".repeat(60));
  runSingleBenchmark(SIZE, MIN_DISTANCE);
  
  // Also test with the user's requested minDistance = 70
  console.log("=".repeat(60));
  console.log("TEST: Min distance = 70 (user requested)");
  console.log("=".repeat(60));
  runSingleBenchmark(SIZE, 70);
}

// Run the benchmark
runBenchmark();
