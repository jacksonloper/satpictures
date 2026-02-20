/**
 * Orbifold Colors Explorer Page
 *
 * A large-scale rasterized view of wallpaper-group orbifolds. The user picks
 * a wallpaper type, size n (default 40), and expansion m (default 160), then
 * generates either a random spanning tree or a random loop. The lifted graph
 * is built, colored by connected component, and rendered on a <canvas> for
 * performance.
 *
 * Random loop is found by DFS with random edge ordering at each node,
 * tracking cycles and picking the longest one found.
 *
 * P3 always uses the axial transform.
 */

import { useState, useCallback, useRef } from "react";
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
const DEFAULT_DPI = 800;

// ---------------------------------------------------------------------------
// Random loop helper: DFS with random edge order, track cycles, pick longest
// ---------------------------------------------------------------------------
function applyRandomLoop(
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

  // Iterative DFS tracking the current path; when we find a back-edge to an
  // ancestor, extract the cycle and keep the longest one found.
  let bestCycleEdges: string[] = [];

  // Pick a random start node
  const nodeIds = Array.from(grid.nodes.keys());
  const startIdx = Math.floor(Math.random() * nodeIds.length);
  const startNode = nodeIds[startIdx];

  const visited = new Set<string>();
  // pathNodes[i] is the node, pathEdges[i] is the edge from pathNodes[i] to pathNodes[i+1]
  const pathNodes: string[] = [];
  const pathEdges: string[] = [];
  const depthOf = new Map<string, number>(); // node -> index in pathNodes
  // stack stores (node, edgeUsedToGetHere, adjIndex)
  const stack: Array<{ node: string; edge: string; adjIdx: number }> = [];

  // Initialize: push start node
  visited.add(startNode);
  pathNodes.push(startNode);
  depthOf.set(startNode, 0);

  // Push first frame: we iterate over adj of startNode
  stack.push({ node: startNode, edge: "", adjIdx: 0 });

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const neighbors = adj.get(frame.node)!;

    if (frame.adjIdx >= neighbors.length) {
      // Backtrack
      stack.pop();
      pathNodes.pop();
      pathEdges.pop();
      depthOf.delete(frame.node);
      continue;
    }

    const { neighbor, edgeId } = neighbors[frame.adjIdx];
    frame.adjIdx++;

    if (depthOf.has(neighbor)) {
      // Back-edge found → cycle from depthOf(neighbor) .. current depth
      const cycleStart = depthOf.get(neighbor)!;
      const cycleEdges = pathEdges.slice(cycleStart);
      cycleEdges.push(edgeId); // edge back to ancestor
      if (cycleEdges.length > bestCycleEdges.length) {
        bestCycleEdges = cycleEdges;
      }
      continue;
    }

    if (visited.has(neighbor)) continue; // cross-edge, skip

    // Tree edge: descend
    visited.add(neighbor);
    pathEdges.push(edgeId);
    pathNodes.push(neighbor);
    depthOf.set(neighbor, pathNodes.length - 1);
    stack.push({ node: neighbor, edge: edgeId, adjIdx: 0 });
  }

  // Mark loop edges as solid, everything else dashed
  const loopEdgeSet = new Set(bestCycleEdges);
  const newEdges = new Map(grid.edges);
  for (const [edgeId, edge] of newEdges) {
    const linestyle: EdgeLinestyle = loopEdgeSet.has(edgeId) ? "solid" : "dashed";
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
): Map<string, number> {
  const nodeIds = Array.from(liftedGraph.nodes.keys());
  const idxMap = new Map<string, number>();
  nodeIds.forEach((id, i) => idxMap.set(id, i));

  const uf = new UnionFind(nodeIds.length);
  for (const edge of liftedGraph.edges.values()) {
    const orbEdge = edge.orbifoldEdgeId
      ? orbifoldGrid.edges.get(edge.orbifoldEdgeId)
      : undefined;
    if ((orbEdge?.data?.linestyle ?? "solid") === "dashed") continue;
    const ia = idxMap.get(edge.a);
    const ib = idxMap.get(edge.b);
    if (ia !== undefined && ib !== undefined) uf.union(ia, ib);
  }

  // Map root indices → component ids (0-based sequential)
  const rootToComp = new Map<number, number>();
  let nextComp = 0;
  const result = new Map<string, number>();
  for (let i = 0; i < nodeIds.length; i++) {
    const root = uf.find(i);
    let comp = rootToComp.get(root);
    if (comp === undefined) {
      comp = nextComp++;
      rootToComp.set(root, comp);
    }
    result.set(nodeIds[i], comp);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Color from component id
// ---------------------------------------------------------------------------
function componentColor(compId: number): [number, number, number] {
  const hue = (compId * 137.508) % 360;
  // HSL -> RGB (s=70%, l=50%)
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
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ---------------------------------------------------------------------------
// Canvas rendering: rasterize polygons by scan-line fill
// ---------------------------------------------------------------------------
function renderToCanvas(
  canvas: HTMLCanvasElement,
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>,
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>,
  useAxialTransform: boolean,
  canvasSize: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 1. Compute polygon corners for every lifted node
  type Poly = { corners: { x: number; y: number }[]; liftedId: string };
  const polys: Poly[] = [];
  let bMinX = Infinity,
    bMaxX = -Infinity,
    bMinY = Infinity,
    bMaxY = -Infinity;

  for (const [id, node] of liftedGraph.nodes) {
    const orbNode = orbifoldGrid.nodes.get(node.orbifoldNode);
    if (!orbNode) continue;
    const corners = orbNode.polygon.map(([px, py]) => {
      let pos = applyMatrix(node.voltage, px, py);
      if (useAxialTransform) pos = axialToCartesian(pos.x, pos.y);
      return pos;
    });
    for (const c of corners) {
      if (c.x < bMinX) bMinX = c.x;
      if (c.x > bMaxX) bMaxX = c.x;
      if (c.y < bMinY) bMinY = c.y;
      if (c.y > bMaxY) bMaxY = c.y;
    }
    polys.push({ corners, liftedId: id });
  }

  if (polys.length === 0) return;

  // 2. Compute connected components
  const components = computeComponents(liftedGraph, orbifoldGrid);

  // 3. Determine scale so the image fits canvasSize pixels (same size regardless of m)
  const rangeX = bMaxX - bMinX || 1;
  const rangeY = bMaxY - bMinY || 1;
  const scale = (canvasSize - 4) / Math.max(rangeX, rangeY);
  const w = Math.ceil(rangeX * scale) + 4;
  const h = Math.ceil(rangeY * scale) + 4;

  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);

  const toX = (x: number) => 2 + (x - bMinX) * scale;
  const toY = (y: number) => 2 + (y - bMinY) * scale;

  // 4. Draw each polygon
  for (const poly of polys) {
    const compId = components.get(poly.liftedId) ?? 0;
    const [r, g, b] = componentColor(compId);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    const c0 = poly.corners[0];
    ctx.moveTo(toX(c0.x), toY(c0.y));
    for (let i = 1; i < poly.corners.length; i++) {
      ctx.lineTo(toX(poly.corners[i].x), toY(poly.corners[i].y));
    }
    ctx.closePath();
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function OrbifoldColorsExplorer() {
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroupType>("P1");
  const [size, setSize] = useState(DEFAULT_N);
  const [expansion, setExpansion] = useState(DEFAULT_M);
  const [dpi, setDpi] = useState(DEFAULT_DPI);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const minSize = wallpaperGroup === "P4g" ? 4 : 2;

  // Keep a mutable ref to the current orbifold grid so we can mutate + rebuild
  const gridRef = useRef<OrbifoldGrid<ColorData, EdgeStyleData> | null>(null);

  // Ensure grid exists or rebuild when group / size changes
  const ensureGrid = useCallback(() => {
    const g = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(g);
    gridRef.current = g;
    return g;
  }, [wallpaperGroup, size]);

  // Build lifted graph and render
  const buildAndRender = useCallback(
    (grid: OrbifoldGrid<ColorData, EdgeStyleData>) => {
      setBusy(true);
      // defer to next frame so the UI can update
      requestAnimationFrame(() => {
        const t0 = performance.now();
        const lifted = constructLiftedGraphFromOrbifold<ColorData, EdgeStyleData>(grid);
        for (let i = 0; i < expansion; i++) processAllNonInteriorOnce(lifted);
        const t1 = performance.now();

        const useAxial = wallpaperGroup === "P3";
        if (canvasRef.current) {
          renderToCanvas(canvasRef.current, lifted, grid, useAxial, dpi);
        }
        const t2 = performance.now();

        setStats(
          `Nodes: ${lifted.nodes.size.toLocaleString()} | Edges: ${lifted.edges.size.toLocaleString()} | ` +
            `Lift: ${(t1 - t0).toFixed(0)} ms | Render: ${(t2 - t1).toFixed(0)} ms`,
        );
        setBusy(false);
      });
    },
    [expansion, wallpaperGroup, dpi],
  );

  // Random Tree handler
  const handleRandomTree = useCallback(() => {
    const grid = ensureGrid();
    const treeGrid = applyRandomSpanningTreeToWhiteNodes(grid);
    gridRef.current = treeGrid;
    buildAndRender(treeGrid);
  }, [ensureGrid, buildAndRender]);

  // Random Loop handler
  const handleRandomLoop = useCallback(() => {
    const grid = ensureGrid();
    const loopGrid = applyRandomLoop(grid);
    gridRef.current = loopGrid;
    buildAndRender(loopGrid);
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

        {/* DPI / canvas pixels */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label>Canvas px:</label>
          <input
            type="number"
            defaultValue={dpi}
            min={200}
            max={4000}
            step={100}
            style={{ width: "70px", padding: "4px", borderRadius: "4px", border: "1px solid #ccc" }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 200 && v <= 4000) setDpi(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(v) && v >= 200 && v <= 4000) setDpi(v);
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

        {/* Random Loop */}
        <button
          onClick={handleRandomLoop}
          disabled={busy}
          style={{
            padding: "6px 14px",
            borderRadius: "4px",
            border: "1px solid #2980b9",
            backgroundColor: "#d6eaf8",
            cursor: busy ? "wait" : "pointer",
          }}
          title="Random loop – DFS with random edge order, picks the longest cycle found"
        >
          🔄 Random Loop
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ marginBottom: "8px", fontSize: "13px", color: "#555" }}>{stats}</div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          border: "1px solid #ccc",
          borderRadius: "4px",
          backgroundColor: "#f8f9fa",
          maxWidth: "100%",
        }}
      />
    </div>
  );
}
