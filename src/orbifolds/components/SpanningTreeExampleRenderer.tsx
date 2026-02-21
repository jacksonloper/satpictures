/**
 * Animated spanning tree example renderer.
 *
 * Visualizes an n×m rectangular grid where:
 * - Each cell is rendered as a colored polygon (rectangle)
 * - Edge weights evolve via an Ornstein–Uhlenbeck process
 * - A minimum spanning tree is recomputed each frame (Kruskal's)
 * - Each node's "voltage" (accumulated weight along tree path from root)
 *   determines its color
 * - Only cells whose voltage actually changes are updated in the Three.js buffer
 *
 * Uses Three.js with an orthographic camera. User can zoom and pan but not rotate.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* ---------- constants ---------- */

const N = 40;   // rows
const M = 160;  // columns
const NUM_NODES = N * M;
const CELL_W = 1;
const CELL_H = 1;

// OU process parameters
const THETA = 2.0;  // mean-reversion speed
const SIGMA = 1.5;  // volatility

/* ---------- helpers ---------- */

/** Gaussian random via Box-Muller. */
function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------- grid edge layout ---------- */

/*
 * Edges stored in a flat array:
 *   [0 .. N*(M-1)-1]           horizontal edges  (row r, col c→c+1)
 *   [N*(M-1) .. numEdges-1]    vertical   edges  (row r→r+1, col c)
 */

function totalEdgeCount(): number {
  return N * (M - 1) + (N - 1) * M;
}

function hEdgeIndex(r: number, c: number): number {
  return r * (M - 1) + c;
}

function vEdgeIndex(r: number, c: number): number {
  return N * (M - 1) + r * M + c;
}

function initWeights(numEdges: number): Float64Array {
  const w = new Float64Array(numEdges);
  for (let i = 0; i < numEdges; i++) w[i] = randn();
  return w;
}

/* ---------- Kruskal's spanning tree ---------- */

/**
 * Build MST via Kruskal's.  All buffers are pre-allocated and reused.
 *
 * @param weights   – edge weights
 * @param sortArr   – index array (length = numEdges), re-sorted in place each call
 * @param treeEdges – output: 1 if edge is in tree, 0 otherwise
 * @param parent    – union-find parent (length = NUM_NODES), overwritten
 * @param ufRank    – union-find rank  (length = NUM_NODES), overwritten
 */
function buildTree(
  weights: Float64Array,
  sortArr: number[],
  treeEdges: Uint8Array,
  parent: Int32Array,
  ufRank: Int32Array,
): void {
  const numEdges = weights.length;
  const hCount = N * (M - 1);

  // Reset union-find
  for (let i = 0; i < NUM_NODES; i++) { parent[i] = i; ufRank[i] = 0; }
  treeEdges.fill(0);

  // Sort indices by weight (Timsort is ~O(n) for nearly-sorted data)
  sortArr.sort((a, b) => weights[a] - weights[b]);

  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }

  let added = 0;
  for (let si = 0; si < numEdges && added < NUM_NODES - 1; si++) {
    const ei = sortArr[si];
    let from: number, to: number;
    if (ei < hCount) {
      const r = (ei / (M - 1)) | 0;
      const c = ei % (M - 1);
      from = r * M + c;
      to = from + 1;
    } else {
      const vi = ei - hCount;
      const r = (vi / M) | 0;
      const c = vi % M;
      from = r * M + c;
      to = from + M;
    }
    const rf = find(from), rt = find(to);
    if (rf !== rt) {
      if (ufRank[rf] < ufRank[rt]) parent[rf] = rt;
      else if (ufRank[rf] > ufRank[rt]) parent[rt] = rf;
      else { parent[rt] = rf; ufRank[rf]++; }
      treeEdges[ei] = 1;
      added++;
    }
  }
}

/* ---------- voltage computation (BFS through spanning tree) ---------- */

function computeVoltages(
  weights: Float64Array,
  treeEdges: Uint8Array,
  voltages: Float64Array,
  queue: Int32Array,
  visited: Uint8Array,
): void {
  voltages.fill(0);
  visited.fill(0);

  // BFS from node 0
  visited[0] = 1;
  queue[0] = 0;
  let head = 0, tail = 1;

  while (head < tail) {
    const node = queue[head++];
    const r = (node / M) | 0;
    const c = node % M;

    // Right
    if (c + 1 < M) {
      const ei = hEdgeIndex(r, c);
      if (treeEdges[ei]) {
        const nb = node + 1;
        if (!visited[nb]) { visited[nb] = 1; voltages[nb] = voltages[node] + weights[ei]; queue[tail++] = nb; }
      }
    }
    // Left
    if (c > 0) {
      const ei = hEdgeIndex(r, c - 1);
      if (treeEdges[ei]) {
        const nb = node - 1;
        if (!visited[nb]) { visited[nb] = 1; voltages[nb] = voltages[node] - weights[ei]; queue[tail++] = nb; }
      }
    }
    // Down
    if (r + 1 < N) {
      const ei = vEdgeIndex(r, c);
      if (treeEdges[ei]) {
        const nb = node + M;
        if (!visited[nb]) { visited[nb] = 1; voltages[nb] = voltages[node] + weights[ei]; queue[tail++] = nb; }
      }
    }
    // Up
    if (r > 0) {
      const ei = vEdgeIndex(r - 1, c);
      if (treeEdges[ei]) {
        const nb = node - M;
        if (!visited[nb]) { visited[nb] = 1; voltages[nb] = voltages[node] - weights[ei]; queue[tail++] = nb; }
      }
    }
  }
}

/* ---------- React component ---------- */

interface SpanningTreeExampleRendererProps {
  width?: number;
  height?: number;
}

export function SpanningTreeExampleRenderer({
  width = 900,
  height = 400,
}: SpanningTreeExampleRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const numEdges = totalEdgeCount();

    /* ---- pre-allocate all buffers ---- */
    const weights   = initWeights(numEdges);
    const treeEdges = new Uint8Array(numEdges);
    const sortArr   = Array.from({ length: numEdges }, (_, i) => i);
    const parent    = new Int32Array(NUM_NODES);
    const ufRank    = new Int32Array(NUM_NODES);
    const voltages  = new Float64Array(NUM_NODES);
    const prevVolt  = new Float64Array(NUM_NODES);
    const queue     = new Int32Array(NUM_NODES);
    const visited   = new Uint8Array(NUM_NODES);

    /* ---- initial tree + voltages ---- */
    buildTree(weights, sortArr, treeEdges, parent, ufRank);
    computeVoltages(weights, treeEdges, voltages, queue, visited);

    /* ---- Three.js setup ---- */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    // Orthographic camera sized to fit the grid
    const gridW = M * CELL_W;
    const gridH = N * CELL_H;
    const aspect = width / height;
    const gridAspect = gridW / gridH;
    let camHalfW: number, camHalfH: number;
    if (gridAspect > aspect) {
      camHalfW = gridW / 2 * 1.02;
      camHalfH = camHalfW / aspect;
    } else {
      camHalfH = gridH / 2 * 1.02;
      camHalfW = camHalfH * aspect;
    }
    const camera = new THREE.OrthographicCamera(
      -camHalfW, camHalfW, camHalfH, -camHalfH, 0.1, 100,
    );
    camera.position.set(gridW / 2, gridH / 2, 10);
    camera.lookAt(gridW / 2, gridH / 2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    // OrbitControls: pan + zoom only (no rotation)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.target.set(gridW / 2, gridH / 2, 0);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.update();

    /* ---- build geometry: one quad (2 tris) per cell ---- */
    const positions = new Float32Array(NUM_NODES * 4 * 3);
    const colors    = new Float32Array(NUM_NODES * 4 * 3);
    const indices   = new Uint32Array(NUM_NODES * 6);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < M; c++) {
        const ci = r * M + c;
        const vb = ci * 4;        // vertex base
        const x  = c * CELL_W;
        const y  = (N - 1 - r) * CELL_H;  // flip y so row 0 is at top
        const p  = vb * 3;

        // 4 vertices: BL, BR, TR, TL
        positions[p     ] = x;            positions[p +  1] = y;            positions[p +  2] = 0;
        positions[p +  3] = x + CELL_W;   positions[p +  4] = y;            positions[p +  5] = 0;
        positions[p +  6] = x + CELL_W;   positions[p +  7] = y + CELL_H;   positions[p +  8] = 0;
        positions[p +  9] = x;            positions[p + 10] = y + CELL_H;   positions[p + 11] = 0;

        const ib = ci * 6;
        indices[ib    ] = vb;     indices[ib + 1] = vb + 1; indices[ib + 2] = vb + 2;
        indices[ib + 3] = vb;     indices[ib + 4] = vb + 2; indices[ib + 5] = vb + 3;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color",    new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    scene.add(new THREE.Mesh(geom, mat));

    const colorAttr = geom.getAttribute("color") as THREE.BufferAttribute;
    const tmpColor  = new THREE.Color();

    /* ---- sync vertex colours from voltage array ---- */
    function syncColors(forceAll: boolean) {
      // Compute min/max for normalisation
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < NUM_NODES; i++) {
        if (voltages[i] < lo) lo = voltages[i];
        if (voltages[i] > hi) hi = voltages[i];
      }
      const range = hi - lo || 1;

      let dirty = false;
      for (let i = 0; i < NUM_NODES; i++) {
        if (!forceAll && voltages[i] === prevVolt[i]) continue;
        dirty = true;

        // Map to [0, 1] and use HSL colour wheel (blue → cyan → green → yellow → red)
        const t = (voltages[i] - lo) / range;
        tmpColor.setHSL(0.66 * (1 - t), 0.85, 0.5);

        const vb = i * 4;
        for (let k = 0; k < 4; k++) {
          colorAttr.setXYZ(vb + k, tmpColor.r, tmpColor.g, tmpColor.b);
        }
      }
      if (dirty) colorAttr.needsUpdate = true;
    }

    syncColors(true);

    /* ---- animation loop ---- */
    let animId = 0;
    let lastTime = performance.now();

    function tick() {
      animId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // OU step on every edge weight
      const sd = SIGMA * Math.sqrt(dt);
      for (let i = 0; i < numEdges; i++) {
        weights[i] += -THETA * weights[i] * dt + sd * randn();
      }

      // Rebuild spanning tree
      buildTree(weights, sortArr, treeEdges, parent, ufRank);

      // Snapshot previous voltages and recompute
      prevVolt.set(voltages);
      computeVoltages(weights, treeEdges, voltages, queue, visited);

      // Update only changed cells
      syncColors(false);

      controls.update();
      renderer.render(scene, camera);
    }
    tick();

    /* ---- cleanup ---- */
    return () => {
      cancelAnimationFrame(animId);
      controls.dispose();
      renderer.dispose();
      geom.dispose();
      mat.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [width, height]);

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        border: "1px solid #444",
        borderRadius: 8,
        overflow: "hidden",
      }}
    />
  );
}
