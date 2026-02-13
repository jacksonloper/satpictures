/**
 * ManifoldOrbifold.ts
 * 
 * New data structures for wallpaper mazes using explicit graph representations.
 * 
 * A Manifold is an explicit graph:
 * - parameterized by "type" and n (size)
 * - has explicit list of integer coordinate nodes in 2D
 * - has explicit list of unordered edges (pairs of node indices)
 * - multi-edges are allowed (same pair can have multiple edges)
 * 
 * An Orbifold is a directed graph with voltage labels:
 * - parameterized by "type" and n (size)
 * - has explicit list of integer point coordinates
 * - has explicit list of directed edges (pairs of node indices)
 * - each directed edge has a voltage (3x3 integer matrix)
 * - specifies a 2x2 screen transform matrix (identity for P1/P2)
 * - specifies at least two 3x3 integer matrices that generate the wallpaper group
 * 
 * An Orbifold is compatible with a Manifold if there's a one-to-one correspondence
 * between nodes and edges.
 */

// ============================================================================
// 3x3 Matrix utilities (for voltages)
// ============================================================================

/** A 3x3 integer matrix represented as a flat array [a11, a12, a13, a21, a22, a23, a31, a32, a33] */
export type Matrix3x3 = [number, number, number, number, number, number, number, number, number];

/** Identity 3x3 matrix */
export const IDENTITY_3X3: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Multiply two 3x3 matrices */
export function matmul3x3(a: Matrix3x3, b: Matrix3x3): Matrix3x3 {
  return [
    a[0]*b[0] + a[1]*b[3] + a[2]*b[6], a[0]*b[1] + a[1]*b[4] + a[2]*b[7], a[0]*b[2] + a[1]*b[5] + a[2]*b[8],
    a[3]*b[0] + a[4]*b[3] + a[5]*b[6], a[3]*b[1] + a[4]*b[4] + a[5]*b[7], a[3]*b[2] + a[4]*b[5] + a[5]*b[8],
    a[6]*b[0] + a[7]*b[3] + a[8]*b[6], a[6]*b[1] + a[7]*b[4] + a[8]*b[7], a[6]*b[2] + a[7]*b[5] + a[8]*b[8],
  ];
}

/** Compute inverse of a 3x3 matrix (assumes determinant = ±1 for wallpaper groups) */
export function inverse3x3(m: Matrix3x3): Matrix3x3 {
  const det = m[0]*(m[4]*m[8] - m[5]*m[7]) - m[1]*(m[3]*m[8] - m[5]*m[6]) + m[2]*(m[3]*m[7] - m[4]*m[6]);
  if (Math.abs(det) < 0.0001) {
    throw new Error("Matrix is not invertible");
  }
  const invDet = 1 / det;
  return [
    (m[4]*m[8] - m[5]*m[7]) * invDet, (m[2]*m[7] - m[1]*m[8]) * invDet, (m[1]*m[5] - m[2]*m[4]) * invDet,
    (m[5]*m[6] - m[3]*m[8]) * invDet, (m[0]*m[8] - m[2]*m[6]) * invDet, (m[2]*m[3] - m[0]*m[5]) * invDet,
    (m[3]*m[7] - m[4]*m[6]) * invDet, (m[1]*m[6] - m[0]*m[7]) * invDet, (m[0]*m[4] - m[1]*m[3]) * invDet,
  ].map(Math.round) as Matrix3x3;
}

/** Check if two matrices are equal */
export function matrixEquals(a: Matrix3x3, b: Matrix3x3): boolean {
  for (let i = 0; i < 9; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Convert matrix to a string key for Set/Map operations */
export function matrixKey(m: Matrix3x3): string {
  return m.join(",");
}

/** Create a translation matrix that shifts by (dx, dy) in homogeneous coordinates */
export function translation3x3(dx: number, dy: number): Matrix3x3 {
  return [1, 0, dx, 0, 1, dy, 0, 0, 1];
}

/** Create a 180° rotation matrix (around origin) */
export function rotation180_3x3(): Matrix3x3 {
  return [-1, 0, 0, 0, -1, 0, 0, 0, 1];
}

// ============================================================================
// 2x2 Matrix utilities (for screen transform)
// ============================================================================

/** A 2x2 matrix represented as [a11, a12, a21, a22] */
export type Matrix2x2 = [number, number, number, number];

/** Identity 2x2 matrix */
export const IDENTITY_2X2: Matrix2x2 = [1, 0, 0, 1];

/** Apply 2x2 matrix to a point */
export function apply2x2(m: Matrix2x2, x: number, y: number): { x: number; y: number } {
  return { x: m[0]*x + m[1]*y, y: m[2]*x + m[3]*y };
}

// ============================================================================
// Manifold data structure
// ============================================================================

/** A node in the manifold */
export interface ManifoldNode {
  index: number;
  row: number;
  col: number;
}

/** An undirected edge in the manifold (indices of two nodes) */
export interface ManifoldEdge {
  from: number;  // index of first node
  to: number;    // index of second node
}

/** The Manifold structure */
export interface Manifold {
  type: string;
  n: number;
  nodes: ManifoldNode[];
  edges: ManifoldEdge[];
  /** Map from (row,col) to node index */
  nodeAt: Map<string, number>;
}

/** Create a node key from coordinates */
function nodeKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** Get edges that include a specific node */
export function getNodeEdges(manifold: Manifold, nodeIndex: number): ManifoldEdge[] {
  return manifold.edges.filter(e => e.from === nodeIndex || e.to === nodeIndex);
}

/** Get the "other" node in an edge given one node */
export function getOtherNode(edge: ManifoldEdge, nodeIndex: number): number {
  return edge.from === nodeIndex ? edge.to : edge.from;
}

// ============================================================================
// Orbifold data structure
// ============================================================================

/** A directed edge in the orbifold with voltage */
export interface OrbifoldEdge {
  from: number;       // index of source node
  to: number;         // index of target node
  voltage: Matrix3x3; // the voltage (wallpaper group element)
}

/** The Orbifold structure */
export interface Orbifold {
  type: string;
  n: number;
  nodes: ManifoldNode[];  // Same node structure as Manifold
  edges: OrbifoldEdge[];
  /** Map from (row,col) to node index */
  nodeAt: Map<string, number>;
  /** 2x2 screen transform (for axial coordinates like hexagonal) */
  screenTransform: Matrix2x2;
  /** Generators of the wallpaper group (at least 2 matrices) */
  generators: Matrix3x3[];
}

// ============================================================================
// P1 Manifold and Orbifold
// ============================================================================

/**
 * Build P1 manifold for a grid of size n x n
 * P1 has torus topology (wrap around all edges)
 */
export function buildP1Manifold(n: number): Manifold {
  const nodes: ManifoldNode[] = [];
  const nodeAtMap = new Map<string, number>();
  
  // Create nodes
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const index = nodes.length;
      nodes.push({ index, row, col });
      nodeAtMap.set(nodeKey(row, col), index);
    }
  }
  
  // Create edges (4 directions per node, but undirected so deduplicate)
  const edges: ManifoldEdge[] = [];
  const addedEdges = new Set<string>();
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const fromIdx = nodeAtMap.get(nodeKey(row, col))!;
      
      // East neighbor (wraps)
      const eastRow = row;
      const eastCol = (col + 1) % n;
      const eastIdx = nodeAtMap.get(nodeKey(eastRow, eastCol))!;
      const eastKey = [Math.min(fromIdx, eastIdx), Math.max(fromIdx, eastIdx)].join("-");
      if (!addedEdges.has(eastKey)) {
        edges.push({ from: fromIdx, to: eastIdx });
        addedEdges.add(eastKey);
      }
      
      // South neighbor (wraps)
      const southRow = (row + 1) % n;
      const southCol = col;
      const southIdx = nodeAtMap.get(nodeKey(southRow, southCol))!;
      const southKey = [Math.min(fromIdx, southIdx), Math.max(fromIdx, southIdx)].join("-");
      if (!addedEdges.has(southKey)) {
        edges.push({ from: fromIdx, to: southIdx });
        addedEdges.add(southKey);
      }
    }
  }
  
  return {
    type: "P1",
    n,
    nodes,
    edges,
    nodeAt: nodeAtMap,
  };
}

/**
 * Build P1 orbifold for a grid of size n x n
 * P1 orbifold has directed edges with translation voltages at boundaries
 */
export function buildP1Orbifold(n: number): Orbifold {
  const nodes: ManifoldNode[] = [];
  const nodeAtMap = new Map<string, number>();
  
  // Create nodes (same as manifold)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const index = nodes.length;
      nodes.push({ index, row, col });
      nodeAtMap.set(nodeKey(row, col), index);
    }
  }
  
  // Create directed edges with voltages
  const edges: OrbifoldEdge[] = [];
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const fromIdx = nodeAtMap.get(nodeKey(row, col))!;
      
      // East edge
      const eastCol = (col + 1) % n;
      const eastIdx = nodeAtMap.get(nodeKey(row, eastCol))!;
      // Voltage: identity inside, translate by (n, 0) when wrapping
      const eastVoltage: Matrix3x3 = col === n - 1 
        ? translation3x3(n, 0)  // Wrap: translate right by n
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: eastIdx, voltage: eastVoltage });
      
      // South edge
      const southRow = (row + 1) % n;
      const southIdx = nodeAtMap.get(nodeKey(southRow, col))!;
      // Voltage: identity inside, translate by (0, n) when wrapping
      const southVoltage: Matrix3x3 = row === n - 1
        ? translation3x3(0, n)  // Wrap: translate down by n
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: southIdx, voltage: southVoltage });
    }
  }
  
  // P1 generators: two translations
  const generators: Matrix3x3[] = [
    translation3x3(n, 0),  // Translate right by n
    translation3x3(0, n),  // Translate down by n
  ];
  
  return {
    type: "P1",
    n,
    nodes,
    edges,
    nodeAt: nodeAtMap,
    screenTransform: IDENTITY_2X2,
    generators,
  };
}

// ============================================================================
// P2 Manifold and Orbifold
// ============================================================================

/**
 * Get P2 neighbors for a node at (row, col) in an n×n grid.
 * P2 has sphere topology with boundary folding:
 * - North boundary: (0, col) -> (0, n-1-col)
 * - South boundary: (n-1, col) -> (n-1, n-1-col)
 * - East boundary: (row, n-1) -> (n-1-row, n-1)
 * - West boundary: (row, 0) -> (n-1-row, 0)
 */
function getP2Neighbors(row: number, col: number, n: number): {
  N: { row: number; col: number };
  S: { row: number; col: number };
  E: { row: number; col: number };
  W: { row: number; col: number };
} {
  // North neighbor
  const N = row === 0
    ? { row: 0, col: n - 1 - col }      // Fold at top boundary
    : { row: row - 1, col };
  
  // South neighbor
  const S = row === n - 1
    ? { row: n - 1, col: n - 1 - col }  // Fold at bottom boundary
    : { row: row + 1, col };
  
  // East neighbor
  const E = col === n - 1
    ? { row: n - 1 - row, col: n - 1 }  // Fold at right boundary
    : { row, col: col + 1 };
  
  // West neighbor
  const W = col === 0
    ? { row: n - 1 - row, col: 0 }      // Fold at left boundary
    : { row, col: col - 1 };
  
  return { N, S, E, W };
}

/**
 * Build P2 manifold for a grid of size n x n
 * 
 * P2 has sphere topology where each boundary edge is folded onto itself
 * with a 180° rotation. This creates:
 * - Self-loops at edge midpoints (for odd n)
 * - Multi-edges when N and E (or S and W) point to the same neighbor
 * 
 * Every node has exactly 4 edges (counting multi-edges), since it has
 * 4 cardinal directions that each produce an edge.
 */
export function buildP2Manifold(n: number): Manifold {
  const nodes: ManifoldNode[] = [];
  const nodeAtMap = new Map<string, number>();
  
  // Create nodes
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const index = nodes.length;
      nodes.push({ index, row, col });
      nodeAtMap.set(nodeKey(row, col), index);
    }
  }
  
  // Create edges using the P2 neighbor function
  // For P2, we need to track edges per-direction, not per-pair, because:
  // 1. Self-loops are counted once per direction they appear
  // 2. Multi-edges are allowed (same pair can have multiple edges)
  //
  // Strategy: iterate through all nodes, add E and S edges only (to avoid duplicates
  // from opposite directions). But for boundary nodes, the N/W edges might point to
  // different copies than what E/S from other nodes would produce.
  //
  // Actually, the cleanest approach: for each node, process all 4 directions,
  // but only add edges where fromIdx <= toIdx to deduplicate within a direction.
  // For multi-edges (same pair via different directions), we track direction too.
  
  const edges: ManifoldEdge[] = [];
  // Track "fromIdx-toIdx-direction" to handle multi-edges properly
  const directionEdgeKeys = new Set<string>();
  
  // Map direction to its reverse
  const reverseDirection: Record<string, string> = { N: "S", S: "N", E: "W", W: "E" };
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const fromIdx = nodeAtMap.get(nodeKey(row, col))!;
      const neighbors = getP2Neighbors(row, col, n);
      
      // Process each direction
      const directions = [
        { name: "N", neighbor: neighbors.N },
        { name: "S", neighbor: neighbors.S },
        { name: "E", neighbor: neighbors.E },
        { name: "W", neighbor: neighbors.W },
      ];
      
      for (const { name, neighbor } of directions) {
        const toIdx = nodeAtMap.get(nodeKey(neighbor.row, neighbor.col))!;
        
        // For undirected edges, we only add from the "lower" node to avoid duplicates
        // But we need to track which directions we've processed
        if (fromIdx <= toIdx) {
          // Check if we've already added this edge from this direction
          const edgeKey = `${fromIdx}-${toIdx}-${name}`;
          const reverseKey = `${toIdx}-${fromIdx}-${reverseDirection[name]}`;
          
          // Add edge if we haven't seen it or its reverse
          if (!directionEdgeKeys.has(edgeKey) && !directionEdgeKeys.has(reverseKey)) {
            edges.push({ from: fromIdx, to: toIdx });
            directionEdgeKeys.add(edgeKey);
          }
        }
      }
    }
  }
  
  return {
    type: "P2",
    n,
    nodes,
    edges,
    nodeAt: nodeAtMap,
  };
}

/**
 * Build P2 orbifold for a grid of size n x n
 * 
 * The orbifold has directed edges with voltage matrices.
 * Each node has 4 outgoing edges (N, S, E, W) matching the 4 neighbors.
 * Interior edges have identity voltage.
 * Boundary edges have 180° rotation voltages (det = 1, not reflections!)
 * 
 * P2 copies are arranged in a checkerboard pattern:
 * - Type 0 (identity) at even (copyRow + copyCol)
 * - Type 1 (180° rotated around (n/2, n/2)) at odd (copyRow + copyCol)
 * 
 * Voltage formulas (all are 180° rotations with det = 1):
 * - North (row=0): T(0,-n) * R = [[-1, 0, n], [0, -1, 0], [0, 0, 1]]
 * - South (row=n-1): T(0,n) * R = [[-1, 0, n], [0, -1, 2n], [0, 0, 1]]
 * - East (col=n-1): T(n,0) * R = [[-1, 0, 2n], [0, -1, n], [0, 0, 1]]
 * - West (col=0): T(-n,0) * R = [[-1, 0, 0], [0, -1, n], [0, 0, 1]]
 * 
 * Where R = 180° rotation around (n/2, n/2) = [[-1,0,n], [0,-1,n], [0,0,1]]
 */
export function buildP2Orbifold(n: number): Orbifold {
  const nodes: ManifoldNode[] = [];
  const nodeAtMap = new Map<string, number>();
  
  // Create nodes
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const index = nodes.length;
      nodes.push({ index, row, col });
      nodeAtMap.set(nodeKey(row, col), index);
    }
  }
  
  // Create directed edges with voltages
  // Each node has 4 outgoing edges: N, S, E, W
  const edges: OrbifoldEdge[] = [];
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const fromIdx = nodeAtMap.get(nodeKey(row, col))!;
      const neighbors = getP2Neighbors(row, col, n);
      
      // North edge
      const northIdx = nodeAtMap.get(nodeKey(neighbors.N.row, neighbors.N.col))!;
      // North boundary: T(0,-n) * R where R = rotation around (n/2, n/2)
      const northVoltage: Matrix3x3 = row === 0
        ? [-1, 0, n, 0, -1, 0, 0, 0, 1]
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: northIdx, voltage: northVoltage });
      
      // South edge
      const southIdx = nodeAtMap.get(nodeKey(neighbors.S.row, neighbors.S.col))!;
      // South boundary: T(0,n) * R
      const southVoltage: Matrix3x3 = row === n - 1
        ? [-1, 0, n, 0, -1, 2 * n, 0, 0, 1]
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: southIdx, voltage: southVoltage });
      
      // East edge
      const eastIdx = nodeAtMap.get(nodeKey(neighbors.E.row, neighbors.E.col))!;
      // East boundary: T(n,0) * R
      const eastVoltage: Matrix3x3 = col === n - 1
        ? [-1, 0, 2 * n, 0, -1, n, 0, 0, 1]
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: eastIdx, voltage: eastVoltage });
      
      // West edge
      const westIdx = nodeAtMap.get(nodeKey(neighbors.W.row, neighbors.W.col))!;
      // West boundary: T(-n,0) * R
      const westVoltage: Matrix3x3 = col === 0
        ? [-1, 0, 0, 0, -1, n, 0, 0, 1]
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: westIdx, voltage: westVoltage });
    }
  }
  
  // P2 generators: T(n,0), T(0,n), and R (180° rotation around center)
  // Note: Tx by 2n and Ty by 2n generate type-0-to-type-0 translations
  // But the full P2 group includes T(n,0) and T(0,n) which go to type-1 copies
  const R: Matrix3x3 = [-1, 0, n, 0, -1, n, 0, 0, 1];  // 180° around (n/2, n/2)
  const generators: Matrix3x3[] = [
    translation3x3(n, 0),   // Takes type 0 -> type 1
    translation3x3(0, n),   // Takes type 0 -> type 1
    R,                      // 180° rotation
  ];
  
  return {
    type: "P2",
    n,
    nodes,
    edges,
    nodeAt: nodeAtMap,
    screenTransform: IDENTITY_2X2,
    generators,
  };
}

// ============================================================================
// Factory functions
// ============================================================================

export type ManifoldType = "P1" | "P2";

export function buildManifold(type: ManifoldType, n: number): Manifold {
  switch (type) {
    case "P1": return buildP1Manifold(n);
    case "P2": return buildP2Manifold(n);
  }
}

export function buildOrbifold(type: ManifoldType, n: number): Orbifold {
  switch (type) {
    case "P1": return buildP1Orbifold(n);
    case "P2": return buildP2Orbifold(n);
  }
}

/** Check if an orbifold is compatible with a manifold */
export function isCompatible(manifold: Manifold, orbifold: Orbifold): boolean {
  // Same number of nodes?
  if (manifold.nodes.length !== orbifold.nodes.length) return false;
  
  // Same number of edges?
  // Note: orbifold edges are directed, manifold edges are undirected
  // For compatibility, we need orbifold to have exactly one directed edge per undirected edge
  // (or two directed edges if the manifold has a "multi-edge")
  
  // For now, just check basic structure
  return manifold.type === orbifold.type && manifold.n === orbifold.n;
}

// ============================================================================
// Copy expansion via BFS
// ============================================================================

/** A copy of the fundamental domain, identified by a matrix */
export interface Copy {
  matrix: Matrix3x3;
  key: string;
}

/**
 * Expand copies using BFS starting from identity, following voltages.
 * Repeats `multiplier` times to get more copies.
 */
export function expandCopies(orbifold: Orbifold, multiplier: number): Copy[] {
  const copies = new Map<string, Copy>();
  const identityKey = matrixKey(IDENTITY_3X3);
  copies.set(identityKey, { matrix: IDENTITY_3X3, key: identityKey });
  
  // BFS frontier
  let frontier = [IDENTITY_3X3];
  
  for (let round = 0; round < multiplier; round++) {
    const nextFrontier: Matrix3x3[] = [];
    
    for (const currentMatrix of frontier) {
      // For each edge in the orbifold, compute the target copy
      for (const edge of orbifold.edges) {
        // Following an edge with voltage v from copy A gives copy A*v
        const targetMatrix = matmul3x3(currentMatrix, edge.voltage);
        const targetKey = matrixKey(targetMatrix);
        
        if (!copies.has(targetKey)) {
          copies.set(targetKey, { matrix: targetMatrix, key: targetKey });
          nextFrontier.push(targetMatrix);
        }
        
        // Also follow the edge in reverse (inverse voltage)
        const inverseMatrix = matmul3x3(currentMatrix, inverse3x3(edge.voltage));
        const inverseKey = matrixKey(inverseMatrix);
        
        if (!copies.has(inverseKey)) {
          copies.set(inverseKey, { matrix: inverseMatrix, key: inverseKey });
          nextFrontier.push(inverseMatrix);
        }
      }
    }
    
    frontier = nextFrontier;
  }
  
  return Array.from(copies.values());
}

// ============================================================================
// Rendering helpers
// ============================================================================

/**
 * Apply a 3x3 affine matrix to a 2D point (homogeneous coords)
 */
export function applyMatrix3x3(m: Matrix3x3, x: number, y: number): { x: number; y: number } {
  // (x', y', 1) = M * (x, y, 1)
  const newX = m[0]*x + m[1]*y + m[2];
  const newY = m[3]*x + m[4]*y + m[5];
  return { x: newX, y: newY };
}

/**
 * Check if an edge is a "stub" (goes more than one hop away in visual space)
 */
export function isStubEdge(
  manifold: Manifold,
  edge: ManifoldEdge,
  nodeIndex: number,
): boolean {
  const fromNode = manifold.nodes[edge.from];
  const toNode = manifold.nodes[edge.to];
  
  // For the node we're looking at, check if the other node is adjacent
  const thisNode = nodeIndex === edge.from ? fromNode : toNode;
  const otherNode = nodeIndex === edge.from ? toNode : fromNode;
  
  const rowDiff = Math.abs(thisNode.row - otherNode.row);
  const colDiff = Math.abs(thisNode.col - otherNode.col);
  
  // If Manhattan distance > 1, it's a wrapped edge (stub)
  return rowDiff > 1 || colDiff > 1;
}

// ============================================================================
// Manifold-to-Orbifold edge mapping
// ============================================================================

/**
 * Find the orbifold edge that corresponds to a manifold edge going from `from` to `to`.
 * Returns the orbifold edge (with its voltage) or null if not found.
 */
export function findOrbifoldEdge(
  orbifold: Orbifold,
  fromNodeIndex: number,
  toNodeIndex: number,
): OrbifoldEdge | null {
  // Look for a directed edge from -> to in the orbifold
  for (const edge of orbifold.edges) {
    if (edge.from === fromNodeIndex && edge.to === toNodeIndex) {
      return edge;
    }
  }
  return null;
}

/**
 * Get the orbifold edge for a manifold edge, trying both directions.
 * Returns { edge, reversed } where `reversed` indicates if we had to flip the direction.
 */
export function getOrbifoldEdgeForManifoldEdge(
  manifold: Manifold,
  orbifold: Orbifold,
  manifoldEdgeIndex: number,
): { orbifoldEdge: OrbifoldEdge; reversed: boolean } | null {
  const manifoldEdge = manifold.edges[manifoldEdgeIndex];
  
  // Try forward direction first
  const forwardEdge = findOrbifoldEdge(orbifold, manifoldEdge.from, manifoldEdge.to);
  if (forwardEdge) {
    return { orbifoldEdge: forwardEdge, reversed: false };
  }
  
  // Try reverse direction
  const reverseEdge = findOrbifoldEdge(orbifold, manifoldEdge.to, manifoldEdge.from);
  if (reverseEdge) {
    return { orbifoldEdge: reverseEdge, reversed: true };
  }
  
  return null;
}

// ============================================================================
// Random Spanning Tree
// ============================================================================

/**
 * Union-Find (Disjoint Set Union) data structure for Kruskal's algorithm
 */
class UnionFind {
  private parent: number[];
  private rank: number[];
  
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array(n).fill(0);
  }
  
  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // Path compression
    }
    return this.parent[x];
  }
  
  union(x: number, y: number): boolean {
    const rootX = this.find(x);
    const rootY = this.find(y);
    
    if (rootX === rootY) return false; // Already in same set
    
    // Union by rank
    if (this.rank[rootX] < this.rank[rootY]) {
      this.parent[rootX] = rootY;
    } else if (this.rank[rootX] > this.rank[rootY]) {
      this.parent[rootY] = rootX;
    } else {
      this.parent[rootY] = rootX;
      this.rank[rootX]++;
    }
    return true;
  }
}

/**
 * Fisher-Yates shuffle algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate a random spanning tree for a manifold using randomized Kruskal's algorithm.
 * Returns the set of edge indices that form the spanning tree.
 * 
 * A spanning tree:
 * - Contains exactly (n² - 1) edges (for n × n grid)
 * - Connects all nodes
 * - Has no cycles
 */
export function generateRandomSpanningTree(manifold: Manifold): Set<number> {
  const numNodes = manifold.nodes.length;
  const numEdges = manifold.edges.length;
  
  // Create shuffled array of edge indices
  const edgeIndices = shuffleArray(Array.from({ length: numEdges }, (_, i) => i));
  
  const uf = new UnionFind(numNodes);
  const treeEdges = new Set<number>();
  
  // Kruskal's algorithm: add edges that don't create cycles
  for (const edgeIdx of edgeIndices) {
    if (treeEdges.size === numNodes - 1) break; // Tree is complete
    
    const edge = manifold.edges[edgeIdx];
    if (uf.union(edge.from, edge.to)) {
      treeEdges.add(edgeIdx);
    }
  }
  
  return treeEdges;
}

/**
 * Check if an edge (by index) is part of the spanning tree
 */
export function isTreeEdge(
  edgeIdx: number,
  spanningTreeEdges: Set<number>,
): boolean {
  return spanningTreeEdges.has(edgeIdx);
}
