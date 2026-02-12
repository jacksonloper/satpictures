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

/**
 * Create a P2 boundary crossing voltage matrix.
 * This combines translation with 180° rotation for crossing a P2 boundary.
 * @param dx - x translation component
 * @param dy - y translation component
 * @param n - grid size (used to compute rotation center offset)
 */
function createP2BoundaryVoltage(dx: number, dy: number, n: number): Matrix3x3 {
  // The voltage is: translate by (dx, dy), then rotate 180° around the appropriate center
  // For a 180° rotation: x' = -x + c, y' = -y + d where (c, d) is the fixed point
  // Combined: [-1, 0, 2*cx + dx; 0, -1, 2*cy + dy; 0, 0, 1]
  // For P2, the formula simplifies based on which boundary we're crossing
  return [-1, 0, dx + n - 1, 0, -1, dy + n - 1, 0, 0, 1];
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
 * Build P2 manifold for a grid of size n x n
 * P2 has projective plane topology with 180° rotation at boundaries
 * Multi-edges occur at boundaries where wrapping creates distinct edges
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
  
  // Create edges
  // P2 wrapping: edges at boundary connect with 180° rotation
  // Interior edges are normal E/S connections
  // Boundary edges wrap with rotation
  const edges: ManifoldEdge[] = [];
  
  // For P2, we need to track multi-edges more carefully
  // Each interior cell contributes E and S edges
  // Boundary cells contribute wrapped edges that may be multi-edges
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const fromIdx = nodeAtMap.get(nodeKey(row, col))!;
      
      // East edge
      if (col < n - 1) {
        // Interior: simple East neighbor
        const eastIdx = nodeAtMap.get(nodeKey(row, col + 1))!;
        edges.push({ from: fromIdx, to: eastIdx });
      } else {
        // East boundary: wraps to west with 180° rotation
        // (row, n-1) -> (n-1-row, n-1) via wrap
        const wrapRow = n - 1 - row;
        const wrapIdx = nodeAtMap.get(nodeKey(wrapRow, n - 1))!;
        edges.push({ from: fromIdx, to: wrapIdx });
      }
      
      // South edge
      if (row < n - 1) {
        // Interior: simple South neighbor
        const southIdx = nodeAtMap.get(nodeKey(row + 1, col))!;
        edges.push({ from: fromIdx, to: southIdx });
      } else {
        // South boundary: wraps to south with 180° rotation
        // (n-1, col) -> (n-1, n-1-col) via wrap
        const wrapCol = n - 1 - col;
        const wrapIdx = nodeAtMap.get(nodeKey(n - 1, wrapCol))!;
        edges.push({ from: fromIdx, to: wrapIdx });
      }
      
      // West edge (only for boundary wrapping - creates multi-edges)
      if (col === 0) {
        // West boundary: wraps to west with 180° rotation
        // (row, 0) -> (n-1-row, 0) via wrap
        const wrapRow = n - 1 - row;
        const wrapIdx = nodeAtMap.get(nodeKey(wrapRow, 0))!;
        // Only add if not a self-loop and distinct from what we'd get from the "to" side
        if (fromIdx !== wrapIdx) {
          edges.push({ from: fromIdx, to: wrapIdx });
        }
      }
      
      // North edge (only for boundary wrapping - creates multi-edges)
      if (row === 0) {
        // North boundary: wraps to north with 180° rotation
        // (0, col) -> (0, n-1-col) via wrap
        const wrapCol = n - 1 - col;
        const wrapIdx = nodeAtMap.get(nodeKey(0, wrapCol))!;
        // Only add if not a self-loop
        if (fromIdx !== wrapIdx) {
          edges.push({ from: fromIdx, to: wrapIdx });
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
 * P2 orbifold has translation + 180° rotation voltages at boundaries
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
  const edges: OrbifoldEdge[] = [];
  
  // 180° rotation around the center of the fundamental domain
  // For P2, the rotation center is at ((n-1)/2, (n-1)/2)
  // The voltage for crossing the boundary is: translate + rotate 180°
  // Combined as a single affine transform: rotate around the appropriate center
  
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const fromIdx = nodeAtMap.get(nodeKey(row, col))!;
      
      // East edge
      const eastCol = (col + 1) % n;
      const eastRow = col === n - 1 ? n - 1 - row : row;
      const eastIdx = nodeAtMap.get(nodeKey(eastRow, eastCol))!;
      
      // Voltage for east edge: identity inside, translate+rotate at boundary
      const eastVoltage = col === n - 1 
        ? createP2BoundaryVoltage(n, 0, n)  // East boundary crossing
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: eastIdx, voltage: eastVoltage });
      
      // South edge
      const southRow = (row + 1) % n;
      const southCol = row === n - 1 ? n - 1 - col : col;
      const southIdx = nodeAtMap.get(nodeKey(southRow, southCol))!;
      
      // Voltage for south edge: identity inside, translate+rotate at boundary
      const southVoltage = row === n - 1
        ? createP2BoundaryVoltage(0, n, n)  // South boundary crossing
        : IDENTITY_3X3;
      edges.push({ from: fromIdx, to: southIdx, voltage: southVoltage });
      
      // West edge (for boundary)
      if (col === 0) {
        const westRow = n - 1 - row;
        const westIdx = nodeAtMap.get(nodeKey(westRow, 0))!;
        // West boundary crossing: translate left by n
        const westVoltage = createP2BoundaryVoltage(-n, 0, n);
        edges.push({ from: fromIdx, to: westIdx, voltage: westVoltage });
      }
      
      // North edge (for boundary)
      if (row === 0) {
        const northCol = n - 1 - col;
        const northIdx = nodeAtMap.get(nodeKey(0, northCol))!;
        // North boundary crossing: translate up by n
        const northVoltage = createP2BoundaryVoltage(0, -n, n);
        edges.push({ from: fromIdx, to: northIdx, voltage: northVoltage });
      }
    }
  }
  
  // P2 generators: two glide reflections (or translations + rotation)
  // For P2, generators are typically two independent 2-fold rotation centers
  // But for simplicity, we use: T_x (translate by n in x), T_y (translate by n in y), R (180° rotation)
  // Since R² = I and T_x R T_x^(-1) = R, etc., the group is generated by translations + rotation
  const generators: Matrix3x3[] = [
    translation3x3(n, 0),    // Translate right by n
    translation3x3(0, n),    // Translate down by n
    rotation180_3x3(),       // 180° rotation
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
