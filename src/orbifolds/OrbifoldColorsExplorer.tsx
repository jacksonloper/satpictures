/**
 * Orbifold Colors Explorer Page
 *
 * A large-scale view of wallpaper-group orbifolds rendered with Three.js.
 * The user picks a wallpaper type, size n (default 40), and expansion m
 * (default 160), then generates either a random spanning tree or a random
 * DFS deep tree. The lifted graph is built, colored by connected component,
 * and rendered as triangulated polygons using an orthographic camera with
 * pan and zoom.
 *
 * P3 always uses the axial transform.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  createOrbifoldGrid,
  type WallpaperGroupType,
  type ColorData,
  type EdgeStyleData,
  type EdgeLinestyle,
} from "./createOrbifolds";
import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  applyMatrix,
  axialToCartesian,
  type OrbifoldGrid,
  type LiftedGraph,
} from "./orbifoldbasics";
import { applyRandomSpanningTreeToWhiteNodes } from "./spanningTree";
import "../App.css";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_N = 40;
const DEFAULT_M = 160;

// ---------------------------------------------------------------------------
// Random DFS tree: DFS from random root with random edge order at each node
// ---------------------------------------------------------------------------
function applyRandomDfsTree(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
): OrbifoldGrid<ColorData, EdgeStyleData> {
  // Build simple adjacency: nodeId -> list of { neighbor, edgeId }
  // Skip self-loops.
  type Adj = { neighbor: string; edgeId: string };
  const adj = new Map<string, Adj[]>();
  for (const nodeId of grid.nodes.keys()) adj.set(nodeId, []);

  for (const [edgeId, edge] of grid.edges) {
    const endpoints = Array.from(edge.halfEdges.keys());
    if (endpoints.length === 1) continue; // self-loop
    const [a, b] = endpoints;
    if (a === b) continue; // self-loop (2 half-edges, same node)
    adj.get(a)!.push({ neighbor: b, edgeId });
    adj.get(b)!.push({ neighbor: a, edgeId });
  }

  // Shuffle each adjacency list (Fisher-Yates)
  for (const list of adj.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  // DFS from random root, collecting tree edges
  const treeEdges = new Set<string>();
  const nodeIds = Array.from(grid.nodes.keys());
  const startIdx = Math.floor(Math.random() * nodeIds.length);
  const startNode = nodeIds[startIdx];

  const visited = new Set<string>();
  visited.add(startNode);

  // Iterative DFS: stack of (node, adjIndex)
  const stack: Array<{ node: string; adjIdx: number }> = [];
  stack.push({ node: startNode, adjIdx: 0 });

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const neighbors = adj.get(frame.node)!;

    if (frame.adjIdx >= neighbors.length) {
      stack.pop();
      continue;
    }

    const { neighbor, edgeId } = neighbors[frame.adjIdx];
    frame.adjIdx++;

    if (visited.has(neighbor)) continue;

    // Tree edge: mark and descend
    visited.add(neighbor);
    treeEdges.add(edgeId);
    stack.push({ node: neighbor, adjIdx: 0 });
  }

  // Mark tree edges as solid, everything else dashed
  const newEdges = new Map(grid.edges);
  for (const [edgeId, edge] of newEdges) {
    const linestyle: EdgeLinestyle = treeEdges.has(edgeId) ? "solid" : "dashed";
    newEdges.set(edgeId, { ...edge, data: { linestyle } });
  }
  return { nodes: grid.nodes, edges: newEdges, adjacency: grid.adjacency };
}

// ---------------------------------------------------------------------------
// Union-Find for fast connected components
// ---------------------------------------------------------------------------
class UnionFind {
  parent: Int32Array;
  rank: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.rank = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    // path compression
    while (this.parent[x] !== r) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

// ---------------------------------------------------------------------------
// Compute connected components via Union-Find on solid edges
// ---------------------------------------------------------------------------
function computeComponents(
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>,
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>,
): { components: Map<string, number>; nodesWithSolidEdge: Set<string> } {
  const nodeIds = Array.from(liftedGraph.nodes.keys());
  const idxMap = new Map<string, number>();
  nodeIds.forEach((id, i) => idxMap.set(id, i));

  const uf = new UnionFind(nodeIds.length);
  const nodesWithSolidEdge = new Set<string>();
  for (const edge of liftedGraph.edges.values()) {
    const orbEdge = edge.orbifoldEdgeId
      ? orbifoldGrid.edges.get(edge.orbifoldEdgeId)
      : undefined;
    if ((orbEdge?.data?.linestyle ?? "solid") === "dashed") continue;
    const ia = idxMap.get(edge.a);
    const ib = idxMap.get(edge.b);
    if (ia !== undefined && ib !== undefined) uf.union(ia, ib);
    nodesWithSolidEdge.add(edge.a);
    nodesWithSolidEdge.add(edge.b);
  }

  // Map root indices → component ids (0-based sequential)
  const rootToComp = new Map<number, number>();
  let nextComp = 0;
  const components = new Map<string, number>();
  for (let i = 0; i < nodeIds.length; i++) {
    const root = uf.find(i);
    let comp = rootToComp.get(root);
    if (comp === undefined) {
      comp = nextComp++;
      rootToComp.set(root, comp);
    }
    components.set(nodeIds[i], comp);
  }
  return { components, nodesWithSolidEdge };
}

// ---------------------------------------------------------------------------
// Color from component id  (returns normalized [0,1] RGB)
// ---------------------------------------------------------------------------
function componentColorNorm(compId: number): [number, number, number] {
  const hue = (compId * 137.508) % 360;
  const s = 0.7,
    l = 0.5;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (hue < 60) {
    r = c; g = x; b = 0;
  } else if (hue < 120) {
    r = x; g = c; b = 0;
  } else if (hue < 180) {
    r = 0; g = c; b = x;
  } else if (hue < 240) {
    r = 0; g = x; b = c;
  } else if (hue < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  return [r + m, g + m, b + m];
}

// ---------------------------------------------------------------------------
// Build Three.js mesh + wall lines from lifted graph polygons
// ---------------------------------------------------------------------------
function buildSceneObjects(
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>,
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>,
  useAxialTransform: boolean,
): { mesh: THREE.Mesh; walls: THREE.LineSegments } {
  const { components, nodesWithSolidEdge } = computeComponents(liftedGraph, orbifoldGrid);

  // --- 1. Triangulated polygon mesh ---
  const positions: number[] = [];
  const colors: number[] = [];

  // Pre-compute transformed corners per lifted node for reuse by wall drawing
  const nodeCorners = new Map<string, { x: number; y: number }[]>();

  for (const [id, node] of liftedGraph.nodes) {
    const orbNode = orbifoldGrid.nodes.get(node.orbifoldNode);
    if (!orbNode) continue;

    const corners = orbNode.polygon.map(([px, py]) => {
      let pos = applyMatrix(node.voltage, px, py);
      if (useAxialTransform) pos = axialToCartesian(pos.x, pos.y);
      return pos;
    });
    nodeCorners.set(id, corners);

    // Determine color
    let r: number, g: number, b: number;
    if (!nodesWithSolidEdge.has(id)) {
      r = 1; g = 1; b = 1; // white
    } else {
      const compId = components.get(id) ?? 0;
      [r, g, b] = componentColorNorm(compId);
    }

    // Fan triangulation: vertex 0 connects to each consecutive pair
    for (let i = 1; i < corners.length - 1; i++) {
      positions.push(corners[0].x, corners[0].y, 0);
      positions.push(corners[i].x, corners[i].y, 0);
      positions.push(corners[i + 1].x, corners[i + 1].y, 0);
      colors.push(r, g, b);
      colors.push(r, g, b);
      colors.push(r, g, b);
    }
  }

  const triGeometry = new THREE.BufferGeometry();
  triGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  triGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(triGeometry, new THREE.MeshBasicMaterial({ vertexColors: true }));

  // --- 2. Wall line segments between differently-colored neighbors ---
  const wallPositions: number[] = [];

  for (const edge of liftedGraph.edges.values()) {
    const compA = components.get(edge.a);
    const compB = components.get(edge.b);
    // Only draw wall if both nodes exist and have different component colors
    if (compA === undefined || compB === undefined || compA === compB) continue;

    // Also skip if either node has no solid edge (both would be white)
    if (!nodesWithSolidEdge.has(edge.a) && !nodesWithSolidEdge.has(edge.b)) continue;

    const orbEdgeId = edge.orbifoldEdgeId;
    if (!orbEdgeId) continue;
    const orbEdge = orbifoldGrid.edges.get(orbEdgeId);
    if (!orbEdge) continue;

    // Get node A's info to find wall segments
    const nodeA = liftedGraph.nodes.get(edge.a);
    if (!nodeA) continue;
    const cornersA = nodeCorners.get(edge.a);
    if (!cornersA) continue;

    // Use the half-edge on node A's orbifold node to find polygon sides
    const halfEdge = orbEdge.halfEdges.get(nodeA.orbifoldNode);
    if (!halfEdge) continue;

    for (const sideIdx of halfEdge.polygonSides) {
      const p1 = cornersA[sideIdx];
      const p2 = cornersA[(sideIdx + 1) % cornersA.length];
      // Slightly above the polygon plane so walls render on top
      wallPositions.push(p1.x, p1.y, 0.1);
      wallPositions.push(p2.x, p2.y, 0.1);
    }
  }

  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wallPositions, 3));
  const walls = new THREE.LineSegments(
    wallGeometry,
    new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 }),
  );

  return { mesh, walls };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function OrbifoldColorsExplorer() {
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroupType>("P1");
  const [size, setSize] = useState(DEFAULT_N);
  const [expansion, setExpansion] = useState(DEFAULT_M);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<string>("");

  // Three.js refs
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number>(0);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const wallsRef = useRef<THREE.LineSegments | null>(null);

  const minSize = wallpaperGroup === "P4g" ? 4 : 2;

  // Keep a mutable ref to the current orbifold grid
  const gridRef = useRef<OrbifoldGrid<ColorData, EdgeStyleData> | null>(null);

  // Setup Three.js scene (once)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f9fa);
    sceneRef.current = scene;

    // Orthographic camera – initial frustum, will be updated on render
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit controls: disable rotation for 2D pan/zoom
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controlsRef.current = controls;

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      // Update ortho camera aspect
      const aspect = w / h;
      const halfH = (camera.top - camera.bottom) / 2;
      const center = (camera.left + camera.right) / 2;
      camera.left = center - halfH * aspect;
      camera.right = center + halfH * aspect;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  // Ensure grid exists or rebuild when group / size changes
  const ensureGrid = useCallback(() => {
    const g = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(g);
    gridRef.current = g;
    return g;
  }, [wallpaperGroup, size]);

  // Build lifted graph and render to Three.js
  const buildAndRender = useCallback(
    (grid: OrbifoldGrid<ColorData, EdgeStyleData>) => {
      setBusy(true);
      requestAnimationFrame(() => {
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const container = containerRef.current;
        if (!scene || !camera || !controls || !container) { setBusy(false); return; }

        const t0 = performance.now();
        const lifted = constructLiftedGraphFromOrbifold<ColorData, EdgeStyleData>(grid);
        for (let i = 0; i < expansion; i++) processAllNonInteriorOnce(lifted);
        const t1 = performance.now();

        // Remove old mesh and walls
        if (meshRef.current) {
          scene.remove(meshRef.current);
          meshRef.current.geometry.dispose();
          const mat = meshRef.current.material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else (mat as THREE.Material).dispose();
          meshRef.current = null;
        }
        if (wallsRef.current) {
          scene.remove(wallsRef.current);
          wallsRef.current.geometry.dispose();
          const mat = wallsRef.current.material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else (mat as THREE.Material).dispose();
          wallsRef.current = null;
        }

        const useAxial = wallpaperGroup === "P3";
        const { mesh, walls } = buildSceneObjects(lifted, grid, useAxial);
        scene.add(mesh);
        scene.add(walls);
        meshRef.current = mesh;
        wallsRef.current = walls;

        // Fit camera to mesh bounding box
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        const cx = (box.min.x + box.max.x) / 2;
        const cy = (box.min.y + box.max.y) / 2;
        const rangeX = box.max.x - box.min.x || 1;
        const rangeY = box.max.y - box.min.y || 1;
        const aspect = container.clientWidth / container.clientHeight;
        const padding = 1.02; // slight padding

        let halfW: number, halfH: number;
        if (rangeX / rangeY > aspect) {
          halfW = (rangeX / 2) * padding;
          halfH = halfW / aspect;
        } else {
          halfH = (rangeY / 2) * padding;
          halfW = halfH * aspect;
        }

        camera.left = cx - halfW;
        camera.right = cx + halfW;
        camera.top = cy + halfH;
        camera.bottom = cy - halfH;
        camera.position.set(cx, cy, 10);
        camera.updateProjectionMatrix();
        controls.target.set(cx, cy, 0);
        controls.update();

        const t2 = performance.now();

        setStats(
          `Nodes: ${lifted.nodes.size.toLocaleString()} | Edges: ${lifted.edges.size.toLocaleString()} | ` +
            `Lift: ${(t1 - t0).toFixed(0)} ms | Render: ${(t2 - t1).toFixed(0)} ms`,
        );
        setBusy(false);
      });
    },
    [expansion, wallpaperGroup],
  );

  // Random Tree handler
  const handleRandomTree = useCallback(() => {
    const grid = ensureGrid();
    const treeGrid = applyRandomSpanningTreeToWhiteNodes(grid);
    gridRef.current = treeGrid;
    buildAndRender(treeGrid);
  }, [ensureGrid, buildAndRender]);

  // Random Deep Tree handler
  const handleRandomDfsTree = useCallback(() => {
    const grid = ensureGrid();
    const treeGrid = applyRandomDfsTree(grid);
    gridRef.current = treeGrid;
    buildAndRender(treeGrid);
  }, [ensureGrid, buildAndRender]);

  // Size validation helper
  const validateSize = useCallback(
    (raw: string) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < minSize || n > 200 || n !== Math.floor(n)) return;
      if (wallpaperGroup === "P2" && n % 2 !== 0) return;
      setSize(n);
    },
    [minSize, wallpaperGroup],
  );

  return (
    <div style={{ padding: "20px" }}>
      <h1 style={{ marginBottom: "16px" }}>🎨 Orbifold Colors</h1>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "16px",
          padding: "12px 16px",
          backgroundColor: "#f8f9fa",
          borderRadius: "8px",
          alignItems: "center",
        }}
      >
        {/* Wallpaper group */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label>Group:</label>
          <select
            value={wallpaperGroup}
            onChange={(e) => setWallpaperGroup(e.target.value as WallpaperGroupType)}
            style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
          >
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="pgg">pgg</option>
            <option value="P3">P3</option>
            <option value="P4">P4</option>
            <option value="P4g">P4g</option>
          </select>
        </div>

        {/* n */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label>n:</label>
          <input
            type="number"
            defaultValue={size}
            min={minSize}
            max={200}
            style={{ width: "60px", padding: "4px", borderRadius: "4px", border: "1px solid #ccc" }}
            onBlur={(e) => validateSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") validateSize((e.target as HTMLInputElement).value);
            }}
          />
        </div>

        {/* m */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label>m:</label>
          <input
            type="number"
            defaultValue={expansion}
            min={0}
            max={1000}
            style={{ width: "70px", padding: "4px", borderRadius: "4px", border: "1px solid #ccc" }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0 && v <= 1000 && v === Math.floor(v)) setExpansion(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(v) && v >= 0 && v <= 1000 && v === Math.floor(v)) setExpansion(v);
              }
            }}
          />
        </div>

        {/* Random Tree */}
        <button
          onClick={handleRandomTree}
          disabled={busy}
          style={{
            padding: "6px 14px",
            borderRadius: "4px",
            border: "1px solid #27ae60",
            backgroundColor: "#e8f6ef",
            cursor: busy ? "wait" : "pointer",
          }}
          title="Random spanning tree – one connected component of white nodes"
        >
          🌲 Random Tree
        </button>

        {/* Random Deep Tree */}
        <button
          onClick={handleRandomDfsTree}
          disabled={busy}
          style={{
            padding: "6px 14px",
            borderRadius: "4px",
            border: "1px solid #2980b9",
            backgroundColor: "#d6eaf8",
            cursor: busy ? "wait" : "pointer",
          }}
          title="Random DFS tree – deep spanning tree from random root with random edge choices"
        >
          🌳 Random Deep Tree
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ marginBottom: "8px", fontSize: "13px", color: "#555" }}>{stats}</div>
      )}

      {/* Three.js container */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "700px",
          border: "1px solid #ccc",
          borderRadius: "4px",
          backgroundColor: "#f8f9fa",
        }}
      />
    </div>
  );
}
