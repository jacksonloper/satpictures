/**
 * Web Worker for running the CaDiCaL SAT solver for wallpaper maze problems
 * 
 * This worker loads the CaDiCaL WASM module and solves wallpaper maze spanning tree problems.
 * The worker can be terminated by the main thread to cancel long-running solves.
 */

/// <reference lib="webworker" />

import { CadicalSolver } from "../solvers";
import type { CadicalClass } from "../solvers";

// Types for wallpaper maze problems
export type WallpaperGroup = "P1" | "P2" | "pgg";

export interface WallpaperMazeRequest {
  length: number;
  rootRow: number;
  rootCol: number;
  wallpaperGroup: WallpaperGroup;
}

export interface WallpaperMazeResponse {
  success: boolean;
  error?: string;
  /** Type of message: 'progress' for stats before solving, 'result' for final result */
  messageType: "progress" | "result";
  /** SAT problem stats (sent in progress message before solving) */
  stats?: { numVars: number; numClauses: number };
  /** The maze solution (edges and parent relationships) */
  result?: {
    edges: Array<{
      from: { row: number; col: number };
      to: { row: number; col: number };
      isKept: boolean;
    }>;
    parentOf: Array<[string, { row: number; col: number } | null]>;
    distanceFromRoot: Array<[string, number]>;
  };
}

// Type definitions for the Emscripten module
interface CadicalModule {
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  onRuntimeInitialized?: () => void;
  locateFile?: (path: string) => string;
}

declare const self: typeof globalThis & {
  Module?: CadicalModule;
};

/**
 * Cadical class implementation (matches the one from cadical.worker.ts)
 */
class Cadical implements CadicalClass {
  private solverPtr: number | undefined = undefined;
  private module: CadicalModule;

  constructor(module: CadicalModule) {
    this.module = module;
    this.init();
  }

  init(): void {
    this.release();
    this.solverPtr = this.module.ccall("ccadical_init", "number", [], []) as number;
  }

  initPlain(): void {
    this.init();
    this.setOption("compact", 0);
    this.setOption("decompose", 0);
    this.setOption("deduplicate", 0);
    this.setOption("elim", 0);
    this.setOption("probe", 0);
    this.setOption("subsume", 0);
    this.setOption("ternary", 0);
    this.setOption("transred", 0);
    this.setOption("vivify", 0);
  }

  initSat(): void {
    this.init();
    this.setOption("elimreleff", 10);
    this.setOption("stabilizeonly", 1);
    this.setOption("subsumereleff", 60);
  }

  initUnsat(): void {
    this.init();
    this.setOption("stabilize", 0);
    this.setOption("walk", 0);
  }

  release(): void {
    if (this.solverPtr !== undefined) {
      this.module.ccall("ccadical_release", null, ["number"], [this.solverPtr]);
    }
    this.solverPtr = undefined;
  }

  signature(): string {
    return this.module.ccall("ccadical_signature", "string", [], []) as string;
  }

  add(litOrZero: number): void {
    this.module.ccall("ccadical_add", null, ["number", "number"], [this.solverPtr, litOrZero]);
  }

  addClause(clause: number[]): void {
    for (const lit of clause) {
      this.add(lit);
    }
    this.add(0);
  }

  assume(lit: number): void {
    this.module.ccall("ccadical_assume", null, ["number", "number"], [this.solverPtr, lit]);
  }

  solve(): boolean | undefined {
    const result = this.module.ccall("ccadical_solve", "number", ["number"], [this.solverPtr]) as number;
    if (result === 10) {
      return true;
    } else if (result === 20) {
      return false;
    } else {
      return undefined;
    }
  }

  value(lit: number): number {
    const v = this.module.ccall("ccadical_val", "number", ["number", "number"], [this.solverPtr, lit]) as number;
    if (v === 0) {
      return lit;
    } else {
      return v;
    }
  }

  model(vars: number[]): number[] {
    return vars.map((v) => this.value(v));
  }

  constrain(litOrZero: number): void {
    this.module.ccall("ccadical_constrain", null, ["number", "number"], [this.solverPtr, litOrZero]);
  }

  constrainClause(clause: number[]): void {
    for (const lit of clause) {
      this.constrain(lit);
    }
    this.constrain(0);
  }

  setOption(name: string, v: number): void {
    this.module.ccall("ccadical_set_option", null, ["number", "string", "number"], [this.solverPtr, name, v]);
  }

  printStatistics(): void {
    this.module.ccall("ccadical_print_statistics", null, ["number"], [this.solverPtr]);
  }
}

/**
 * Load the CaDiCaL WASM module
 */
function loadCadicalModule(): Promise<CadicalModule> {
  return new Promise((resolve, reject) => {
    fetch("/cadical/cadical-emscripten.js")
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch CaDiCaL script: ${response.status}`);
        }
        return response.text();
      })
      .then(scriptText => {
        (self as Record<string, unknown>)["Module"] = {
          locateFile: (path: string) => `/cadical/${path}`
        };
        
        (0, eval)(scriptText);
        
        if (self.Module) {
          self.Module.onRuntimeInitialized = () => resolve(self.Module!);
        } else {
          reject(new Error("CaDiCaL module failed to load"));
        }
      })
      .catch(error => {
        reject(new Error(`Failed to load CaDiCaL: ${error}`));
      });
  });
}

let modulePromise: Promise<CadicalModule> | null = null;

function getModule(): Promise<CadicalModule> {
  if (!modulePromise) {
    modulePromise = loadCadicalModule();
  }
  return modulePromise;
}

// Maze building helpers
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
    
    // North of (0, k) wraps to (length-1, length-k-1)
    if (row === 0) {
      N = { row: length - 1, col: length - col - 1 };
    } else {
      N = { row: row - 1, col };
    }
    
    // South of (length-1, k) wraps to (0, length-k-1)
    if (row === length - 1) {
      S = { row: 0, col: length - col - 1 };
    } else {
      S = { row: row + 1, col };
    }
    
    // West of (k, 0) wraps to (length-k-1, length-1)
    if (col === 0) {
      W = { row: length - row - 1, col: length - 1 };
    } else {
      W = { row, col: col - 1 };
    }
    
    // East of (k, length-1) wraps to (length-k-1, 0)
    if (col === length - 1) {
      E = { row: length - row - 1, col: 0 };
    } else {
      E = { row, col: col + 1 };
    }
    
    return { N, S, E, W };
  }
}

function getAllEdges(
  length: number,
  wallpaperGroup: WallpaperGroup
): Array<{ from: GridCell; to: GridCell; direction: "N" | "S" | "E" | "W" }> {
  const edges: Array<{ from: GridCell; to: GridCell; direction: "N" | "S" | "E" | "W" }> = [];
  const seen = new Set<string>();
  
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      const directions = ["N", "S", "E", "W"] as const;
      
      for (const dir of directions) {
        const neighbor = neighbors[dir];
        const fromKey = cellKey(row, col);
        const toKey = cellKey(neighbor.row, neighbor.col);
        const edgeId = fromKey < toKey ? `${fromKey}-${toKey}` : `${toKey}-${fromKey}`;
        
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({ from: { row, col }, to: neighbor, direction: dir });
        }
      }
    }
  }
  
  return edges;
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
  
  const adjacency = new Map<string, GridCell[]>();
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < length; col++) {
      const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
      adjacency.set(cellKey(row, col), [neighbors.N, neighbors.S, neighbors.E, neighbors.W]);
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

function computeDistances(
  length: number,
  rootRow: number,
  rootCol: number,
  keptEdges: Set<string>,
  wallpaperGroup: WallpaperGroup
): Map<string, number> {
  const distances = new Map<string, number>();
  const rootKey = cellKey(rootRow, rootCol);
  distances.set(rootKey, 0);
  
  const queue: GridCell[] = [{ row: rootRow, col: rootCol }];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = cellKey(current.row, current.col);
    const currentDist = distances.get(currentKey)!;
    
    const neighbors = getWrappedNeighbors(current.row, current.col, length, wallpaperGroup);
    const allNeighbors = [neighbors.N, neighbors.S, neighbors.E, neighbors.W];
    
    for (const neighbor of allNeighbors) {
      const neighborKey = cellKey(neighbor.row, neighbor.col);
      
      const edgeKey1 = `${currentKey}-${neighborKey}`;
      const edgeKey2 = `${neighborKey}-${currentKey}`;
      const isConnected = keptEdges.has(edgeKey1) || keptEdges.has(edgeKey2);
      
      if (isConnected && !distances.has(neighborKey)) {
        distances.set(neighborKey, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }
  
  return distances;
}

function formatErrorMessage(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (
    errorMessage.includes("Cannot enlarge memory arrays") ||
    errorMessage.includes("memory") ||
    errorMessage.includes("Out of memory") ||
    errorMessage.includes("abort()")
  ) {
    return "Out of memory - the grid is too complex to solve. Try a smaller grid.";
  }
  
  return errorMessage;
}

self.onmessage = async (event: MessageEvent<WallpaperMazeRequest>) => {
  const { length, rootRow, rootCol, wallpaperGroup } = event.data;

  try {
    // Validate inputs
    if (rootRow < 0 || rootRow >= length || rootCol < 0 || rootCol >= length) {
      throw new Error(`Root position (${rootRow}, ${rootCol}) is out of bounds for grid size ${length}`);
    }
    
    // Build the CNF
    const cnf = buildMazeSATCNF(length, rootRow, rootCol, wallpaperGroup);
    
    // Send progress message with stats
    const progressResponse: WallpaperMazeResponse = {
      success: true,
      messageType: "progress",
      stats: { numVars: cnf.numVars, numClauses: cnf.clauses.length },
    };
    self.postMessage(progressResponse);
    
    // Load the CaDiCaL module
    const module = await getModule();
    
    // Create a new CaDiCaL instance
    const cadical = new Cadical(module);
    
    // Create solver
    const solver = new CadicalSolver(cadical);
    
    // Create all variables
    for (let i = 1; i <= cnf.numVars; i++) {
      solver.newVariable();
    }
    
    // Add all clauses
    for (const clause of cnf.clauses) {
      solver.addClause(clause);
    }
    
    // Solve
    const result = solver.solve();
    
    if (!result.satisfiable) {
      cadical.release();
      const response: WallpaperMazeResponse = {
        success: false,
        error: "No solution found (unsatisfiable)",
        messageType: "result",
      };
      self.postMessage(response);
      return;
    }
    
    const assignment = result.assignment!;
    
    // Extract parent relationships
    const parentOf = new Map<string, GridCell | null>();
    parentOf.set(cellKey(rootRow, rootCol), null);
    
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        if (row === rootRow && col === rootCol) continue;
        
        const neighbors = getWrappedNeighbors(row, col, length, wallpaperGroup);
        const directions = [neighbors.N, neighbors.S, neighbors.E, neighbors.W];
        
        for (const n of directions) {
          const varName = `par(${cellKey(row, col)})->(${cellKey(n.row, n.col)})`;
          const varId = cnf.varOf.get(varName);
          if (varId && assignment.get(varId)) {
            parentOf.set(cellKey(row, col), n);
            break;
          }
        }
      }
    }
    
    // Build edges with kept/wall status
    const allEdges = getAllEdges(length, wallpaperGroup);
    const edges = allEdges.map(e => {
      const fromKey = cellKey(e.from.row, e.from.col);
      const toKey = cellKey(e.to.row, e.to.col);
      
      const parentOfFrom = parentOf.get(fromKey);
      const parentOfTo = parentOf.get(toKey);
      
      const isKept = Boolean(
        (parentOfFrom && cellKey(parentOfFrom.row, parentOfFrom.col) === toKey) ||
        (parentOfTo && cellKey(parentOfTo.row, parentOfTo.col) === fromKey)
      );
      
      return { from: e.from, to: e.to, isKept };
    });
    
    // Build kept edge set for distance computation
    const keptEdgeSet = new Set<string>();
    for (const edge of edges) {
      if (edge.isKept) {
        const fromKey = cellKey(edge.from.row, edge.from.col);
        const toKey = cellKey(edge.to.row, edge.to.col);
        keptEdgeSet.add(`${fromKey}-${toKey}`);
        keptEdgeSet.add(`${toKey}-${fromKey}`);
      }
    }
    
    // Compute distances from root
    const distanceFromRoot = computeDistances(length, rootRow, rootCol, keptEdgeSet, wallpaperGroup);
    
    // Clean up
    cadical.release();
    
    // Convert Maps to arrays for postMessage (Maps don't serialize well)
    const response: WallpaperMazeResponse = {
      success: true,
      messageType: "result",
      result: {
        edges,
        parentOf: Array.from(parentOf.entries()),
        distanceFromRoot: Array.from(distanceFromRoot.entries()),
      },
    };
    self.postMessage(response);
  } catch (error) {
    const response: WallpaperMazeResponse = {
      success: false,
      error: formatErrorMessage(error),
      messageType: "result",
    };
    self.postMessage(response);
  }
};
