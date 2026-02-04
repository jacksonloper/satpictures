/**
 * Test for wallpaper maze SAT encoding
 * 
 * Run with: npx tsx src/wallpaper-maze/wallpaper-maze.test.ts
 */

import { MiniSatSolver } from "../solvers/minisat-solver.js";

// Types for wallpaper maze problems
type WallpaperGroup = "P1" | "P2" | "pgg";

interface GridCell {
  row: number;
  col: number;
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function getWrappedNeighbors(
  row: number,
  col: number,
  length: number,
  wallpaperGroup: WallpaperGroup
): { N: GridCell; S: GridCell; E: GridCell; W: GridCell } {
  if (wallpaperGroup === "P1") {
    return {
      N: { row: (row - 1 + length) % length, col },
      S: { row: (row + 1) % length, col },
      E: { row, col: (col + 1) % length },
      W: { row, col: (col - 1 + length) % length },
    };
  } else if (wallpaperGroup === "P2") {
    let N: GridCell, S: GridCell, E: GridCell, W: GridCell;
    
    if (row === 0) {
      N = { row: 0, col: (length - 1 - col) };
    } else {
      N = { row: row - 1, col };
    }
    
    if (row === length - 1) {
      S = { row: length - 1, col: (length - 1 - col) };
    } else {
      S = { row: row + 1, col };
    }
    
    if (col === 0) {
      W = { row: (length - 1 - row), col: 0 };
    } else {
      W = { row, col: col - 1 };
    }
    
    if (col === length - 1) {
      E = { row: (length - 1 - row), col: length - 1 };
    } else {
      E = { row, col: col + 1 };
    }
    
    return { N, S, E, W };
  } else {
    // pgg: torus-like but with flips
    let N: GridCell, S: GridCell, E: GridCell, W: GridCell;
    
    if (row === 0) {
      N = { row: length - 1, col: length - col - 1 };
    } else {
      N = { row: row - 1, col };
    }
    
    if (row === length - 1) {
      S = { row: 0, col: length - col - 1 };
    } else {
      S = { row: row + 1, col };
    }
    
    if (col === 0) {
      W = { row: length - row - 1, col: length - 1 };
    } else {
      W = { row, col: col - 1 };
    }
    
    if (col === length - 1) {
      E = { row: length - row - 1, col: 0 };
    } else {
      E = { row, col: col + 1 };
    }
    
    return { N, S, E, W };
  }
}

interface CNF {
  numVars: number;
  clauses: number[][];
  varOf: Map<string, number>;
}

function buildMazeSATCNF(
  length: number,
  rootRow: number,
  rootCol: number,
  wallpaperGroup: WallpaperGroup
): CNF {
  const cnf: CNF = {
    numVars: 0,
    clauses: [],
    varOf: new Map(),
  };
  
  function v(name: string): number {
    if (cnf.varOf.has(name)) return cnf.varOf.get(name)!;
    const id = ++cnf.numVars;
    cnf.varOf.set(name, id);
    return id;
  }
  
  function addClause(lits: number[]): void {
    const s = new Set<number>();
    for (const lit of lits) {
      if (s.has(-lit)) return;
      s.add(lit);
    }
    cnf.clauses.push([...s]);
  }
  
  function addImp(a: number, b: number): void {
    addClause([-a, b]);
  }
  
  const N = length * length;
  const rootKey = cellKey(rootRow, rootCol);
  
  const parentVar = (uRow: number, uCol: number, vRow: number, vCol: number) =>
    v(`par(${cellKey(uRow, uCol)})->(${cellKey(vRow, vCol)})`);
  
  const distVar = (row: number, col: number, d: number) =>
    v(`dist(${cellKey(row, col)})>=${d}`);
  
  // Build adjacency with deduplicated neighbors (important for small grids where multiple directions can point to same cell)
  const adjacency = new Map<string, GridCell[]>();
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      const allNeighbors = [neighbors.N, neighbors.S, neighbors.E, neighbors.W];
      // Deduplicate neighbors by their cell key
      const seen = new Set<string>();
      const uniqueNeighbors: GridCell[] = [];
      for (const n of allNeighbors) {
        const key = cellKey(n.row, n.col);
        if (!seen.has(key)) {
          seen.add(key);
          uniqueNeighbors.push(n);
        }
      }
      adjacency.set(cellKey(row, col), uniqueNeighbors);
    }
  }
  
  addClause([-distVar(rootRow, rootCol, 1)]);
  
  for (const neighbor of adjacency.get(rootKey)!) {
    addClause([-parentVar(rootRow, rootCol, neighbor.row, neighbor.col)]);
  }
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      for (let d = 2; d <= N; d++) {
        addImp(distVar(row, col, d), distVar(row, col, d - 1));
      }
    }
  }
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      addClause([-distVar(row, col, N)]);
    }
  }
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      if (row === rootRow && col === rootCol) continue;
      
      const neighbors = adjacency.get(cellKey(row, col))!;
      const parentLits = neighbors.map(n => parentVar(row, col, n.row, n.col));
      
      addClause(parentLits);
      
      for (let i = 0; i < parentLits.length; i++) {
        for (let j = i + 1; j < parentLits.length; j++) {
          addClause([-parentLits[i], -parentLits[j]]);
        }
      }
      
      addClause([distVar(row, col, 1)]);
    }
  }
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = adjacency.get(cellKey(row, col))!;
      for (const n of neighbors) {
        addClause([
          -parentVar(row, col, n.row, n.col),
          -parentVar(n.row, n.col, row, col)
        ]);
      }
    }
  }
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = adjacency.get(cellKey(row, col))!;
      
      for (const vv of neighbors) {
        const p = parentVar(row, col, vv.row, vv.col);
        
        addImp(p, distVar(row, col, 1));
        
        for (let d = 1; d < N; d++) {
          addClause([-p, -distVar(vv.row, vv.col, d), distVar(row, col, d + 1)]);
        }
        
        for (let d = 2; d <= N; d++) {
          addClause([-p, -distVar(row, col, d), distVar(vv.row, vv.col, d - 1)]);
        }
      }
    }
  }
  
  return cnf;
}

/**
 * Solve the maze SAT problem and return whether it's satisfiable
 */
function solveMaze(length: number, rootRow: number, rootCol: number, wallpaperGroup: WallpaperGroup): boolean {
  const cnf = buildMazeSATCNF(length, rootRow, rootCol, wallpaperGroup);
  const solver = new MiniSatSolver();
  
  // Create variables
  for (let i = 1; i <= cnf.numVars; i++) {
    solver.newVariable();
  }
  
  // Add clauses
  for (const clause of cnf.clauses) {
    solver.addClause(clause);
  }
  
  const result = solver.solve();
  return result.satisfiable;
}

/**
 * Debug the neighbors and adjacency for a given wallpaper group
 */
function debugNeighbors(length: number, wallpaperGroup: WallpaperGroup): void {
  console.log(`\n=== Debug neighbors for ${wallpaperGroup} (length=${length}) ===`);
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      console.log(`  Cell (${row},${col}): N=(${neighbors.N.row},${neighbors.N.col}), S=(${neighbors.S.row},${neighbors.S.col}), E=(${neighbors.E.row},${neighbors.E.col}), W=(${neighbors.W.row},${neighbors.W.col})`);
    }
  }
  
  // Check for self-loops
  console.log("\n  Checking for self-loops:");
  let hasSelfLoop = false;
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      const allNeighbors = [neighbors.N, neighbors.S, neighbors.E, neighbors.W];
      for (const n of allNeighbors) {
        if (n.row === row && n.col === col) {
          console.log(`    ❌ Self-loop at (${row},${col})`);
          hasSelfLoop = true;
        }
      }
    }
  }
  if (!hasSelfLoop) {
    console.log("    ✓ No self-loops");
  }
  
  // Check for duplicate neighbors
  console.log("\n  Checking for duplicate neighbors:");
  let hasDuplicates = false;
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      const neighborKeys = new Set<string>();
      const allNeighbors = [
        { dir: "N", n: neighbors.N },
        { dir: "S", n: neighbors.S },
        { dir: "E", n: neighbors.E },
        { dir: "W", n: neighbors.W }
      ];
      for (const { dir, n } of allNeighbors) {
        const key = `${n.row},${n.col}`;
        if (neighborKeys.has(key)) {
          console.log(`    ❌ Cell (${row},${col}) has duplicate neighbor (${n.row},${n.col}) from direction ${dir}`);
          hasDuplicates = true;
        }
        neighborKeys.add(key);
      }
    }
  }
  if (!hasDuplicates) {
    console.log("    ✓ No duplicate neighbors");
  }
}

// Test various configurations
console.log("=== Wallpaper Maze SAT Tests ===\n");

const wallpaperGroups: WallpaperGroup[] = ["P1", "P2", "pgg"];
const lengths = [2, 3, 4];

for (const wpg of wallpaperGroups) {
  console.log(`\n=== Testing ${wpg} ===`);
  
  for (const length of lengths) {
    const satisfiable = solveMaze(length, 0, 0, wpg);
    const status = satisfiable ? "✓ SAT" : "❌ UNSAT";
    console.log(`  Length=${length}: ${status}`);
    
    // If length=2 is unsatisfiable, debug it
    if (length === 2 && !satisfiable) {
      debugNeighbors(length, wpg);
    }
  }
}

console.log("\n=== Summary ===");
console.log("If length=2 is UNSAT, examine the neighbor structure above for issues.");
